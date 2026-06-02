import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HTTPServer } from "http";
import logger from "../config/logger";
import { EventEmitter } from "events";
import { evaluateRealtimeAbusePolicy } from "../Security";

/**
 * Represents a connected client with metadata
 */
interface ConnectedClient {
  userId?: string;
  socketId: string;
  connectedAt: Date;
}

/**
 * Real-time update event types
 */
export enum RealtimeEventType {
  TRANSACTION_STATUS_UPDATE = "transaction:status-update",
  TRANSACTION_CREATED = "transaction:created",
  TRANSACTION_CONFIRMED = "transaction:confirmed",
  TRANSACTION_FAILED = "transaction:failed",
  BOT_ALERT = "bot:alert",
  BOT_STATUS_CHANGE = "bot:status-change",
  BOT_ERROR = "bot:error",
  DEPLOYMENT_STATUS = "deployment:status",
  SWAP_STATUS = "swap:status",
}

/**
 * Transaction status update payload
 */
export interface TransactionStatusUpdate {
  transactionId: string;
  transactionHash: string;
  status: "pending" | "confirmed" | "failed";
  timestamp: Date;
  ledger?: number;
  feeUsed?: number;
  memo?: string;
  userId?: string;
}

/**
 * Bot alert payload
 */
export interface BotAlert {
  alertId: string;
  severity: "info" | "warning" | "error" | "critical";
  message: string;
  botId?: string;
  timestamp: Date;
  userId?: string;
  details?: Record<string, unknown>;
}

/**
 * Bot status change payload
 */
export interface BotStatusChange {
  botId: string;
  status: "active" | "inactive" | "error" | "paused";
  message: string;
  timestamp: Date;
  userId?: string;
}

/**
 * Deployment status payload
 */
export interface DeploymentStatus {
  deploymentId: string;
  status: "pending" | "in-progress" | "completed" | "failed";
  progress?: number;
  message: string;
  timestamp: Date;
  userId?: string;
  details?: Record<string, unknown>;
}

/**
 * Socket.io event emitter for managing real-time updates
 */
export class RealtimeEventEmitter extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Emit a transaction status update
   */
  emitTransactionUpdate(update: TransactionStatusUpdate): void {
    this.emit(RealtimeEventType.TRANSACTION_STATUS_UPDATE, update);
  }

  /**
   * Emit a transaction created event
   */
  emitTransactionCreated(update: TransactionStatusUpdate): void {
    this.emit(RealtimeEventType.TRANSACTION_CREATED, update);
  }

  /**
   * Emit a transaction confirmed event
   */
  emitTransactionConfirmed(update: TransactionStatusUpdate): void {
    this.emit(RealtimeEventType.TRANSACTION_CONFIRMED, update);
  }

  /**
   * Emit a transaction failed event
   */
  emitTransactionFailed(update: TransactionStatusUpdate): void {
    this.emit(RealtimeEventType.TRANSACTION_FAILED, update);
  }

  /**
   * Emit a bot alert
   */
  emitBotAlert(alert: BotAlert): void {
    this.emit(RealtimeEventType.BOT_ALERT, alert);
  }

  /**
   * Emit a bot status change
   */
  emitBotStatusChange(statusChange: BotStatusChange): void {
    this.emit(RealtimeEventType.BOT_STATUS_CHANGE, statusChange);
  }

  /**
   * Emit a bot error
   */
  emitBotError(alert: BotAlert): void {
    this.emit(RealtimeEventType.BOT_ERROR, alert);
  }

  /**
   * Emit deployment status update
   */
  emitDeploymentStatus(status: DeploymentStatus): void {
    this.emit(RealtimeEventType.DEPLOYMENT_STATUS, status);
  }

  /**
   * Emit swap status update
   */
  emitSwapStatus(update: TransactionStatusUpdate): void {
    this.emit(RealtimeEventType.SWAP_STATUS, update);
  }
}

/**
 * Socket.io Server Manager
 * Handles real-time communication with connected clients
 */
