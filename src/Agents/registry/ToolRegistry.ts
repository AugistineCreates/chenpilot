import {
  ToolDefinition,
  ToolMetadata,
  ToolRegistryEntry,
  ToolPayload,
  ToolResult,
} from "./ToolMetadata";
import { withTimeout } from "../../utils/timeout";
import config from "../../config/config";
import logger from "../../config/logger";
import { UserRole } from "../../Auth/roles";
import { AppDataSource } from "../../config/Datasource";
import { User } from "../../Auth/user.entity";

export class ToolRegistry {
  // name -> version -> Entry
  private tools: Map<string, Map<string, ToolRegistryEntry>> = new Map();
  private categories: Set<string> = new Set();

  /**
   * Register a new tool with the registry
   */
  register<T extends ToolPayload>(tool: ToolDefinition<T>): void {
    const { metadata } = tool;
    const name = metadata.name;
    const version = metadata.version;

    this.validateToolMetadata(metadata);

    if (!this.tools.has(name)) {
      this.tools.set(name, new Map());
    }

    const versionMap = this.tools.get(name)!;
    if (versionMap.has(version)) {
      throw new Error(`Tool '${name}' version '${version}' is already registered`);
    }

    versionMap.set(version, {
      name,
      version,
      definition: tool as ToolDefinition,
      enabled: true,
      registeredAt: new Date(),
    });

    this.categories.add(metadata.category);
    logger.info(`Registered tool: ${name}@${version}`);
  }

  /**
   * Register a custom tool dynamically
   */
  registerCustomTool<T extends ToolPayload>(
    tool: ToolDefinition<T>,
    options?: {
      overwrite?: boolean;
      namespace?: string;
    }
  ): void {
    const { metadata } = tool;
    let toolName = metadata.name;

    if (options?.namespace) {
      toolName = `${options.namespace}:${toolName}`;
      tool = {
        ...tool,
        metadata: { ...metadata, name: toolName },
      };
    }

    const version = tool.metadata.version;
    this.validateToolMetadata(tool.metadata);

    if (!this.tools.has(toolName)) {
      this.tools.set(toolName, new Map());
    }

    const versionMap = this.tools.get(toolName)!;
    if (versionMap.has(version) && !options?.overwrite) {
      throw new Error(
        `Tool '${toolName}' version '${version}' is already registered. Use overwrite option.`
      );
    }

    versionMap.set(version, {
      name: toolName,
      version,
      definition: tool as ToolDefinition,
      enabled: true,
      registeredAt: new Date(),
    });

    this.categories.add(tool.metadata.category);
  }

  /**
   * Unregister a tool version or all versions
   */
  unregister(toolName: string, version?: string): boolean {
    if (!version) {
      return this.tools.delete(toolName);
    }
    const versionMap = this.tools.get(toolName);
    if (versionMap) {
      return versionMap.delete(version);
    }
    return false;
  }

  /**
   * Get a tool by name and optionally version
   */
  getTool(toolName: string, version?: string): ToolDefinition | undefined {
    // Check if toolName includes @version
    if (!version && toolName.includes("@")) {
      [toolName, version] = toolName.split("@");
    }

    const versionMap = this.tools.get(toolName);
    if (!versionMap) return undefined;

    if (version) {
      const entry = versionMap.get(version);
      return entry?.enabled ? entry.definition : undefined;
    }

    // Default to latest version (simple string sort for now)
    const versions = Array.from(versionMap.keys()).sort();
    const latestVersion = versions[versions.length - 1];
    const entry = versionMap.get(latestVersion);
    return entry?.enabled ? entry.definition : undefined;
  }

  /**
   * Get all registered tools (latest versions only by default)
   */
  getAllTools(includeAllVersions = false): ToolDefinition[] {
    const allTools: ToolDefinition[] = [];
    
    for (const [name, versionMap] of this.tools.entries()) {
      if (includeAllVersions) {
        for (const entry of versionMap.values()) {
          if (entry.enabled) allTools.push(entry.definition);
        }
      } else {
        const latest = this.getTool(name);
        if (latest) allTools.push(latest);
      }
    }
    
    return allTools;
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string): ToolDefinition[] {
    return this.getAllTools().filter(
      (tool) => tool.metadata.category === category
    );
  }

  /**
   * Get all available categories
   */
  getCategories(): string[] {
    return Array.from(this.categories);
  }

