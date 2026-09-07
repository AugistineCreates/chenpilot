import { WorkflowPlan, WorkflowStep } from "../types";

export const SOROBAN_INVOKE_ACTION = "soroban_invoke";

// Path payment keywords — handled before LLM to reduce latency and cost
const PATH_PAYMENT_KEYWORDS = [
  "path payment",
  "path pay",
  "multi-hop",
  "route payment",
  "find path",
];
const LIQUIDITY_POOL_KEYWORDS = [
  "pool stats",
  "pool id",
  "liquidity pool",
  "amm pool",
  "pool apr",
];



const METHOD_KEYWORDS = ["stake", "unstake", "lend", "borrow"];

export function parseSorobanIntent(input: string): WorkflowPlan | null {
  const text = input.toLowerCase();

  // Fast-path: liquidity pool stats by pool ID
  if (LIQUIDITY_POOL_KEYWORDS.some((k) => text.includes(k))) {
    const poolIdMatch = input.match(/\b([0-9a-f]{64})\b/i);
    if (poolIdMatch) {
      return {
        workflow: [
          {
            action: "get_liquidity_pool_stats",
            payload: { poolId: poolIdMatch[1].toLowerCase() },
          },
        ],
      };
    }
  }

  // Fast-path: path payment intent — delegate to swap_tool with path flag
  if (PATH_PAYMENT_KEYWORDS.some((k) => text.includes(k))) {
    const amountMatch = input.match(/(\d+(?:\.\d+)?)/);
    const fromMatch = input.match(/\b(XLM|USDC|USDT)\b/i);
    const toMatch = input.match(/\b(XLM|USDC|USDT)\b/gi);
    const slippageMatch = input.match(/(\d+(?:\.\d+)?)\s*%\s*slippage/i);

    if (fromMatch && toMatch && toMatch.length >= 2) {
      const payload: Record<string, unknown> = {
        from: fromMatch[1].toUpperCase(),
        to: toMatch[toMatch.length - 1].toUpperCase(),
        amount: amountMatch ? parseFloat(amountMatch[1]) : 1,
        usePathPayment: true,
      };
      if (slippageMatch) {
        payload.slippage = parseFloat(slippageMatch[1]);
      }
      return { workflow: [{ action: "swap_tool", payload }] };
    }
  }

  const hasKeyword =
    text.includes("soroban") || text.includes("soroban_invoke");
  const contractIdMatch = input.match(/\bC[A-Z0-9]{10,}\b/);

  if (!hasKeyword && !contractIdMatch) {
    return null;
  }

  const network = text.includes("mainnet")
    ? "mainnet"
    : text.includes("testnet") || text.includes("test net")
      ? "testnet"
      : "testnet";

  const methodMatch =
    input.match(/\b(?:method|function|fn)\s+([a-zA-Z_][\w]*)/i) ||
    input.match(/\b(?:call|invoke)\s+(?:contract\s+)?([a-zA-Z_][\w]*)/i);

  let method = methodMatch ? methodMatch[1] : undefined;
  if (method && method.startsWith("C")) {
    method = undefined;
  }
  if (!method) {
    const keywordMethod = METHOD_KEYWORDS.find((k) => text.includes(k));
    method = keywordMethod;
  }

  const args = extractJsonArray(input);

  const payload: Record<string, unknown> = {
    network,
  };

  if (contractIdMatch) payload.contractId = contractIdMatch[0];
  if (method) payload.method = method;
  if (args) payload.args = args;

  const step: WorkflowStep = {
    action: SOROBAN_INVOKE_ACTION,
    payload,
  };

  return { workflow: [step] };
}

function extractJsonArray(input: string): unknown[] | undefined {
  const index = input.toLowerCase().indexOf("args");
  const start = index >= 0 ? input.indexOf("[", index) : input.indexOf("[");

  if (start === -1) return undefined;

  let depth = 0;
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "[") depth += 1;
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        const raw = input.slice(start, i + 1);
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }

  return undefined;
}
