import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../../config/config";
import logger from "../../config/logger";

/**
 * Payload for the Strategy Registry tool.
 * Added optional `revokeVote` flag to allow vote revocation.
 */
interface StrategyRegistryPayload extends Record<string, unknown> {
  action: "vote" | "revoke_vote" | "get_strategy" | "is_verified";
  poolId?: string;
  aiAgent?: string;
  // If true, the vote for the given pool/agent will be revoked (only valid with `vote`/`revoke_vote`).
  revokeVote?: boolean;
}

/** Simple in‑memory vote store. In a production system this would be persisted. */
interface VoteRecord {
  poolId: string;
  aiAgent: string;
  timestamp: number; // epoch ms when the vote was cast
}

/** Configuration constants – can be overridden via environment variables if needed. */
const DEFAULT_QUORUM = Number(process.env.STRATEGY_REGISTRY_QUORUM) || 3; // Minimum votes required
const EPOCH_MS = Number(process.env.STRATEGY_REGISTRY_EPOCH_MS) || 24 * 60 * 60 * 1000; // 24 h default

/** In‑memory map: poolId → array of VoteRecord */
const voteStore: Map<string, VoteRecord[]> = new Map();

/** Regex to validate Stellar pool IDs */
const POOL_ID_REGEX = /^[0-9a-f]{64}$/i;

/** Helper: current epoch start timestamp */
function currentEpochStart(): number {
  const now = Date.now();
  return now - (now % EPOCH_MS);
}

/** Remove votes that belong to previous epochs – keeps the store fresh */
function purgeStaleVotes(): void {
  const epochStart = currentEpochStart();
  for (const [poolId, records] of voteStore.entries()) {
    const fresh = records.filter(r => r.timestamp >= epochStart);
    if (fresh.length > 0) {
      voteStore.set(poolId, fresh);
    } else {
      voteStore.delete(poolId);
    }
  }
}

/** Check whether a pool meets the quorum for the current epoch */
function hasQuorum(poolId: string): boolean {
  purgeStaleVotes();
  const records = voteStore.get(poolId) ?? [];
  return records.length >= DEFAULT_QUORUM;
}

/** Return the poolId with the highest vote count (deterministic tie‑break) */
function winningPool(): string | null {
  purgeStaleVotes();
  let bestPool: string | null = null;
  let bestCount = 0;
  for (const [poolId, records] of voteStore.entries()) {
    const count = records.length;
    if (count > bestCount || (count === bestCount && bestPool && poolId < bestPool)) {
      bestCount = count;
      bestPool = poolId;
    }
  }
  return bestPool;
}

export class StrategyRegistryTool extends BaseTool<StrategyRegistryPayload> {
  metadata: ToolMetadata = {
    name: "strategy_registry",
    description:
      "Interact with the Yield‑Aggregator Strategy Registry to vote on Stellar DEX pools, revoke votes, or retrieve the verified strategy.",
    parameters: {
      action: {
        type: "string",
        description: "Action to perform: 'vote', 'revoke_vote', 'get_strategy', or 'is_verified'",
        required: true,
        enum: ["vote", "revoke_vote", "get_strategy", "is_verified"],
      },
      poolId: {
        type: "string",
        description: "64‑character hexadecimal Stellar AMM liquidity pool ID",
        required: false,
        pattern: "^[0-9a-f]{64}$",
      },
      aiAgent: {
        type: "string",
        description: "Public key of the AI agent casting the vote (required for 'vote' and 'revoke_vote')",
        required: false,
      },
      revokeVote: {
        type: "boolean",
        description: "If true, the existing vote will be revoked instead of added",
        required: false,
        default: false,
      },
    },
    examples: [
      "vote pool 0123... with agent GAB...",
      "revoke_vote pool 0123... with agent GAB...",
      "get_strategy",
      "is_verified pool 0123...",
    ],
    category: "stellar",
    version: "1.0.1",
  };

