import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../config/config";
import logger from "../config/logger";

export interface TradePath {
  path: StellarSdk.Asset[];
  sourceAmount: string;
  destinationAmount: string;
  priceImpact: number;
  estimatedSlippage: number;
  hops: number;
  route: string[];
  /**
   * Normalized efficiency score in [0, 1].
   * Computed as: (destAmount / bestDestAmount) * hopDiscount * slippageDiscount
   * Scores are dimensionless and comparable across paths for the same trade.
   */
  efficiency: number;
}

export interface PathEvaluationResult {
  bestPath: TradePath;
  allPaths: TradePath[];
  evaluationTime: number;
  timestamp: number;
}

export interface PathFinderOptions {
  maxHops?: number;
  minDestinationAmount?: string;
  includeAssets?: StellarSdk.Asset[];
  /** Hard timeout in ms. Defaults to 10 000. */
  timeout?: number;
  /** Route policy to enforce. Defaults to DEFAULT_ROUTE_POLICY. */
  policy?: RoutePolicy;
}

/**
 * RoutePolicy defines the minimum quality bar a path must meet to be
 * considered executable. Paths that fail policy are still returned in
 * `allPaths` but `bestPath` is guaranteed to satisfy the policy, or
 * findOptimalPath throws `RoutePolicyViolationError`.
 */
export interface RoutePolicy {
  /** Minimum normalized efficiency score [0, 1]. */
  minEfficiency: number;
  /** Maximum estimated slippage as a fraction (e.g. 0.05 = 5%). */
  maxSlippage: number;
  /** Maximum number of hops allowed. */
  maxHops: number;
}

export class RoutePolicyViolationError extends Error {
  constructor(
    public readonly reason: string,
    public readonly bestAvailable: TradePath
  ) {
    super(`Route policy violation: ${reason}`);
    this.name = "RoutePolicyViolationError";
  }
}

export const DEFAULT_ROUTE_POLICY: RoutePolicy = {
  minEfficiency: 0.7,
  maxSlippage: 0.05,
  maxHops: 5,
};

/** Per-hop slippage penalty factor (0.3% per hop). */
const HOP_SLIPPAGE_RATE = 0.003;
/** Per-hop efficiency discount factor. */
const HOP_EFFICIENCY_DISCOUNT = 0.02;

export class MultiHopPathFinder {
  private server: StellarSdk.Horizon.Server;
  private readonly DEFAULT_MAX_HOPS = 5;
  private readonly DEFAULT_TIMEOUT = 10_000;

  constructor() {
    this.server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
  }

  /**
   * Find and evaluate all possible trading paths between two assets.
   * Enforces a hard timeout and the provided RoutePolicy.
   * Throws RoutePolicyViolationError if the best available path fails policy.
   * Throws Error if no paths are found or timeout is exceeded.
   */
  async findOptimalPath(
    sourceAsset: StellarSdk.Asset,
    destinationAsset: StellarSdk.Asset,
    amount: string,
    options: PathFinderOptions = {}
  ): Promise<PathEvaluationResult> {
    const startTime = Date.now();
    const maxHops = options.maxHops ?? this.DEFAULT_MAX_HOPS;
    const timeout = options.timeout ?? this.DEFAULT_TIMEOUT;
    const policy = options.policy ?? DEFAULT_ROUTE_POLICY;

    logger.info("Starting multi-hop path evaluation", {
      source: this.assetToString(sourceAsset),
      destination: this.assetToString(destinationAsset),
      amount,
      maxHops,
      timeout,
    });

    const rawPaths = await this.withTimeout(
      this.findAllPaths(sourceAsset, destinationAsset, amount, maxHops),
      timeout
    );

    if (rawPaths.length === 0) {
      throw new Error(
        `No valid trading paths found for ${this.assetToString(sourceAsset)} → ${this.assetToString(destinationAsset)}`
      );
    }

    const evaluatedPaths = this.evaluatePaths(rawPaths);
    const bestPath = this.selectBestPath(evaluatedPaths);
    const evaluationTime = Date.now() - startTime;

    logger.info("Path evaluation complete", {
      pathsFound: evaluatedPaths.length,
      bestPathHops: bestPath.hops,
      bestPathEfficiency: bestPath.efficiency,
      evaluationTime,
    });

    // Enforce route policy on the best available path.
    this.enforcePolicy(bestPath, policy);

    return {
      bestPath,
      allPaths: evaluatedPaths,
      evaluationTime,
      timestamp: Date.now(),
    };
  }

