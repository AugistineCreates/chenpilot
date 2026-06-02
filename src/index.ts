import "reflect-metadata";
import http from "http";
import app from "./Gateway/api";
import config from "./config/config";
import AppDataSource from "./config/Datasource";
import logger from "./config/logger";
import { initializeSocketManager } from "./Gateway/socketManager";
import { horizonOperationStreamerService } from "./services/horizonOperationStreamer.service";
import { priceSpikeAlertService } from "./services/priceSpikeAlert.service";
import { durableRecoveryService } from "./Agents/planner/DurableRecoveryService";
import { durableOperationService } from "./Reliability/DurableOperationService";

class Server {
  private server: http.Server;
  private port: number;

  constructor() {
    this.port = config.port || 3000;
    this.server = http.createServer(app);
    // Initialize Socket.io manager
    initializeSocketManager(this.server);
  }

  public async start(): Promise<void> {
    try {
      horizonOperationStreamerService.onLargeOperation((alert) => {
        logger.info("Stellar large operation alert emitted", alert);
      });

      const shutdown = async () => {
        logger.info("Shutting down gracefully...");
        horizonOperationStreamerService.stop();
        priceSpikeAlertService.stop();
        await AppDataSource.destroy();
        this.server.close(() => {
          logger.info("Server closed");
          process.exit(0);
        });
      };
      console.log("Attempting to connect to DB...");
      await AppDataSource.initialize();
      console.log("DB connection established!");
      logger.info("Database connected successfully");
      
      // Recover interrupted durable executions
      await durableRecoveryService.recoverInterruptedExecutions();

      // Start durable operation background processor
      durableOperationService.startBackgroundProcessor();

      horizonOperationStreamerService.start();
      priceSpikeAlertService.start();
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);

      this.server.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          logger.warn(
            `Port ${this.port} in use, retrying on ${this.port + 1}...`
          );
          this.port += 1;
          this.start();
        } else {
          logger.error("Server error", {
            error: error.message,
            stack: error.stack,
          });
          process.exit(1);
        }
      });

      this.server.listen(this.port, () => {
        logger.info(`Server running on port ${this.port}`);
      });
    } catch (error) {
      logger.error("Error during server startup", { error });
      process.exit(1);
    }
  }
}

(async () => {
  const server = new Server();
  await server.start();
})();
