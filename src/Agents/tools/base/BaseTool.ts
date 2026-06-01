import {
  ToolDefinition,
  ToolMetadata,
  ToolResult,
  ToolPayload,
} from "../../registry/ToolMetadata";

export abstract class BaseTool<
  T extends ToolPayload = ToolPayload,
> implements ToolDefinition<T> {
  abstract metadata: ToolMetadata;

  abstract execute(payload: T, userId: string): Promise<ToolResult>;

  /**
   * Default validation method - can be overridden by subclasses
   */
  validate?(payload: T): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const { parameters } = this.metadata;

    //  required params
    Object.entries(parameters).forEach(([paramName, paramDef]) => {
      if (paramDef.required && !(paramName in payload)) {
        errors.push(`Missing required parameter: ${paramName}`);
      }
    });

    // parameter types
    Object.entries(payload).forEach(([paramName, value]) => {
      const paramDef = parameters[paramName];
      if (paramDef) {
        const isValidType = this.validateParameterType(value, paramDef.type);
        if (!isValidType) {
          errors.push(
            `Invalid type for parameter '${paramName}': expected ${
              paramDef.type
            }, got ${typeof value}`
          );
        }
      }
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate parameter type
   */
  private validateParameterType(value: unknown, expectedType: string): boolean {
    switch (expectedType) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number" && !isNaN(value);
      case "boolean":
        return typeof value === "boolean";
      case "object":
        return (
          typeof value === "object" && value !== null && !Array.isArray(value)
        );
      case "array":
        return Array.isArray(value);
      default:
        return false;
    }
  }

  /**
   *  success result
   */
  protected createSuccessResult(
    action: string,
    data: Record<string, unknown> = {}
  ): ToolResult {
    return {
      action,
      status: "success",
      data,
    };
  }

  /**
   * error result
   */
  protected createErrorResult(
    action: string,
    error: string,
    data: Record<string, unknown> = {}
  ): ToolResult {
    return {
      action,
      status: "error",
      error,
      data,
    };
  }
}
