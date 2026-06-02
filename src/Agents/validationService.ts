import { agentLLM } from "./agent";
import { memoryStore } from "./memory/memory";
import { promptGenerator } from "./registry/PromptGenerator";
import { toolAutoDiscovery } from "./registry/ToolAutoDiscovery";
import logger from "../config/logger";
import { WorkflowStep } from "./types";

let initialized = false;

export async function validateQuery(
  query: string,
  userId: string
): Promise<boolean> {
  if (!initialized) {
    await toolAutoDiscovery.initialize();
    initialized = true;
  }

  let validationPrompt = promptGenerator.generateValidationPrompt();
  const context = memoryStore.get(userId);

  validationPrompt = validationPrompt.replace(
    "{{CONTEXT}}",
    JSON.stringify(context)
  );
  logger.debug("Validating query", { userId, query });
  const result = await agentLLM.callLLM(userId, validationPrompt, query, false);
  const isValid = String(result).trim() === "1";
  logger.info("Query validation result", { userId, isValid });
  return isValid;
}

export interface DeFiValidationError {
  field: string;
  message: string;
  code: string;
}

export interface DeFiValidationResult {
  isValid: boolean;
  errors: DeFiValidationError[];
  warnings?: string[];
}

const SUPPORTED_TOKENS = ["XLM", "USDC", "USDT", "STRK", "ETH", "DAI"];
const DEFI_ACTIONS = [
  "swap",
  "swap_tool",
  "add_liquidity",
  "remove_liquidity",
  "lend",
  "borrow",
  "repay",
  "withdraw",
];

export function validateDeFiIntent(intent: WorkflowStep): DeFiValidationResult {
  const errors: DeFiValidationError[] = [];
  const warnings: string[] = [];
  const { action, payload } = intent;

  logger.debug("Validating DeFi intent", { action, payload });

  if (!DEFI_ACTIONS.includes(action)) {
    errors.push({
      field: "action",
      message: `Action '${action}' is not a recognized DeFi operation`,
      code: "INVALID_ACTION",
    });
    return { isValid: false, errors, warnings };
  }

  switch (action) {
    case "swap":
    case "swap_tool":
      validateSwapIntent(payload, errors, warnings);
      break;
    case "add_liquidity":
    case "remove_liquidity":
      validateLiquidityIntent(payload, action, errors, warnings);
      break;
    case "lend":
    case "borrow":
      validateLendingIntent(payload, action, errors, warnings);
      break;
    case "repay":
    case "withdraw":
      validateRepayWithdrawIntent(payload, action, errors, warnings);
      break;
    default:
      errors.push({
        field: "action",
        message: `Unsupported DeFi action: ${action}`,
        code: "UNSUPPORTED_ACTION",
      });
  }

  const isValid = errors.length === 0;
  logger.info("DeFi intent validation result", {
    action,
    isValid,
    errorCount: errors.length,
    warningCount: warnings.length,
  });

  return { isValid, errors, warnings };
}

function validateSwapIntent(
  payload: Record<string, unknown>,
  errors: DeFiValidationError[],
  warnings: string[]
): void {
  if (!payload.from || typeof payload.from !== "string") {
    errors.push({
      field: "from",
      message: "Source asset 'from' is required and must be a string",
      code: "MISSING_FROM_ASSET",
    });
  } else {
    const fromToken = (payload.from as string).toUpperCase();
    if (!SUPPORTED_TOKENS.includes(fromToken)) {
      errors.push({
        field: "from",
        message: `Unsupported source token '${payload.from}'. Supported tokens: ${SUPPORTED_TOKENS.join(", ")}`,
        code: "INVALID_FROM_TOKEN",
      });
    }
  }

  if (!payload.to || typeof payload.to !== "string") {
    errors.push({
      field: "to",
      message: "Destination asset 'to' is required and must be a string",
      code: "MISSING_TO_ASSET",
    });
  } else {
    const toToken = (payload.to as string).toUpperCase();
    if (!SUPPORTED_TOKENS.includes(toToken)) {
      errors.push({
        field: "to",
        message: `Unsupported destination token '${payload.to}'. Supported tokens: ${SUPPORTED_TOKENS.join(", ")}`,
        code: "INVALID_TO_TOKEN",
      });
    }
  }

  if (
    payload.from &&
    payload.to &&
    typeof payload.from === "string" &&
    typeof payload.to === "string"
  ) {
    if (payload.from.toUpperCase() === payload.to.toUpperCase()) {
      errors.push({
        field: "from,to",
        message: "Source and destination assets must be different",
        code: "SAME_ASSETS",
      });
    }
  }

  if (payload.amount === undefined || payload.amount === null) {
    errors.push({
      field: "amount",
      message: "Amount is required for swap operations",
      code: "MISSING_AMOUNT",
    });
  } else if (typeof payload.amount !== "number") {
    errors.push({
      field: "amount",
      message: "Amount must be a number",
      code: "INVALID_AMOUNT_TYPE",
    });
  } else if (payload.amount <= 0) {
    errors.push({
      field: "amount",
      message: "Amount must be greater than 0",
      code: "INVALID_AMOUNT_VALUE",
    });
  } else if (!Number.isFinite(payload.amount)) {
    errors.push({
      field: "amount",
      message: "Amount must be a finite number",
      code: "INVALID_AMOUNT_FINITE",
    });
  }

  if (typeof payload.amount === "number" && payload.amount > 10000) {
    warnings.push(
      `Large swap amount detected (${payload.amount}). Please verify this is correct.`
    );
  }

  if (payload.slippage !== undefined) {
    if (typeof payload.slippage !== "number") {
      errors.push({
        field: "slippage",
        message: "Slippage must be a number",
        code: "INVALID_SLIPPAGE_TYPE",
      });
    } else if (payload.slippage < 0 || payload.slippage > 100) {
      errors.push({
        field: "slippage",
        message: "Slippage must be between 0 and 100 (percentage)",
        code: "INVALID_SLIPPAGE_RANGE",
      });
    } else if (payload.slippage > 5) {
      warnings.push(
        `High slippage tolerance (${payload.slippage}%) may result in unfavorable swap rates.`
      );
    }
  }
}

