import { SimulationConfig, SimulationRequest, SimulationResponse, SimulationMode } from './types';
import { StateManager } from './StateManager';
import { ResponseGenerator } from './ResponseGenerator';
import { GasSimulator } from './GasSimulator';
import logger from '../config/logger';

export class SimulationEngine {
  private config!: SimulationConfig;
  private stateManager: StateManager;
  private responseGenerator: ResponseGenerator;
  private gasSimulator: GasSimulator;
  private initialized = false;
  private randomState = 1;

  constructor() {
    this.stateManager = new StateManager();
    this.responseGenerator = new ResponseGenerator();
    this.gasSimulator = new GasSimulator();
  }

  async initialize(config: SimulationConfig): Promise<void> {
    this.config = config;
    this.randomState = config.deterministicSeed || 1;
    
    await this.stateManager.initialize(config);
    await this.responseGenerator.initialize(config);
    await this.gasSimulator.initialize(config);
    
    this.initialized = true;
    logger.info('Simulation engine initialized', { mode: config.mode });
  }

  async processRequest(request: SimulationRequest): Promise<SimulationResponse> {
    if (!this.initialized) {
      throw new Error('Simulation engine not initialized');
    }

    const startTime = Date.now();
    const originalRandom = Math.random;

    if (this.config.deterministicSeed !== undefined) {
      Math.random = () => this.nextRandom();
    }
    
    try {
      // Generate realistic response based on service type
      let response;
      switch (request.service) {
        case 'soroban':
          response = await this.responseGenerator.generateSorobanResponse(request);
          break;
        case 'wallet':
          response = await this.responseGenerator.generateWalletResponse(request);
          break;
        case 'swap':
          response = await this.responseGenerator.generateSwapResponse(request);
          break;
        default:
          throw new Error(`Unsupported service: ${request.service}`);
      }

      // Estimate gas usage
      const gasEstimate = await this.gasSimulator.estimateGas({
        service: request.service,
        operation: request.operation,
        parameters: request.parameters
      });

      // Track gas usage
      this.gasSimulator.trackGasUsage(request.userId, {
        service: request.service,
        operation: request.operation,
        parameters: request.parameters
      }, gasEstimate.estimatedGas);

      // Apply latency simulation
      await this.simulateLatency();

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        data: response,
        metadata: {
          simulatedGas: gasEstimate.estimatedGas,
          processingTime,
          stateChanges: [] // Will be populated by state manager
        }
      };

    } catch (error) {
      logger.error('Simulation request failed', { error, request });
      return {
        success: false,
        data: null,
        metadata: {
          simulatedGas: 0,
          processingTime: Date.now() - startTime,
          stateChanges: []
        }
      };
    } finally {
      Math.random = originalRandom;
    }
  }

  private nextRandom(): number {
    this.randomState = (this.randomState * 1664525 + 1013904223) % 4294967296;
    return this.randomState / 4294967296;
  }

  private async simulateLatency(): Promise<void> {
    const { baseDelay, variability } = this.config.simulation.latency;
    const variance = (Math.random() - 0.5) * 2 * variability / 100;
    const delay = baseDelay * (1 + variance);
    
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  async reset(resetType: 'full' | 'partial', preserveState?: string[]): Promise<void> {
    await this.stateManager.reset(resetType, preserveState);
    await this.gasSimulator.resetGasTracking();
    logger.info('Simulation engine reset', { resetType });
  }

  getMetrics() {
    return {
      initialized: this.initialized,
      mode: this.config?.mode,
      // Add more metrics as needed
    };
  }

  isSimulationEnabled(serviceName: string): boolean {
    return this.config?.mode === 'local' || 
           (this.config?.mode === 'hybrid' && this.config.enabledServices.includes(serviceName));
  }

  getSimulationMode(): SimulationMode {
    return this.config?.mode || 'live';
  }

  // Public method to access gas simulator for testing
  getGasSimulator(): GasSimulator {
    return this.gasSimulator;
  }
}