  /**
   * Enforce RoutePolicy. Throws RoutePolicyViolationError on violation.
   */
  private enforcePolicy(path: TradePath, policy: RoutePolicy): void {
    if (path.efficiency < policy.minEfficiency) {
      throw new RoutePolicyViolationError(
        `efficiency ${path.efficiency.toFixed(4)} < required ${policy.minEfficiency}`,
        path
      );
    }
    if (path.estimatedSlippage > policy.maxSlippage) {
      throw new RoutePolicyViolationError(
        `slippage ${(path.estimatedSlippage * 100).toFixed(2)}% > max ${(policy.maxSlippage * 100).toFixed(2)}%`,
        path
      );
    }
    if (path.hops > policy.maxHops) {
      throw new RoutePolicyViolationError(
        `hops ${path.hops} > max ${policy.maxHops}`,
        path
      );
    }
  }

  private async findAllPaths(
    sourceAsset: StellarSdk.Asset,
    destinationAsset: StellarSdk.Asset,
    amount: string,
    maxHops: number
  ): Promise<TradePath[]> {
    const paths: TradePath[] = [];

    try {
      const strictSendPaths = await this.server
        .strictSendPaths(sourceAsset, amount, [destinationAsset])
        .limit(20)
        .call();

      for (const record of strictSendPaths.records) {
        if (record.path.length < maxHops) {
          paths.push(this.convertRecord(record, sourceAsset, destinationAsset));
        }
      }
    } catch (error) {
      logger.warn("Strict send paths failed", { error });
    }

    try {
      const strictReceivePaths = await this.server
        .strictReceivePaths([sourceAsset], destinationAsset, amount)
        .limit(20)
        .call();

      for (const record of strictReceivePaths.records) {
        if (record.path.length < maxHops) {
          paths.push(this.convertRecord(record, sourceAsset, destinationAsset));
        }
      }
    } catch (error) {
      logger.warn("Strict receive paths failed", { error });
    }

    return paths;
  }

  private convertRecord(
    record: {
      path: Array<{
        asset_type: string;
        asset_code?: string;
        asset_issuer?: string;
      }>;
      source_amount: string;
      destination_amount: string;
    },
    sourceAsset: StellarSdk.Asset,
    destinationAsset: StellarSdk.Asset
  ): TradePath {
    const midAssets = record.path.map((a) => this.parseAsset(a));
    const fullPath = [sourceAsset, ...midAssets, destinationAsset];
    const hops = record.path.length + 1;

    return {
      path: fullPath,
      sourceAmount: record.source_amount,
      destinationAmount: record.destination_amount,
      priceImpact: 0,
      estimatedSlippage: 0,
      hops,
      route: fullPath.map((a) => this.assetToString(a)),
      efficiency: 0,
    };
  }

  /**
   * Compute normalized efficiency scores in [0, 1].
   *
   * efficiency = (destAmount / maxDestAmount) * hopDiscount * slippageDiscount
   *
   * Dimensionless and comparable across all paths for the same trade.
   */
  private evaluatePaths(paths: TradePath[]): TradePath[] {
    const maxDest = Math.max(
      ...paths.map((p) => parseFloat(p.destinationAmount))
    );

    return paths.map((path) => {
      const destAmount = parseFloat(path.destinationAmount);
      const slippage = HOP_SLIPPAGE_RATE * path.hops;
      const priceImpact = slippage * 100;

      const outputRatio = maxDest > 0 ? destAmount / maxDest : 0;
      const hopDiscount = Math.max(0, 1 - path.hops * HOP_EFFICIENCY_DISCOUNT);
      const slippageDiscount = Math.max(0, 1 - slippage);
      const efficiency = Math.min(
        1,
        Math.max(0, outputRatio * hopDiscount * slippageDiscount)
      );

      return { ...path, priceImpact, estimatedSlippage: slippage, efficiency };
    });
  }

  /**
   * Deterministic tie-breaking:
   * 1. Higher efficiency wins.
   * 2. Equal efficiency → fewer hops wins.
   * 3. Equal hops → lexicographically smaller route string wins.
   */
  private selectBestPath(paths: TradePath[]): TradePath {
    return [...paths].sort((a, b) => {
      if (b.efficiency !== a.efficiency) return b.efficiency - a.efficiency;
      if (a.hops !== b.hops) return a.hops - b.hops;
      return a.route.join(">").localeCompare(b.route.join(">"));
    })[0];
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Path finding timed out after ${ms}ms`)),
          ms
        )
      ),
    ]);
  }

  private parseAsset(assetData: {
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  }): StellarSdk.Asset {
    if (assetData.asset_type === "native") return StellarSdk.Asset.native();
    return new StellarSdk.Asset(assetData.asset_code!, assetData.asset_issuer!);
  }

  private assetToString(asset: StellarSdk.Asset): string {
    if (asset.isNative()) return "XLM";
    return `${asset.getCode()}:${asset.getIssuer().substring(0, 8)}...`;
  }

  comparePaths(path1: TradePath, path2: TradePath): TradePath {
    return this.selectBestPath([path1, path2]);
  }
}

export const multiHopPathFinder = new MultiHopPathFinder();
