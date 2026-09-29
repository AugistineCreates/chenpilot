export type ParameterType =
  "string" | "number" | "boolean" | "object" | "array";

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

/**
 * Default-deny egress manifest for a tool. When present, every outbound
 * request the tool makes is routed through the egress layer, which enforces
 * this allowlist plus loopback/link-local/private/metadata/IPv6 address
 * denial, DNS-rebinding defence-in-depth, and redirect re-validation.
 */
export interface ToolEgressConfig {
  /** Permitted hosts; supports exact, `*.suffix`, and `*` (all public FQDNs). */
  allowedHosts: string[];
  /** Permitted URL schemes, e.g. ["https", "http"]. */
  allowedProtocols: string[];
  /** Maximum concurrent outbound requests. */
  maxConcurrentRequests?: number;
  /** Request budget (time + redirect depth). */
  budget?: {
    timeLimitMs?: number;
    maxRedirects?: number;
  };
}

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
  /** Declares permitted outbound destinations enforced by the egress layer. */
  egress?: ToolEgressConfig;
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
  /** Machine-readable error category (TRANSPORT, VALIDATION, SIMULATION, POLICY, COMPATIBILITY, EXECUTION, UNKNOWN) */
  errorCategory?: string;
  /** Machine-readable error code for the specific failure */
  errorCode?: string;
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
  governanceMetadata?: Record<string, unknown>;
}
