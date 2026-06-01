// Legacy types - kept for backward compatibility
export type SwapPayload = {
  from: string;
  to: string;
  amount: number;
};

export type TransferPayload = {
  to: string;
  amount: number;
};

export type supportedTokens = "STRK" | "ETH" | "DAI";

export type BalancePayload = {
  token: supportedTokens;
};

export type WorkflowStep = {
  action: string;
  payload: Record<string, unknown>;
};

export type WorkflowPlan = {
  workflow: WorkflowStep[];
};

// Legacy ToolResult interface - now superseded by registry types
export interface ToolResult {
  action: string;
  status: "success" | "error";
  message?: string;
  data?: Record<string, unknown>;
  error?: string;
}

// Legacy Tool interface - now superseded by registry types
export interface Tool {
  name: string;
  description: string;
  execute: (
    payload: Record<string, unknown>,
    userId: string
  ) => Promise<ToolResult>;
}
