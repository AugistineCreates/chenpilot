/**
 * Base Command Contract Implementation
 * Provides reusable command contract infrastructure
 */

import {
  CommandContract,
  TypedCommandContext,
  TypedCommandResult,
  CommandMiddleware,
  CommandError,
  ErrorCode,
  Permission,
} from '../types.js';

/**
 * Base command contract with common functionality
 */
export abstract class BaseCommandContract<TInput, TOutput> implements CommandContract<TInput, TOutput> {
  abstract name: string;
  abstract description: string;
  abstract inputSchema?: any;
  abstract outputSchema?: any;
  abstract handler: (context: TypedCommandContext<TInput>) => Promise<TypedCommandResult<TOutput>>;

  middleware: CommandMiddleware<TInput>[] = [];
  permissions: Permission[] = [];
  rateLimit?: { maxRequests: number; windowMs: number };

  /**
   * Add middleware to the command
   */
  use(middleware: CommandMiddleware<TInput>): this {
    this.middleware.push(middleware);
    return this;
  }

  /**
   * Add permission requirement
   */
  requirePermission(permission: Permission): this {
    this.permissions.push(permission);
    return this;
  }

  /**
   * Set rate limit configuration
   */
  withRateLimit(maxRequests: number, windowMs: number): this {
    this.rateLimit = { maxRequests, windowMs };
    return this;
  }

  /**
   * Execute command with middleware chain
   */
  async execute(context: TypedCommandContext<TInput>): Promise<TypedCommandResult<TOutput>> {
    let index = 0;

    const executeNext = async (): Promise<TypedCommandResult<any>> => {
      if (index < this.middleware.length) {
        const middleware = this.middleware[index++];
        return middleware(context, executeNext);
      }
      return this.handler(context);
    };

    return executeNext();
  }

  /**
   * Create a success result
   */
  protected success(data: TOutput, next?: string): TypedCommandResult<TOutput> {
    return { success: true, data, next };
  }

  /**
   * Create an error result
   */
  protected error(
    code: ErrorCode,
    message: string,
    recoverable = false,
    details?: Record<string, any>
  ): TypedCommandResult<TOutput> {
    return {
      success: false,
      error: {
        code,
        message,
        recoverable,
        details,
      },
    };
  }
}

/**
 * Command contract builder
 */
export class CommandContractBuilder<TInput, TOutput> {
  private contract: Partial<CommandContract<TInput, TOutput>> = {};

  constructor(name: string) {
    this.contract.name = name;
  }

  description(desc: string): this {
    this.contract.description = desc;
    return this;
  }

  inputSchema(schema: any): this {
    this.contract.inputSchema = schema;
    return this;
  }

  outputSchema(schema: any): this {
    this.contract.outputSchema = schema;
    return this;
  }

  handler(handler: (context: TypedCommandContext<TInput>) => Promise<TypedCommandResult<TOutput>>): this {
    this.contract.handler = handler;
    return this;
  }

  middleware(mw: CommandMiddleware<TInput>[]): this {
    this.contract.middleware = mw;
    return this;
  }

  permissions(perms: Permission[]): this {
    this.contract.permissions = perms;
    return this;
  }

  rateLimit(maxRequests: number, windowMs: number): this {
    this.contract.rateLimit = { maxRequests, windowMs };
    return this;
  }

  build(): CommandContract<TInput, TOutput> {
    if (!this.contract.name || !this.contract.description || !this.contract.handler) {
      throw new Error('Command contract must have name, description, and handler');
    }
    return this.contract as CommandContract<TInput, TOutput>;
  }
}
