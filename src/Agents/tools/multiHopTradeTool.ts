import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../../config/config";
import accountsData from "../../Auth/accounts.json";
import {
  multiHopPathFinder,
  RoutePolicy,
  RoutePolicyViolationError,
  DEFAULT_ROUTE_POLICY,
  TradePath,
} from "../../services/multiHopPathFinder";
import { assetRevocationService } from "../../Security";
import logger from "../../config/logger";

interface MultiHopTradePayload extends Record<string, unknown> {
  /** "evaluate" returns the best path without executing. "execute" submits the trade. */
  operation: "evaluate" | "execute";
  fromAsset: string;
  toAsset: string;
  amount: number;
  maxHops?: number;
  /** Override default route policy thresholds. */
  policy?: Partial<RoutePolicy>;
}

interface StellarAccountData {
  userId: string;
  secretKey: string;
  publicKey: string;
}

const STELLAR_ASSETS: Record<string, StellarSdk.Asset> = {
  XLM: StellarSdk.Asset.native(),
  USDC: new StellarSdk.Asset(
    "USDC",
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
  ),
  USDT: new StellarSdk.Asset(
    "USDT",
    "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V"
  ),
};

/**
 * Tool for evaluating and executing optimal multi-hop trading paths across Stellar DEX
 */
export class MultiHopTradeTool extends BaseTool<MultiHopTradePayload> {
  metadata: ToolMetadata = {
    name: "multi_hop_trade",
    description:
      "Evaluate or execute optimal multi-hop trading paths across Stellar DEX. " +
      "Use operation=evaluate to inspect routes before committing, " +
      "operation=execute to submit the best path as a path payment.",
    category: "defi",
    parameters: {
      operation: {
        type: "string",
        description: "evaluate (inspect routes) or execute (submit trade)",
        required: true,
        enum: ["evaluate", "execute"],
      },
      fromAsset: {
        type: "string",
        description: "Source asset symbol",
        required: true,
        enum: ["XLM", "USDC", "USDT"],
      },
      toAsset: {
        type: "string",
        description: "Destination asset symbol",
        required: true,
        enum: ["XLM", "USDC", "USDT"],
      },
      amount: {
        type: "number",
        description: "Amount of source asset",
        required: true,
        min: 0,
      },
      maxHops: {
        type: "number",
        description: "Maximum intermediate hops (default: 5)",
        required: false,
      },
      executeOptimal: {
        type: "boolean",
        description:
          "Whether to execute the optimal path (default: false, only evaluate)",
      },
      policy: {
        type: "object",
        description:
          "Route policy overrides: { minEfficiency, maxSlippage, maxHops }",
        required: false,
      },
    },
    examples: [
      "Evaluate best path to swap 100 XLM to USDC",
      "Execute multi-hop trade: 500 XLM → USDT with max 3 hops",
      "Find routes from USDC to USDT with minEfficiency 0.9",
    ],
    version: "2.0.0",
  };

  private horizonServer: StellarSdk.Horizon.Server;

  /**
   * Initialize the multi-hop trade tool with Stellar Horizon server
   */
  constructor() {
    super();
    this.horizonServer = new StellarSdk.Horizon.Server(
      config.stellar.horizonUrl
    );
  }

  /**
   * Execute a multi-hop trade evaluation or submission
   * @param payload - The trade payload with operation, assets, amount, and optional policy
   * @param userId - The user executing the trade
   * @returns ToolResult with route information or transaction result
   */
  async execute(
    payload: MultiHopTradePayload,
    userId: string
  ): Promise<ToolResult> {
    if (payload.fromAsset === payload.toAsset) {
      return this.createErrorResult(
        "multi_hop_trade",
        "Source and destination assets must be different"
      );
    }

    const sourceAsset = STELLAR_ASSETS[payload.fromAsset?.toUpperCase()];
    const destAsset = STELLAR_ASSETS[payload.toAsset?.toUpperCase()];

    if (!sourceAsset || !destAsset) {
      return this.createErrorResult(
        "multi_hop_trade",
        `Unsupported asset. Supported: ${Object.keys(STELLAR_ASSETS).join(", ")}`
      );
    }

    const policy: RoutePolicy = {
      ...DEFAULT_ROUTE_POLICY,
      ...(payload.policy ?? {}),
      maxHops:
        payload.maxHops ??
        payload.policy?.maxHops ??
        DEFAULT_ROUTE_POLICY.maxHops,
    };

    switch (payload.operation) {
      case "evaluate":
        return this.evaluateRoute(
          sourceAsset,
          destAsset,
          payload,
          policy,
          userId
        );
      case "execute":
        return this.executeRoute(
          sourceAsset,
          destAsset,
          payload,
          policy,
          userId
        );
      default:
        return this.createErrorResult(
          "multi_hop_trade",
          `Unknown operation: ${payload.operation}`
        );
    }
  }