export class SocketManager {
  private io: SocketIOServer;
  private connectedClients: Map<string, ConnectedClient>;
  private eventEmitter: RealtimeEventEmitter;
  private userSockets: Map<string, Set<string>>; // userId -> Set of socketIds

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.ALLOWED_ORIGINS || "*",
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type"],
      },
      transports: ["websocket", "polling"],
      pingInterval: 25000,
      pingTimeout: 60000,
    } as any);

    this.connectedClients = new Map();
    this.userSockets = new Map();
    this.eventEmitter = new RealtimeEventEmitter();

    this.setupConnectionHandlers();
    this.setupEventListeners();
  }

  /**
   * Setup socket connection and disconnection handlers
   */
  private setupConnectionHandlers(): void {
    this.io.on("connection", (socket: Socket) => {
      logger.info(`Client connected: ${socket.id}`);

      const client: ConnectedClient = {
        socketId: socket.id,
        connectedAt: new Date(),
      };

      this.connectedClients.set(socket.id, client);

      // Handle authentication and user association
      socket.on("authenticate", (userId: string) => {
        if (userId) {
          client.userId = userId;

          // Track user's sockets
          if (!this.userSockets.has(userId)) {
            this.userSockets.set(userId, new Set());
          }
          this.userSockets.get(userId)!.add(socket.id);

          socket.join(`user:${userId}`);
          logger.info(`Client ${socket.id} authenticated as user ${userId}`);
        }
      });

      // Handle subscription to transaction updates — requires prior authentication
      socket.on("subscribe:transactions", async (transactionId?: string) => {
        if (!client.userId) {
          socket.emit("error", { message: "Authentication required before subscribing." });
          logger.warn(`Unauthenticated client ${socket.id} attempted to subscribe to transactions`);
          return;
        }
        const abuseDecision = await evaluateRealtimeAbusePolicy(
          "subscribe:transactions",
          {
            userId: client.userId,
            sessionId: socket.id,
            ipAddress: socket.handshake.address,
          },
          { transactionId }
        );
        if (!abuseDecision.allowed) {
          socket.emit("error", {
            message: abuseDecision.reason,
            code: abuseDecision.policyId,
            retryAfterMs: abuseDecision.retryAfterMs,
          });
          return;
        }
        if (transactionId) {
          socket.join(`transaction:${transactionId}`);
          logger.info(
            `Client ${socket.id} subscribed to transaction ${transactionId}`
          );
        }
      });

      // Handle subscription to bot updates — requires prior authentication
      socket.on("subscribe:bot-alerts", async (botId?: string) => {
        if (!client.userId) {
          socket.emit("error", { message: "Authentication required before subscribing." });
          logger.warn(`Unauthenticated client ${socket.id} attempted to subscribe to bot alerts`);
          return;
        }
        const abuseDecision = await evaluateRealtimeAbusePolicy(
          "subscribe:bot-alerts",
          {
            userId: client.userId,
            sessionId: socket.id,
            ipAddress: socket.handshake.address,
          },
          { botId }
        );
        if (!abuseDecision.allowed) {
          socket.emit("error", {
            message: abuseDecision.reason,
            code: abuseDecision.policyId,
            retryAfterMs: abuseDecision.retryAfterMs,
          });
          return;
        }
        if (botId) {
          socket.join(`bot:${botId}`);
          logger.info(`Client ${socket.id} subscribed to bot ${botId}`);
        } else {
          socket.join("bot:all");
          logger.info(`Client ${socket.id} subscribed to all bot alerts`);
        }
      });

      // Handle disconnection
      socket.on("disconnect", () => {
        const disconnectedClient = this.connectedClients.get(socket.id);
        if (disconnectedClient?.userId) {
          const userSockets = this.userSockets.get(disconnectedClient.userId);
          if (userSockets) {
            userSockets.delete(socket.id);
            if (userSockets.size === 0) {
              this.userSockets.delete(disconnectedClient.userId);
            }
          }
        }
        this.connectedClients.delete(socket.id);
        logger.info(`Client disconnected: ${socket.id}`);
      });

      // Handle errors
      socket.on("error", (error: Error) => {
        logger.error(`Socket error for ${socket.id}:`, { error: error.message });
      });
    });
  }

  /**
   * Setup event listeners from the event emitter
   */
  private setupEventListeners(): void {
    // Transaction updates
    this.eventEmitter.on(
      RealtimeEventType.TRANSACTION_STATUS_UPDATE,
      (update: TransactionStatusUpdate) => {
        this.broadcastTransactionUpdate(update);
      }
    );

    this.eventEmitter.on(
      RealtimeEventType.TRANSACTION_CREATED,
      (update: TransactionStatusUpdate) => {
        this.broadcastTransactionEvent("created", update);
      }
    );

    this.eventEmitter.on(
      RealtimeEventType.TRANSACTION_CONFIRMED,
      (update: TransactionStatusUpdate) => {
        this.broadcastTransactionEvent("confirmed", update);
      }
    );

    this.eventEmitter.on(
      RealtimeEventType.TRANSACTION_FAILED,
      (update: TransactionStatusUpdate) => {
        this.broadcastTransactionEvent("failed", update);
      }
    );

    this.eventEmitter.on(
      RealtimeEventType.SWAP_STATUS,
      (update: TransactionStatusUpdate) => {
        this.broadcastSwapStatus(update);
      }
    );

    // Bot alerts
    this.eventEmitter.on(
      RealtimeEventType.BOT_ALERT,
      (alert: BotAlert) => {
        this.broadcastBotAlert(alert);
      }
    );

    this.eventEmitter.on(
      RealtimeEventType.BOT_STATUS_CHANGE,
      (statusChange: BotStatusChange) => {
        this.broadcastBotStatusChange(statusChange);
      }
    );

    this.eventEmitter.on(
      RealtimeEventType.BOT_ERROR,
      (alert: BotAlert) => {
        this.broadcastBotError(alert);
      }
    );

    // Deployment status
    this.eventEmitter.on(
      RealtimeEventType.DEPLOYMENT_STATUS,
      (status: DeploymentStatus) => {
        this.broadcastDeploymentStatus(status);
      }
    );
  }

  /**
   * Broadcast transaction status update
   */
  private broadcastTransactionUpdate(update: TransactionStatusUpdate): void {
    if (update.userId) {
      this.io.to(`user:${update.userId}`).emit("transaction:update", update);
    }
    this.io.to(`transaction:${update.transactionId}`).emit("transaction:update", update);
  }

  /**
   * Broadcast transaction event (created, confirmed, failed)
   */
  private broadcastTransactionEvent(
    eventType: "created" | "confirmed" | "failed",
    update: TransactionStatusUpdate
  ): void {
    const eventName = `transaction:${eventType}`;
    if (update.userId) {
      this.io.to(`user:${update.userId}`).emit(eventName, update);
    }
    this.io.to(`transaction:${update.transactionId}`).emit(eventName, update);
  }

  /**
   * Broadcast swap status update
   */
  private broadcastSwapStatus(update: TransactionStatusUpdate): void {
    if (update.userId) {
      this.io.to(`user:${update.userId}`).emit("swap:status", update);
    }
    this.io.to(`transaction:${update.transactionId}`).emit("swap:status", update);
  }

  /**
   * Broadcast bot alert
   */
  private broadcastBotAlert(alert: BotAlert): void {
    if (alert.userId) {
      this.io.to(`user:${alert.userId}`).emit("bot:alert", alert);
    }
    if (alert.botId) {
      this.io.to(`bot:${alert.botId}`).emit("bot:alert", alert);
    }
    this.io.to("bot:all").emit("bot:alert", alert);
  }

  /**
   * Broadcast bot status change
   */
  private broadcastBotStatusChange(statusChange: BotStatusChange): void {
    if (statusChange.userId) {
      this.io.to(`user:${statusChange.userId}`).emit("bot:status-change", statusChange);
    }
    this.io.to(`bot:${statusChange.botId}`).emit("bot:status-change", statusChange);
    this.io.to("bot:all").emit("bot:status-change", statusChange);
  }

  /**
   * Broadcast bot error
   */
  private broadcastBotError(alert: BotAlert): void {
    if (alert.userId) {
      this.io.to(`user:${alert.userId}`).emit("bot:error", alert);
    }
    if (alert.botId) {
      this.io.to(`bot:${alert.botId}`).emit("bot:error", alert);
    }
    this.io.to("bot:all").emit("bot:error", alert);
  }

  /**
   * Broadcast deployment status
   */
  private broadcastDeploymentStatus(status: DeploymentStatus): void {
    if (status.userId) {
      this.io.to(`user:${status.userId}`).emit("deployment:status", status);
    }
    this.io.emit("deployment:status", status);
  }

  /**
   * Get the event emitter for external use
   */
  public getEventEmitter(): RealtimeEventEmitter {
    return this.eventEmitter;
  }

  /**
   * Get connected clients count
   */
  public getConnectedClientsCount(): number {
    return this.connectedClients.size;
  }

  /**
   * Get connected clients for a specific user
   */
  public getUserClients(userId: string): ConnectedClient[] {
    const socketIds = this.userSockets.get(userId) || new Set();
    return Array.from(socketIds)
      .map((socketId) => this.connectedClients.get(socketId))
      .filter((client) => client !== undefined) as ConnectedClient[];
  }

  /**
   * Get all connected clients
   */
  public getAllConnectedClients(): ConnectedClient[] {
    return Array.from(this.connectedClients.values());
  }

  /**
   * Get Socket.io server instance
   */
  public getIO(): SocketIOServer {
    return this.io;
  }

  /**
   * Close the socket server
   */
  public async close(): Promise<void> {
    return new Promise((resolve) => {
      this.io.close(() => {
        logger.info("Socket.io server closed");
        resolve();
      });
    });
  }
}

// Global instance
let socketManagerInstance: SocketManager | null = null;

/**
 * Initialize Socket Manager (to be called during server startup)
 */
export function initializeSocketManager(httpServer: HTTPServer): SocketManager {
  if (socketManagerInstance) {
    logger.warn("SocketManager already initialized");
    return socketManagerInstance;
  }
  socketManagerInstance = new SocketManager(httpServer);
  logger.info("SocketManager initialized");
  return socketManagerInstance;
}

/**
 * Get the global Socket Manager instance
 */
export function getSocketManager(): SocketManager {
  if (!socketManagerInstance) {
    throw new Error(
      "SocketManager not initialized. Call initializeSocketManager first."
    );
  }
  return socketManagerInstance;
}
