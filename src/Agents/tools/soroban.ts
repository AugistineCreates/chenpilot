import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import {
  invokeContract,
  InvokeContractParams,
  SorobanNetwork,
} from "../../services/sorobanService";
import { transactionLifecycleService } from "../../transactions/TransactionLifecycle.service";

interface SorobanInvokePayload extends Record<string, unknown> {
  network?: SorobanNetwork;
  rpcUrl?: string;
  contractId: string;
  method: string;
  args?: unknown[];
  source?: {
    publicKey?: string;
    secretKey?: string;
  };
  fee?: number;
  timeoutMs?: number;
}

/**
 * Tool for invoking Soroban smart contracts (read-only simulation)
 */
export class SorobanTool extends BaseTool<SorobanInvokePayload> {
  metadata: ToolMetadata = {
    name: "soroban_invoke",
    description: "Invoke Soroban smart contracts (read-only simulation)",
    parameters: {
      network: {
        type: "string",
        description: "Soroban network to use",
        required: false,
        enum: ["testnet", "mainnet"],
      },
      rpcUrl: {
        type: "string",
        description: "Override Soroban RPC URL",
        required: false,
      },
      contractId: {
        type: "string",
        description: "Soroban contract ID (starts with C...)",
        required: true,
      },
      method: {
        type: "string",
        description: "Contract function name to call",
        required: true,
      },
      args: {
        type: "array",
        description: "Arguments for the contract method",
        required: false,
      },
      source: {
        type: "object",
        description: "Optional source account info",
        required: false,
      },
      fee: {
        type: "number",
        description: "Optional fee override",
        required: false,
        min: 0,
      },
      timeoutMs: {
        type: "number",
        description: "Optional timeout override in milliseconds",
        required: false,
        min: 0,
      },
    },
    examples: [
      "Invoke soroban contract CABC... method stake args [100] on testnet",
      "Call contract method claim on mainnet for CXYZ...",
      'Borrow from contract CABC... method borrow args ["USDC", 50]',
    ],
    category: "soroban",
    version: "1.0.0",
    riskLevel: "high",
    capabilities: ["soroban_invocation"],
    permissions: ["user"],
  };

  /**
   * Execute a Soroban smart contract invocation
   * @param payload - The invocation payload with contract ID, method, and arguments
   * @param userId - The user invoking the contract
   * @returns ToolResult with invocation result
   */
  async execute(payload: SorobanInvokePayload, userId: string): Promise<ToolResult> {
    const lifecycle = await transactionLifecycleService.create(
      userId,
      "soroban",
      { contractId: payload.contractId, method: payload.method, network: payload.network }
    );

    try {
      const params: InvokeContractParams = {
        network: payload.network || "testnet",
        rpcUrl: payload.rpcUrl,
        contractId: payload.contractId,
        method: payload.method,
        args: payload.args,
        source: payload.source,
        fee: payload.fee,
        timeoutMs: payload.timeoutMs,
      };

      // Simulation phase
      await transactionLifecycleService.transition(lifecycle.id, "simulating");

      // Execution phase (invokeContract runs simulation + optional signing)
      await transactionLifecycleService.transition(lifecycle.id, "executing");

      const result = await invokeContract(params);

      await transactionLifecycleService.transition(lifecycle.id, "confirmed", {
        metadata: { contractId: params.contractId, method: params.method },
      });

      return this.createSuccessResult("soroban_invoke", {
        payload: params,
        result,
        lifecycleId: lifecycle.id,
      });
    } catch (error) {
      await transactionLifecycleService.fail(
        lifecycle.id,
        error instanceof Error ? error.message : "Unknown error"
      );
      return this.createErrorResult(
        "soroban_invoke",
        `Soroban invocation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        { payload }
      );
    }
  }
}

export const sorobanTool = new SorobanTool();
