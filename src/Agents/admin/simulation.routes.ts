import { Router, Request, Response } from "express";
import { authenticateToken } from "../../Auth/auth.middleware";
import { requireAdmin } from "../../Gateway/middleware/rbac.middleware";
import { SimulationEngine } from "../../simulation/SimulationEngine";
import { SimulationConfig, SimulationMode } from "../../simulation/types";
import logger from "../../config/logger";

const router = Router();
const simulationEngine = new SimulationEngine();

// Default simulation config for the engine
const DEFAULT_SIM_CONFIG: SimulationConfig = {
  mode: SimulationMode.DRY_RUN,
  simulation: {
    latency: { baseDelay: 100, variability: 20 },
    errorRate: 0.05,
  },
  stellar: {
    network: "testnet",
    defaultAccounts: [],
  },
  starknet: {
    network: "goerli",
    defaultAccounts: [],
  },
};

/**
 * POST /api/admin/simulation/run
 * Run a deterministic simulation dry-run
 */
router.post(
  "/run",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { request, config } = req.body;

      if (!simulationEngine["initialized"]) {
        await simulationEngine.initialize(config || DEFAULT_SIM_CONFIG);
      }

      const result = await simulationEngine.processRequest(request);

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error("Simulation run failed", { error });
      return res.status(500).json({
        success: false,
        message: "Simulation execution failed",
      });
    }
  }
);

/**
 * POST /api/admin/simulation/failure-injection
 * Test system resilience with failure injection simulation
 */
router.post(
  "/failure-injection",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { request, failureInjections } = req.body;

      if (!simulationEngine["initialized"]) {
        await simulationEngine.initialize(DEFAULT_SIM_CONFIG);
      }

      const simRequest = {
        ...request,
        failureInjections,
      };

      const result = await simulationEngine.processRequest(simRequest);

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error("Failure injection simulation failed", { error });
      return res.status(500).json({
        success: false,
        message: "Failure injection simulation failed",
      });
    }
  }
);

export default router;
