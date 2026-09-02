import { Router, Request, Response } from "express";
import { authenticateToken } from "../Auth/auth.middleware";
import { validateQuery } from "./middleware/validation";
import { horizonProxyService, HorizonProxyError } from "./horizonProxy.service";
import { HorizonProxyQueryDto } from "../validators/dto/HorizonProxyDto";
import logger from "../config/logger";

const router = Router();

router.get(
  "/proxy",
  authenticateToken,
  validateQuery(HorizonProxyQueryDto),
  async (req: Request, res: Response) => {
    try {
      const query = req.query as HorizonProxyQueryDto;
      const path = query.path;
      const queryParams = { ...req.query } as Record<
        string,
        string | string[] | undefined
      >;
      delete queryParams.path;

      const data = await horizonProxyService.proxyGet(path, queryParams);

      return res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Proxy request failed";

      logger.warn("Horizon proxy request failed", {
        error: message,
        userId: req.user?.userId,
        path: req.query.path,
      });

      if (error instanceof HorizonProxyError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Internal proxy error",
      });
    }
  }
);

export default router;
