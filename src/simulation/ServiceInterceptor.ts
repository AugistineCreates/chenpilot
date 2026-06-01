import { SimulationEngine } from "./SimulationEngine";
import { SimulationMode, SimulationRequest } from "./types";
import logger from "../config/logger";

export class ServiceInterceptor {
  private simulationEngine: SimulationEngine;
  private enabled = false;

  constructor(simulationEngine: SimulationEngine) {
    this.simulationEngine = simulationEngine;
  }

  enable(): void {
    this.enabled = true;
    logger.info("Service interceptor enabled");
  }

  disable(): void {
    this.enabled = false;
    logger.info("Service interceptor disabled");
  }

  async intercept<T>(
    serviceName: string,
    methodName: string,
    params: unknown[],
    originalMethod: (...args: unknown[]) => Promise<T>,
    userId: string = "default"
  ): Promise<T> {
    if (!this.enabled || !this.isSimulationEnabled(serviceName)) {
      // Pass through to original method
      return originalMethod(...params);
    }

    try {
      // Create simulation request
      const request: SimulationRequest = {
        service: serviceName as "soroban" | "wallet" | "swap",
        operation: methodName,
        parameters: this.extractParameters(params),
        userId,
        timestamp: Date.now(),
      };

      // Process through simulation engine
      const response = await this.simulationEngine.processRequest(request);

      if (!response.success) {
        throw new Error("Simulation failed");
      }

      logger.debug("Request intercepted and simulated", {
        service: serviceName,
        method: methodName,
        userId,
      });

      return response.data as T;
    } catch (error) {
      logger.error("Interception failed, falling back to live service", {
        error,
        service: serviceName,
        method: methodName,
      });

      // Fallback to original method on simulation failure
      return originalMethod(...params);
    }
  }

  isSimulationEnabled(serviceName: string): boolean {
    return this.simulationEngine.isSimulationEnabled(serviceName);
  }

  getSimulationMode(): SimulationMode {
    return this.simulationEngine.getSimulationMode();
  }

  private extractParameters(params: unknown[]): Record<string, unknown> {
    if (params.length === 0) return {};

    // If first parameter is an object, use it as parameters
    if (
      params.length === 1 &&
      typeof params[0] === "object" &&
      params[0] !== null
    ) {
      return params[0] as Record<string, unknown>;
    }

    // Otherwise, create indexed parameters
    const result: Record<string, unknown> = {};
    params.forEach((param, index) => {
      result[`param${index}`] = param;
    });

    return result;
  }
}

// Global interceptor instance
let globalInterceptor: ServiceInterceptor | null = null;

export function initializeInterceptor(
  simulationEngine: SimulationEngine
): ServiceInterceptor {
  globalInterceptor = new ServiceInterceptor(simulationEngine);
  return globalInterceptor;
}

export function getInterceptor(): ServiceInterceptor | null {
  return globalInterceptor;
}

// Decorator function for easy method interception
export function intercepted(serviceName: string, methodName?: string) {
  return function (
    target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const actualMethodName = methodName || propertyKey;

    descriptor.value = async function (...args: unknown[]) {
      const interceptor = getInterceptor();

      if (interceptor) {
        // Extract userId from context if available
        const userId = (this as { userId?: string }).userId || "default";

        return interceptor.intercept(
          serviceName,
          actualMethodName,
          args,
          originalMethod.bind(this),
          userId
        );
      }

      // No interceptor, call original method
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}
