export interface ToolCapabilitySummary {
  name: string;
  description: string;
  category: string;
  version: string;
  riskLevel: "low" | "medium" | "high";
  capabilities: string[];
  deprecated?: boolean;
  parameters: Record<string, ParameterDefinition>;
}

export interface PromptCapabilitySummary {
  id: string;
  name: string;
  type: string;
  version: string;
  isActive: boolean;
  weight: number;
}

export interface ContractCapabilitySummary {
  key: string;
  displayName: string;
  version: string;
  capabilities: { name: string; description: string; methods: string[] }[];
  bindings: { environment: string; address?: string; enabled: boolean }[];
}

export interface PolicyCapabilitySummary {
  role: string;
  level: number;
  description?: string;
}

export interface ParameterDefinition {
  type: string;
  description: string;
  required: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  pattern?: string;
}

export interface CapabilityCatalog {
  generatedAt: string;
  summary: {
    totalTools: number;
    totalPrompts: number;
    totalContracts: number;
    totalPolicies: number;
  };
  tools: ToolCapabilitySummary[];
  prompts: PromptCapabilitySummary[];
  contracts: ContractCapabilitySummary[];
  policies: PolicyCapabilitySummary[];
}

export interface CapabilityCatalogQuery {
  category?: string;
  search?: string;
  includeDeprecated?: boolean;
}
