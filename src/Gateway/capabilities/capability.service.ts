import { toolRegistry } from "../../Agents/registry/ToolRegistry";
import { ToolDefinition } from "../../Agents/registry/ToolMetadata";
import { promptVersionManager } from "../../Agents/registry/PromptVersionManager";
import { contractMetadataRegistry } from "../../services/contracts/contractMetadataRegistry";
import { ContractMetadata, ContractBinding } from "../../services/contracts/contractMetadataRegistry";
import { UserRole, RoleHierarchy } from "../../Auth/roles";
import { ContractRegistryService } from "../../ContractRegistry/contractRegistry.service";
import { CapabilityCatalog, CapabilityCatalogQuery } from "../../../packages/sdk/src/capability/capabilityCatalog";

export class CapabilityService {
  private contractRegistryService = new ContractRegistryService();

  async getCapabilities(query?: CapabilityCatalogQuery): Promise<CapabilityCatalog> {
    const tools = await this.getTools(query);
    const prompts = await this.getPrompts();
    const contracts = await this.getContracts();
    const policies = this.getPolicies();

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        totalTools: tools.length,
        totalPrompts: prompts.length,
        totalContracts: contracts.length,
        totalPolicies: policies.length,
      },
      tools,
      prompts,
      contracts,
      policies,
    };
  }

  async getTools(query?: CapabilityCatalogQuery): Promise<import("../../../packages/sdk/src/capability/capabilityCatalog").ToolCapabilitySummary[]> {
    let allTools: ToolDefinition[] = toolRegistry.getAllTools();

    if (query?.category) {
      allTools = allTools.filter((tool) => tool.metadata.category === query.category);
    }

    if (query?.search) {
      const lowerSearch = query.search.toLowerCase();
      allTools = allTools.filter(
        (tool) =>
          tool.metadata.name.toLowerCase().includes(lowerSearch) ||
          tool.metadata.description.toLowerCase().includes(lowerSearch)
      );
    }

    if (!query?.includeDeprecated) {
      allTools = allTools.filter((tool) => !tool.metadata.deprecated);
    }

    return allTools.map((tool) => this.mapToolToSummary(tool));
  }

  async getPrompts(): Promise<import("../../../packages/sdk/src/capability/capabilityCatalog").PromptCapabilitySummary[]> {
    try {
      const versions = await promptVersionManager.listVersions();
      return versions.map((v) => ({
        id: v.id,
        name: v.name,
        type: v.type,
        version: v.version,
        isActive: v.isActive,
        weight: v.weight,
      }));
    } catch {
      return [];
    }
  }

  async getContracts(): Promise<import("../../../packages/sdk/src/capability/capabilityCatalog").ContractCapabilitySummary[]> {
    let contracts: ContractMetadata[] = [];
    try {
      contracts = contractMetadataRegistry.listContracts();
    } catch {
      // ignore
    }

    const dbContracts = await this.contractRegistryService.list().catch(() => [] as any[]);

    return contracts.map((contract) => ({
      key: contract.key,
      displayName: contract.displayName,
      version: contract.version,
      capabilities: contract.capabilities,
      bindings: contract.bindings.map((binding: ContractBinding) => ({
        environment: binding.environment,
        address: binding.address,
        enabled: binding.enabled,
      })),
    }));
  }

  getPolicies(): import("../../../packages/sdk/src/capability/capabilityCatalog").PolicyCapabilitySummary[] {
    return Object.values(UserRole).map((role) => ({
      role,
      level: RoleHierarchy[role],
      description: this.getRoleDescription(role),
    }));
  }

  private mapToolToSummary(tool: ToolDefinition): import("../../../packages/sdk/src/capability/capabilityCatalog").ToolCapabilitySummary {
    const metadata = tool.metadata;
    return {
      name: metadata.name,
      description: metadata.description,
      category: metadata.category,
      version: metadata.version,
      riskLevel: metadata.riskLevel,
      capabilities: metadata.capabilities,
      deprecated: metadata.deprecated,
      parameters: metadata.parameters as Record<string, import("../../../packages/sdk/src/capability/capabilityCatalog").ParameterDefinition>,
    };
  }

  private getRoleDescription(role: UserRole): string {
    switch (role) {
      case UserRole.ADMIN:
        return "Full system access including governance and administration";
      case UserRole.MODERATOR:
        return "Elevated access for content and user management";
      case UserRole.USER:
        return "Standard user access to core features";
      default:
        return "";
    }
  }
}

export const capabilityService = new CapabilityService();
