import { Router, Request, Response } from "express";
import { authenticateToken } from "../../Auth/auth.middleware";
import { requireAdmin } from "../../Gateway/middleware/rbac.middleware";
import { experimentService } from "../experiment/experiment.service";
import { ExperimentType } from "../experiment/experiment.entity";

const router = Router();

/**
 * GET /api/admin/experiments
 * List all experiments
 */
router.get(
  "/",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { type } = req.query;
      const experiments = await experimentService.getActiveExperiments(
        type as ExperimentType
      );
      return res.status(200).json({ success: true, data: experiments });
    } catch (error) {
      console.error("Failed to fetch experiments", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch experiments" });
    }
  }
);

/**
 * POST /api/admin/experiments
 * Create a new experiment
 */
router.post(
  "/",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const experiment = await experimentService.createExperiment(req.body);
      return res.status(201).json({ success: true, data: experiment });
    } catch (error) {
      console.error("Failed to create experiment", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to create experiment" });
    }
  }
);

/**
 * GET /api/admin/experiments/:id/results
 * Get results for an experiment
 */
router.get(
  "/:id/results",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const results = await experimentService.getExperimentResults(
        req.params.id
      );
      return res.status(200).json({ success: true, data: results });
    } catch (error) {
      console.error("Failed to fetch results", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch results" });
    }
  }
);

export default router;