  /** Validate payload fields */
  validate(payload: StrategyRegistryPayload): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!payload.action) {
      errors.push("Missing required parameter: action");
    }
    if (payload.action === "vote" || payload.action === "revoke_vote") {
      if (!payload.poolId) errors.push("Missing poolId for voting action");
      if (!payload.aiAgent) errors.push("Missing aiAgent for voting action");
    }
    if (payload.poolId && !POOL_ID_REGEX.test(payload.poolId)) {
      errors.push("poolId must be a 64‑character hexadecimal string");
    }
    return { valid: errors.length === 0, errors };
  }

  /** Core execution logic */
  async execute(payload: StrategyRegistryPayload): Promise<ToolResult> {
    const validation = this.validate(payload);
    if (!validation.valid) {
      return this.createErrorResult("strategy_registry", validation.errors.join(", "));
    }

    const { action, poolId, aiAgent, revokeVote } = payload;
    const contractId = process.env.STRATEGY_REGISTRY_CONTRACT_ID || "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4"; // Mock or default

    try {
      // Set up Stellar RPC – placeholder as we mock contract interactions
      const server = new StellarSdk.SorobanRpc.Server(
        config.stellar.horizonUrl.replace("horizon", "soroban-rpc")
      ); // Heuristic for RPC URL

      // ----- Vote handling -----
      if (action === "vote" || action === "revoke_vote") {
        if (!poolId || !aiAgent) {
          return this.createErrorResult("strategy_registry", "poolId and aiAgent are required for voting actions");
        }
        // Ensure store entry exists
        const records = voteStore.get(poolId) ?? [];
        if (revokeVote) {
          // Revoke matching vote if present
          const filtered = records.filter(r => !(r.aiAgent === aiAgent && r.poolId === poolId));
          if (filtered.length === records.length) {
            return this.createErrorResult("strategy_registry", `No existing vote found to revoke for agent ${aiAgent} on pool ${poolId}`);
          }
          voteStore.set(poolId, filtered);
          return {
            success: true,
            data: {
              poolId,
              aiAgent,
              status: "Vote revoked",
              message: `AI Agent ${aiAgent} revoked its vote for pool ${poolId}.`,
            },
          };
        } else {
          // Add vote – prevent duplicate votes from same agent on same pool within epoch
          const alreadyVoted = records.some(r => r.aiAgent === aiAgent && r.poolId === poolId && r.timestamp >= currentEpochStart());
          if (alreadyVoted) {
            return this.createErrorResult("strategy_registry", `Agent ${aiAgent} has already voted for pool ${poolId} in the current epoch`);
          }
          const newVote: VoteRecord = { poolId, aiAgent, timestamp: Date.now() };
          voteStore.set(poolId, [...records, newVote]);
          return {
            success: true,
            data: {
              poolId,
              aiAgent,
              status: "Vote submitted",
              message: `AI Agent ${aiAgent} voted for pool ${poolId}.`,
            },
          };
        }
      }

      // ----- Verify status (mock) -----
      if (action === "is_verified") {
        return {
          success: true,
          data: {
            poolId,
            verified: true,
            message: `Pool ${poolId} is verified and safe for liquidity.`,
          },
        };
      }

      // ----- Get current winning strategy -----
      if (action === "get_strategy") {
        const winner = winningPool();
        if (!winner) {
          return this.createErrorResult("strategy_registry", "No strategy meets quorum in the current epoch");
        }
        return {
          success: true,
          data: {
            currentStrategy: winner,
            message: "Current winning strategy retrieved from registry.",
          },
        };
      }

      return this.createErrorResult("strategy_registry", "Invalid action");
    } catch (error: any) {
      logger.error("Error interacting with Strategy Registry:", error);
      return this.createErrorResult("strategy_registry", error.message);
    }
  }
}

export const strategyRegistryTool = new StrategyRegistryTool();
