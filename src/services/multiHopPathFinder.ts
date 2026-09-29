import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../config/config";
import logger from "../config/logger";
import {
  TradePath,
  PathEvaluationResult,
  PathFinderOptions,
  RoutePolicy,
  RoutePolicyViolationError,
  PolicyViolation,
  DEFAULT_ROUTE_POLICY,
  parseStellarAsset,
  stellarAssetToString,
} from "../domain";

export {
  RoutePolicyViolationError,
  PolicyViolation,
  RoutePolicy,
  DEFAULT_ROUTE_POLICY,
} from "../domain";

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
      source: stellarAssetToString(sourceAsset),
      destination: stellarAssetToString(destinationAsset),
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
        `No valid trading paths found for ${stellarAssetToString(sourceAsset)} → ${stellarAssetToString(destinationAsset)}`
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
   * Enforce RoutePolicy. Collects all violations and throws RoutePolicyViolationError
   * with structured reasons if any threshold is breached.
   */
  private enforcePolicy(path: TradePath, policy: RoutePolicy): void {
    const violations: PolicyViolation[] = [];

    if (path.efficiency < policy.minEfficiency) {
      violations.push({
        field: "efficiency",
        actual: path.efficiency,
        threshold: policy.minEfficiency,
        reason: `efficiency ${path.efficiency.toFixed(4)} < required ${policy.minEfficiency}`,
      });
    }
    if (path.estimatedSlippage > policy.maxSlippage) {
      violations.push({
        field: "slippage",
        actual: path.estimatedSlippage,
        threshold: policy.maxSlippage,
        reason: `slippage ${(path.estimatedSlippage * 100).toFixed(2)}% > max ${(policy.maxSlippage * 100).toFixed(2)}%`,
      });
    }
    if (path.hops > policy.maxHops) {
      violations.push({
        field: "hops",
        actual: path.hops,
        threshold: policy.maxHops,
        reason: `hops ${path.hops} > max ${policy.maxHops}`,
      });
    }

    if (violations.length > 0) {
      throw new RoutePolicyViolationError(
        violations.map((v) => v.reason).join("; "),
        path,
        violations
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
        if (record.path.length <= maxHops) {
          paths.push(
            this.convertStrictSendPath(record, sourceAsset, destinationAsset)
          );
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
        if (record.path.length <= maxHops) {
          paths.push(
            this.convertStrictReceivePath(record, sourceAsset, destinationAsset)
          );
        }
      }
    } catch (error) {
      logger.warn("Strict receive paths failed", { error });
    }

    return paths;
  }

  private convertStrictSendPath(
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

    return {
      path: fullPath,
      sourceAmount: record.source_amount,
      destinationAmount: record.destination_amount,
      priceImpact: 0,
      estimatedSlippage: 0,
      hops: record.path.length + 1,
      route: fullPath.map((a) => this.assetToString(a)),
      efficiency: 0,
    };
  }

  private convertStrictReceivePath(
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

    return {
      path: fullPath,
      sourceAmount: record.source_amount,
      destinationAmount: record.destination_amount,
      priceImpact: 0,
      estimatedSlippage: 0,
      hops: record.path.length + 1,
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
    return parseStellarAsset(assetData);
  }

  private assetToString(asset: StellarSdk.Asset): string {
    return stellarAssetToString(asset);
  }

  comparePaths(path1: TradePath, path2: TradePath): TradePath {
    return this.selectBestPath([path1, path2]);
  }
}

export const multiHopPathFinder = new MultiHopPathFinder();
