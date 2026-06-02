export type ParameterType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array";

export interface ParameterDefinition {
  type: ParameterType;
  description: string;
  required: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  pattern?: string;
}

export type ToolRiskLevel = "low" | "medium" | "high";

export interface ToolMetadata {
  name: string;
  description: string;
  parameters: Record<string, ParameterDefinition>;
  examples: string[];
  category: string;
  version: string;
  // Governance & Lifecycle
  deprecated?: boolean;
  deprecationDate?: string;
  replacementTool?: string; // name@version
  permissions?: string[];
  riskLevel: ToolRiskLevel;
  capabilities: string[];
  author?: string;
}

export interface ToolDefinition<T = Record<string, unknown>> {
  metadata: ToolMetadata;
  execute: (payload: T, userId: string) => Promise<ToolResult>;
  validate?: (payload: T) => { valid: boolean; errors: string[] };
}

export interface ToolResult {
  action: string;
  status: "success" | "error";
  message?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface ToolExecutionError extends Error {
  toolName: string;
  payload: Record<string, unknown>;
  userId: string;
}

export type ToolPayload = Record<string, unknown>;

export interface ToolRegistryEntry {
  name: string;
  version: string;
  definition: ToolDefinition;
  enabled: boolean;
  registeredAt: Date;
  lastUsed?: Date;
  governanceMetadata?: Record<string, any>;
}
