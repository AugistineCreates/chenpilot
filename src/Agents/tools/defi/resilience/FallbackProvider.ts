import { AdapterResult } from "../DeFiAdapter";

/**
 * Interface representing a fallback provider wrapper.
 */
export interface IFallbackProvider<T> {
  primary: T;
  secondary: T;
  executeWithFallback<R>(operation: (provider: T) => Promise<AdapterResult<R>>): Promise<AdapterResult<R>>;
}

/**
 * FallbackProvider implements routing logic that executes on a primary adapter,
 * and if that fails, automatically routes to a secondary adapter.
 */
export class FallbackProvider<T extends { getConfig(): { name: string } }> implements IFallbackProvider<T> {
  constructor(
    public primary: T,
    public secondary: T
  ) {}

  async executeWithFallback<R>(operation: (provider: T) => Promise<AdapterResult<R>>): Promise<AdapterResult<R>> {
    try {
      console.log(`[FallbackProvider] Routing operation to primary provider: ${this.primary.getConfig().name}`);
      const result = await operation(this.primary);
      if (result.success) {
        return result;
      }
      // If the adapter explicitly returned success: false, we also fallback if it has an error message
      console.warn(
        `[FallbackProvider] Primary provider ${this.primary.getConfig().name} returned failure: ${result.error}. Falling back to secondary: ${this.secondary.getConfig().name}`
      );
      return await operation(this.secondary);
    } catch (primaryError) {
      const errMsg = primaryError instanceof Error ? primaryError.message : String(primaryError);
      console.warn(
        `[FallbackProvider] Primary provider ${this.primary.getConfig().name} threw error: ${errMsg}. Falling back to secondary: ${this.secondary.getConfig().name}`
      );
      try {
        return await operation(this.secondary);
      } catch (secondaryError) {
        const secMsg = secondaryError instanceof Error ? secondaryError.message : String(secondaryError);
        console.error(
          `[FallbackProvider] Secondary provider ${this.secondary.getConfig().name} also failed. Error: ${secMsg}`
        );
        return {
          success: false,
          error: `Both primary and secondary providers failed. Primary: ${errMsg}. Secondary: ${secMsg}`,
          timestamp: new Date().toISOString(),
        };
      }
    }
  }
}