function validateLiquidityIntent(
  payload: Record<string, unknown>,
  action: string,
  errors: DeFiValidationError[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _warnings: string[]
): void {
  if (!payload.tokenA || typeof payload.tokenA !== "string") {
    errors.push({
      field: "tokenA",
      message: "First token 'tokenA' is required for liquidity operations",
      code: "MISSING_TOKEN_A",
    });
  }

  if (!payload.tokenB || typeof payload.tokenB !== "string") {
    errors.push({
      field: "tokenB",
      message: "Second token 'tokenB' is required for liquidity operations",
      code: "MISSING_TOKEN_B",
    });
  }

  if (action === "add_liquidity") {
    if (
      !payload.amountA ||
      typeof payload.amountA !== "number" ||
      payload.amountA <= 0
    ) {
      errors.push({
        field: "amountA",
        message: "Valid amount for tokenA is required (must be > 0)",
        code: "INVALID_AMOUNT_A",
      });
    }

    if (
      !payload.amountB ||
      typeof payload.amountB !== "number" ||
      payload.amountB <= 0
    ) {
      errors.push({
        field: "amountB",
        message: "Valid amount for tokenB is required (must be > 0)",
        code: "INVALID_AMOUNT_B",
      });
    }
  }

  if (action === "remove_liquidity") {
    if (
      !payload.lpAmount ||
      typeof payload.lpAmount !== "number" ||
      payload.lpAmount <= 0
    ) {
      errors.push({
        field: "lpAmount",
        message:
          "Valid LP token amount is required for removing liquidity (must be > 0)",
        code: "INVALID_LP_AMOUNT",
      });
    }
  }
}

function validateLendingIntent(
  payload: Record<string, unknown>,
  action: string,
  errors: DeFiValidationError[],
  warnings: string[]
): void {
  if (!payload.token && !payload.asset) {
    errors.push({
      field: "token",
      message: `Token or asset is required for ${action} operations`,
      code: "MISSING_TOKEN",
    });
  }

  const token = payload.token || payload.asset;
  if (token && typeof token === "string") {
    const tokenUpper = token.toUpperCase();
    if (!SUPPORTED_TOKENS.includes(tokenUpper)) {
      errors.push({
        field: "token",
        message: `Unsupported token '${token}'. Supported tokens: ${SUPPORTED_TOKENS.join(", ")}`,
        code: "INVALID_TOKEN",
      });
    }
  }

  if (
    !payload.amount ||
    typeof payload.amount !== "number" ||
    payload.amount <= 0
  ) {
    errors.push({
      field: "amount",
      message: `Valid amount is required for ${action} operations (must be > 0)`,
      code: "INVALID_AMOUNT",
    });
  }

  if (action === "borrow") {
    if (!payload.collateral) {
      warnings.push(
        "No collateral specified. Ensure sufficient collateral is available."
      );
    }
    if (typeof payload.amount === "number" && payload.amount > 50000) {
      warnings.push(
        `Large borrow amount (${payload.amount}). Verify collateral requirements.`
      );
    }
  }
}

function validateRepayWithdrawIntent(
  payload: Record<string, unknown>,
  action: string,
  errors: DeFiValidationError[],
  warnings: string[]
): void {
  if (!payload.token && !payload.asset) {
    errors.push({
      field: "token",
      message: `Token or asset is required for ${action} operations`,
      code: "MISSING_TOKEN",
    });
  }

  if (
    !payload.amount ||
    typeof payload.amount !== "number" ||
    payload.amount <= 0
  ) {
    errors.push({
      field: "amount",
      message: `Valid amount is required for ${action} operations (must be > 0)`,
      code: "INVALID_AMOUNT",
    });
  }

  if (action === "repay" && !payload.debtId && !payload.positionId) {
    warnings.push(
      "No debt/position ID specified. Ensure the correct debt is being repaid."
    );
  }
}