  /**
   * Evaluate optimal multi-hop route without executing
   * @param sourceAsset - The source Stellar asset
   * @param destAsset - The destination Stellar asset
   * @param payload - Original trade payload
   * @param policy - Route policy constraints
   * @param userId - User ID
   * @returns ToolResult with best and alternative paths
   */
  private async evaluateRoute(
    sourceAsset: StellarSdk.Asset,
    destAsset: StellarSdk.Asset,
    payload: MultiHopTradePayload,
    policy: RoutePolicy,
    userId: string
  ): Promise<ToolResult> {
    try {
      logger.info("Multi-hop route evaluation", { userId, payload });

      const result = await multiHopPathFinder.findOptimalPath(
        sourceAsset,
        destAsset,
        payload.amount.toFixed(7),
        { maxHops: policy.maxHops, policy }
      );

      return this.createSuccessResult("multi_hop_evaluate", {
        bestPath: this.serializePath(result.bestPath),
        alternativePaths: result.allPaths
          .slice(1, 4)
          .map((p) => this.serializePath(p)),
        evaluation: {
          totalPathsFound: result.allPaths.length,
          evaluationTimeMs: result.evaluationTime,
          timestamp: new Date(result.timestamp).toISOString(),
        },
        policyApplied: policy,
      });
    } catch (err) {
      return this.handlePathError(err, "multi_hop_evaluate");
    }
  }

  /**
   * Execute the optimal multi-hop trade route
   * @param sourceAsset - The source Stellar asset
   * @param destAsset - The destination Stellar asset
   * @param payload - Original trade payload
   * @param policy - Route policy constraints
   * @param userId - User ID
   * @returns ToolResult with transaction result
   */
  private async executeRoute(
    sourceAsset: StellarSdk.Asset,
    destAsset: StellarSdk.Asset,
    payload: MultiHopTradePayload,
    policy: RoutePolicy,
    userId: string
  ): Promise<ToolResult> {
    try {
      logger.info("Multi-hop route execution", { userId, payload });

      const result = await multiHopPathFinder.findOptimalPath(
        sourceAsset,
        destAsset,
        payload.amount.toFixed(7),
        { maxHops: policy.maxHops, policy }
      );

      const bestPath = result.bestPath;
      const keypair = this.getKeypair(userId);
      const sourceAccount = await this.horizonServer.loadAccount(
        keypair.publicKey()
      );

      // 1% slippage tolerance on destination minimum
      const destMin = (parseFloat(bestPath.destinationAmount) * 0.99).toFixed(
        7
      );

      // Intermediate path assets (exclude source and destination)
      const pathAssets = bestPath.path.slice(1, -1);

      const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: config.stellar.networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.pathPaymentStrictSend({
            sendAsset: sourceAsset,
            sendAmount: payload.amount.toFixed(7),
            destination: keypair.publicKey(),
            destAsset,
            destMin,
            path: pathAssets,
          })
        )
        .setTimeout(30)
        .build();

      tx.sign(keypair);

      // Re-check revocation immediately before submission
      try {
        const sourceRevocation = await assetRevocationService.isRevoked(sourceAsset.code, "asset");
        if (sourceRevocation.revoked) {
          return this.createErrorResult("multi_hop_execute", `Asset ${sourceAsset.code} has been revoked: ${sourceRevocation.reason}`);
        }
        const destRevocation = await assetRevocationService.isRevoked(destAsset.code, "asset");
        if (destRevocation.revoked) {
          return this.createErrorResult("multi_hop_execute", `Asset ${destAsset.code} has been revoked: ${destRevocation.reason}`);
        }
      } catch (err) {
        logger.warn("Revocation re-check failed before multi-hop submission", { userId, error: err });
      }

      const submitted = await this.horizonServer.submitTransaction(tx);

      logger.info("Multi-hop trade submitted", {
        userId,
        txHash: submitted.hash,
        hops: bestPath.hops,
      });

      return this.createSuccessResult("multi_hop_execute", {
        txHash: submitted.hash,
        successful: submitted.successful,
        ledger: submitted.ledger,
        route: bestPath.route,
        hops: bestPath.hops,
        sourceAmount: bestPath.sourceAmount,
        destinationAmount: bestPath.destinationAmount,
        efficiency: bestPath.efficiency,
        policyApplied: policy,
      });
    } catch (err) {
      return this.handlePathError(err, "multi_hop_execute");
    }
  }

  /**
   * Handle path finding errors including policy violations
   * @param err - The error object
   * @param action - The action being performed
   * @returns ToolResult with error details
   */
  private handlePathError(err: unknown, action: string): ToolResult {
    if (err instanceof RoutePolicyViolationError) {
      logger.warn("Route policy violation", { reason: err.message });
      return this.createErrorResult(action, err.message, {
        policyViolation: true,
        bestAvailablePath: this.serializePath(err.bestAvailable),
      });
    }
    logger.error("Multi-hop trade failed", { err });
    return this.createErrorResult(
      action,
      err instanceof Error ? err.message : "Unknown error"
    );
  }

  /**
   * Serialize a TradePath to a plain object for response
   * @param path - The trade path to serialize
   * @returns Plain object with path details
   */
  private serializePath(path: TradePath): Record<string, unknown> {
    return {
      route: path.route,
      hops: path.hops,
      sourceAmount: path.sourceAmount,
      destinationAmount: path.destinationAmount,
      priceImpact: `${path.priceImpact.toFixed(2)}%`,
      estimatedSlippage: `${(path.estimatedSlippage * 100).toFixed(3)}%`,
      efficiency: path.efficiency,
    };
  }

  /**
   * Get Stellar keypair for a user from stored accounts
   * @param userId - The user ID
   * @returns Stellar keypair
   * @throws Error if account not found
   */
  private getKeypair(userId: string): StellarSdk.Keypair {
    const accounts = accountsData as StellarAccountData[];
    const account = accounts.find((a) => a.userId === userId);
    if (!account)
      throw new Error(`Stellar account not found for user: ${userId}`);
    return StellarSdk.Keypair.fromSecret(account.secretKey);
  }
}

export const multiHopTradeTool = new MultiHopTradeTool();
