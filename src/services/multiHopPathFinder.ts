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
  timeout?: number;
}

export class MultiHopPathFinder {
  private server: StellarSdk.Horizon.Server;
  private readonly DEFAULT_MAX_HOPS = 5;
  private readonly DEFAULT_TIMEOUT = 10000;

  constructor() {
    this.server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
  }

  /**
   * Find and evaluate all possible trading paths between two assets
   */
  async findOptimalPath(
    sourceAsset: StellarSdk.Asset,
    destinationAsset: StellarSdk.Asset,
    amount: string,
    options: PathFinderOptions = {}
  ): Promise<PathEvaluationResult> {
    const startTime = Date.now();
    const maxHops = options.maxHops || this.DEFAULT_MAX_HOPS;

    logger.info("Starting multi-hop path evaluation", {
      source: this.assetToString(sourceAsset),
      destination: this.assetToString(destinationAsset),
      amount,
      maxHops,
    });

    try {
      const allPaths = await this.findAllPaths(
        sourceAsset,
        destinationAsset,
        amount,
        maxHops,
        options
      );

      if (allPaths.length === 0) {
        throw new Error("No valid trading paths found");
      }

      const evaluatedPaths = await this.evaluatePaths(allPaths);
      const bestPath = this.selectBestPath(evaluatedPaths);

      const evaluationTime = Date.now() - startTime;

      logger.info("Path evaluation complete", {
        pathsFound: evaluatedPaths.length,
        bestPathHops: bestPath.hops,
        bestPathEfficiency: bestPath.efficiency,
        evaluationTime,
      });

      return {
        bestPath,
        allPaths: evaluatedPaths,
        evaluationTime,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error("Path finding failed", { error });
      throw error;
    }
  }

  /**
   * Find all possible paths using Stellar's path payment endpoints
   */
  private async findAllPaths(
    sourceAsset: StellarSdk.Asset,
    destinationAsset: StellarSdk.Asset,
    amount: string,
    maxHops: number,
    options: PathFinderOptions
  ): Promise<TradePath[]> {
    const paths: TradePath[] = [];

    // Try strict send paths
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

    // Try strict receive paths for comparison
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

  /**
   * Convert Horizon strict send path to TradePath
   */
  private convertStrictSendPath(
    record: any,
    sourceAsset: StellarSdk.Asset,
    destinationAsset: StellarSdk.Asset
  ): TradePath {
    const path = [
      sourceAsset,
      ...record.path.map(this.parseAsset),
      destinationAsset,
    ];
    const route = path.map((asset) => this.assetToString(asset));

    return {
      path,
      sourceAmount: record.source_amount,
      destinationAmount: record.destination_amount,
      priceImpact: 0,
      estimatedSlippage: 0,
      hops: record.path.length + 1,
      route,
      efficiency: 0,
    };
  }

  /**
   * Convert Horizon strict receive path to TradePath
   */
  private convertStrictReceivePath(
    record: any,
    sourceAsset: StellarSdk.Asset,
    destinationAsset: StellarSdk.Asset
  ): TradePath {
    const path = [
      sourceAsset,
      ...record.path.map(this.parseAsset),
      destinationAsset,
    ];
    const route = path.map((asset) => this.assetToString(asset));

    return {
      path,
      sourceAmount: record.source_amount,
      destinationAmount: record.destination_amount,
      priceImpact: 0,
      estimatedSlippage: 0,
      hops: record.path.length + 1,
      route,
      efficiency: 0,
    };
  }

  /**
   * Evaluate paths for efficiency and risk
   */
  private async evaluatePaths(paths: TradePath[]): Promise<TradePath[]> {
    return Promise.all(
      paths.map(async (path) => {
        const priceImpact = this.calculatePriceImpact(path);
        const estimatedSlippage = this.estimateSlippage(path);
        const efficiency = this.calculateEfficiency(
          path,
          priceImpact,
          estimatedSlippage
        );

        return {
          ...path,
          priceImpact,
          estimatedSlippage,
          efficiency,
        };
      })
    );
  }

  /**
   * Calculate price impact for a path
   */
  private calculatePriceImpact(path: TradePath): number {
    const sourceAmount = parseFloat(path.sourceAmount);
    const destinationAmount = parseFloat(path.destinationAmount);

    if (sourceAmount === 0 || destinationAmount === 0) {
      return 100;
    }

    const effectiveRate = destinationAmount / sourceAmount;
    const hopPenalty = path.hops * 0.003;

    return hopPenalty * 100;
  }

  /**
   * Estimate slippage based on path characteristics
   */
  private estimateSlippage(path: TradePath): number {
    const baseSlippage = 0.001;
    const hopMultiplier = Math.pow(1.5, path.hops - 1);

    return baseSlippage * hopMultiplier;
  }

  /**
   * Calculate overall path efficiency score
   */
  private calculateEfficiency(
    path: TradePath,
    priceImpact: number,
    slippage: number
  ): number {
    const destinationAmount = parseFloat(path.destinationAmount);
    const hopPenalty = path.hops * 0.1;
    const impactPenalty = priceImpact / 100;
    const slippagePenalty = slippage * 10;

    const efficiency =
      destinationAmount * (1 - hopPenalty - impactPenalty - slippagePenalty);

    return Math.max(0, efficiency);
  }

  /**
   * Select the best path based on efficiency
   */
  private selectBestPath(paths: TradePath[]): TradePath {
    return paths.reduce((best, current) => {
      if (current.efficiency > best.efficiency) {
        return current;
      }
      if (current.efficiency === best.efficiency && current.hops < best.hops) {
        return current;
      }
      return best;
    });
  }

  /**
   * Parse asset from Horizon response
   */
  private parseAsset(assetData: any): StellarSdk.Asset {
    if (assetData.asset_type === "native") {
      return StellarSdk.Asset.native();
    }
    return new StellarSdk.Asset(assetData.asset_code, assetData.asset_issuer);
  }

  /**
   * Convert asset to string representation
   */
  private assetToString(asset: StellarSdk.Asset): string {
    if (asset.isNative()) {
      return "XLM";
    }
    return `${asset.getCode()}:${asset.getIssuer().substring(0, 8)}...`;
  }

  /**
   * Compare two paths and return the better one
   */
  comparePaths(path1: TradePath, path2: TradePath): TradePath {
    if (path1.efficiency > path2.efficiency) {
      return path1;
    }
    if (path1.efficiency === path2.efficiency) {
      return path1.hops <= path2.hops ? path1 : path2;
    }
    return path2;
  }
}

export const multiHopPathFinder = new MultiHopPathFinder();
