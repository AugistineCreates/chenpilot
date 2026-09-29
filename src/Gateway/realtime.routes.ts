import { Router, Request, Response } from "express";
import logger from "../config/logger";

const router = Router();

router.get("/stats", (req: Request, res: Response) => {
  try {
    const { getSocketManager } = require("./socketManager");
    const socketManager = getSocketManager();
    const stats = {
      success: true,
      totalConnected: socketManager.getConnectedClientsCount(),
      connectedClients: socketManager
        .getAllConnectedClients()
        .map(
          (client: {
            socketId: string;
            userId?: string;
            connectedAt: Date;
          }) => ({
            socketId: client.socketId,
            userId: client.userId || "anonymous",
            connectedAt: client.connectedAt,
          })
        ),
    };
    res.json(stats);
  } catch (error) {
    logger.error("Error retrieving Socket.io stats:", { error });
    res.status(500).json({
      success: false,
      error: "Failed to retrieve Socket.io statistics",
    });
  }
});

router.get("/user/:userId/clients", (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { getSocketManager } = require("./socketManager");
    const socketManager = getSocketManager();
    const clients = socketManager.getUserClients(userId);
    res.json({
      success: true,
      userId,
      connectedClients: clients.map(
        (client: { socketId: string; connectedAt: Date }) => ({
          socketId: client.socketId,
          connectedAt: client.connectedAt,
        })
      ),
      count: clients.length,
    });
  } catch (error) {
    logger.error("Error retrieving user clients:", { error });
    res.status(500).json({
      success: false,
      error: "Failed to retrieve user clients",
    });
  }
});

export default router;
