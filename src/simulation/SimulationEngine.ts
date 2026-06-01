import {
  SimulationConfig,
  SimulationRequest,
  SimulationResponse,
  SimulationMode,
  FailureInjection,
} from "./types";
import { StateManager } from "./StateManager";
import { ResponseGenerator } from "./ResponseGenerator";
import { GasSimulator } from "./GasSimulator";
import { SeededRNG } from "./SeededRNG";
import logger from "../config/logger";

export class SimulationEngine {
  private config!: SimulationConfig;
  private stateManager: StateManager;
  private responseGenerator: ResponseGenerator;
  private gasSimulator: GasSimulator;
  private initialized = false;
  private rng: SeededRNG;

  constructor() {
    this.stateManager = new StateManager();
    this.responseGenerator = new ResponseGenerator();
    this.gasSimulator = new GasSimulator();
    this.rng = new SeededRNG(Date.now());
  }

  async initialize(config: SimulationConfig): Promise<void> {
    this.config = config;

    await this.stateManager.initialize(config);
    await this.responseGenerator.initialize(config);
    await this.gasSimulator.initialize(config);

    this.initialized = true;
    logger.info("Simulation engine initialized", { mode: config.mode });
  }

  async processRequest(
    request: SimulationRequest
  ): Promise<SimulationResponse> {
    if (!this.initialized) {
      throw new Error("Simulation engine not initialized");
    }

    // Set seed if provided for determinism
    if (request.seed !== undefined) {
      this.rng = new SeededRNG(request.seed);
    }

    const startTime = Date.now();
    const beforeSnapshot = this.stateManager.createSnapshot();

    try {
      // Handle failure injections
      if (request.failureInjections) {
        for (const failure of request.failureInjections) {
          if (this.shouldInjectFailure(failure)) {
            return this.handleInjectedFailure(failure, startTime);
          }
        }
      }

      // Generate realistic response based on service type
      let response;
      switch (request.service) {
        case "soroban":
          response = await this.responseGenerator.generateSorobanResponse(
            request,
            this.rng
          );
          break;
        case "wallet":
          response = await this.responseGenerator.generateWalletResponse(
            request,
            this.rng
          );
          break;
        case "swap":
          response = await this.responseGenerator.generateSwapResponse(
            request,
            this.rng
          );
          break;
        default:
          throw new Error(`Unsupported service: ${request.service}`);
      }

      // Estimate gas usage
      const gasEstimate = await this.gasSimulator.estimateGas(
        {
          service: request.service,
          operation: request.operation,
          parameters: request.parameters,
        },
        this.rng
      );

      // Track gas usage
      this.gasSimulator.trackGasUsage(
        request.userId,
        {
          service: request.service,
          operation: request.operation,
          parameters: request.parameters,
        },
        gasEstimate.estimatedGas
      );

      // Apply latency simulation
      await this.simulateLatency();

      const processingTime = Date.now() - startTime;
      const stateChanges = this.stateManager.getStateChanges(beforeSnapshot);

      return {
        success: true,
        data: response,
        metadata: {
          simulatedGas: gasEstimate.estimatedGas,
          processingTime,
          stateChanges,
        },
      };
    } catch (error) {
      logger.error("Simulation request failed", { error, request });
      return {
        success: false,
        data: null,
        metadata: {
          simulatedGas: 0,
          processingTime: Date.now() - startTime,
          stateChanges: [],
        },
      };
    }
  }

  private shouldInjectFailure(failure: FailureInjection): boolean {
    const prob = failure.probability ?? 1;
    return this.rng.next() < prob;
  }

  private async handleInjectedFailure(
    failure: FailureInjection,
    startTime: number
  ): Promise<SimulationResponse> {
    switch (failure.type) {
      case "latency": {
        const delay = failure.delayMs ?? 5000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        break;
      }
      case "error":
        return {
          success: false,
          data: { error: failure.errorCode || "INJECTED_FAILURE" },
          metadata: {
            simulatedGas: 0,
            processingTime: Date.now() - startTime,
            stateChanges: [],
          },
        };
    }

    // Default fallback (should not reach here if handled)
    return {
      success: false,
      data: null,
      metadata: { simulatedGas: 0, processingTime: 0, stateChanges: [] },
    };
  }

  private async simulateLatency(): Promise<void> {
    const { baseDelay, variability } = this.config.simulation.latency;
    const variance = ((this.rng.next() - 0.5) * 2 * variability) / 100;
    const delay = baseDelay * (1 + variance);

    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  async reset(
    resetType: "full" | "partial",
    preserveState?: string[]
  ): Promise<void> {
    await this.stateManager.reset(resetType, preserveState);
    await this.gasSimulator.resetGasTracking();
    logger.info("Simulation engine reset", { resetType });
  }

  getMetrics() {
    return {
      initialized: this.initialized,
      mode: this.config?.mode,
      // Add more metrics as needed
    };
  }

  isSimulationEnabled(serviceName: string): boolean {
    return (
      this.config?.mode === "local" ||
      (this.config?.mode === "hybrid" &&
        this.config.enabledServices.includes(serviceName))
    );
  }

  getSimulationMode(): SimulationMode {
    return this.config?.mode || "live";
  }

  // Public method to access gas simulator for testing
  getGasSimulator(): GasSimulator {
    return this.gasSimulator;
  }
}