  /**
   * Execute a tool with governance checks
   */
  async executeTool(
    toolName: string,
    payload: ToolPayload,
    userId: string,
    timeoutMs?: number
  ): Promise<ToolResult> {
    let actualToolName = toolName;
    let version: string | undefined;

    if (toolName.includes("@")) {
      [actualToolName, version] = toolName.split("@");
    }

    const versionMap = this.tools.get(actualToolName);
    if (!versionMap) {
      throw new ToolExecutionError(`Tool '${actualToolName}' not found`);
    }

    // Resolve version
    let entry: ToolRegistryEntry | undefined;
    if (version) {
      entry = versionMap.get(version);
    } else {
      const versions = Array.from(versionMap.keys()).sort();
      const latestVersion = versions[versions.length - 1];
      entry = versionMap.get(latestVersion);
    }

    if (!entry || !entry.enabled) {
      throw new ToolExecutionError(`Tool '${actualToolName}${version ? "@" + version : ""}' not found or disabled`);
    }

    const tool = entry.definition;

    // Governance: Deprecation check
    if (tool.metadata.deprecated) {
      const warning = `Tool '${actualToolName}' is deprecated. Please migrate to '${tool.metadata.replacementTool || "latest version"}'.`;
      logger.warn(warning, { toolName: actualToolName, userId });
    }

    // Governance: Authorization check
    await this.authorizeTool(tool, userId);

    // Validate payload
    if (tool.validate) {
      const validation = tool.validate(payload);
      if (!validation.valid) {
        throw new ToolExecutionError(
          `Invalid payload for tool '${actualToolName}': ${validation.errors.join(", ")}`
        );
      }
    }

    const timeout = timeoutMs || config.agent.timeouts.toolExecution;
    logger.info("Governed tool execution starting", { 
      toolName: actualToolName, 
      version: entry.version, 
      userId, 
      riskLevel: tool.metadata.riskLevel 
    });

    try {
      const result = await withTimeout(tool.execute(payload, userId), {
        timeoutMs: timeout,
        operation: `Tool execution: ${actualToolName}@${entry.version}`,
      });

      entry.lastUsed = new Date();
      return result;
    } catch (error) {
      const toolError = new ToolExecutionError(
        error instanceof Error ? error.message : "Unknown error"
      );
      toolError.toolName = actualToolName;
      toolError.payload = payload;
      toolError.userId = userId;
      throw toolError;
    }
  }

  /**
   * Authorize user for tool execution
   */
  private async authorizeTool(tool: ToolDefinition, userId: string): Promise<void> {
    const requiredPermissions = tool.metadata.permissions;
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return;
    }

    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { userId } });

    if (!user) {
      throw new ToolExecutionError(`User ${userId} not found for authorization`);
    }

    const userRole = user.role as UserRole;
    
    for (const permission of requiredPermissions) {
      if (permission === "admin" && userRole !== UserRole.ADMIN) {
        throw new ToolExecutionError(`Insufficient permissions for tool ${tool.metadata.name}: requires admin`);
      }
      if (permission === "moderator" && (userRole !== UserRole.MODERATOR && userRole !== UserRole.ADMIN)) {
        throw new ToolExecutionError(`Insufficient permissions for tool ${tool.metadata.name}: requires moderator`);
      }
    }
  }

  /**
   * Get tool metadata for prompt generation
   */
  getToolMetadata(): ToolMetadata[] {
    return this.getAllTools().map((tool) => tool.metadata);
  }

  /**
   * Search tools by name or description
   */
  searchTools(query: string): ToolDefinition[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllTools().filter(
      (tool) =>
        tool.metadata.name.toLowerCase().includes(lowerQuery) ||
        tool.metadata.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Validate tool metadata structure
   */
  private validateToolMetadata(metadata: ToolMetadata): void {
    if (!metadata.name || typeof metadata.name !== "string") {
      throw new Error("Tool metadata must have a valid name");
    }
    if (!metadata.version || typeof metadata.version !== "string") {
      throw new Error("Tool metadata must have a valid version");
    }
    if (!metadata.riskLevel) {
      throw new Error(`Tool '${metadata.name}' must have a riskLevel`);
    }
    if (!Array.isArray(metadata.capabilities)) {
      throw new Error(`Tool '${metadata.name}' must have a capabilities array`);
    }
    if (!metadata.description || typeof metadata.description !== "string") {
      throw new Error("Tool metadata must have a valid description");
    }
    if (!metadata.parameters || typeof metadata.parameters !== "object") {
      throw new Error("Tool metadata must have valid parameters");
    }
  }

  /**
   * Performs full registry validation to ensure metadata integrity
   * and capability consistency.
   */
  validateRegistry(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const tools = this.getAllTools(true);

    if (tools.length === 0) {
      errors.push("Registry is empty");
    }

    tools.forEach(tool => {
      try {
        this.validateToolMetadata(tool.metadata);
      } catch (err) {
        errors.push(`Metadata validation failed for ${tool.metadata.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }

      // Check for deprecation loops or missing replacements
      if (tool.metadata.deprecated && tool.metadata.replacementTool) {
        const replacement = this.getTool(tool.metadata.replacementTool);
        if (!replacement) {
          errors.push(`Tool ${tool.metadata.name} refers to missing replacement: ${tool.metadata.replacementTool}`);
        }
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// Custom error class for tool execution errors
export class ToolExecutionError extends Error {
  public toolName: string = "";
  public payload: Record<string, unknown> = {};
  public userId: string = "";

  constructor(message: string) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

export const toolRegistry = new ToolRegistry();
