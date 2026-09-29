/**
 * Client-side Socket.io Real-time Updates Example
 * This is a reference implementation for connecting to the Socket.io server
 * and listening to real-time transaction and bot alert updates.
 */

import { io, Socket } from "socket.io-client";

interface ClientConfig {
  url: string;
  accessToken?: string;
  reconnection?: boolean;
  reconnectionDelay?: number;
  reconnectionDelayMax?: number;
  reconnectionAttempts?: number;
}

/**
 * Real-time Updates Client
 * Manages Socket.io connection and event subscriptions
 */
export class RealtimeClient {
  private socket: Socket | null = null;
  private config: ClientConfig;
  private isConnected = false;
  private isAuthenticated = false;
  private eventHandlers: Map<string, Set<(...args: unknown[]) => void>> =
    new Map();

  constructor(config: ClientConfig) {
    this.config = {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      ...config,
    };
  }

  /**
   * Connect to the Socket.io server
   */
  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = io(this.config.url, {
          reconnection: this.config.reconnection,
          reconnectionDelay: this.config.reconnectionDelay,
          reconnectionDelayMax: this.config.reconnectionDelayMax,
          reconnectionAttempts: this.config.reconnectionAttempts,
        });

        // Connection event
        this.socket.on("connect", () => {
          console.log("Connected to real-time server:", this.socket?.id);
          this.isConnected = true;

          // Authenticate if access token is provided
          if (this.config.accessToken) {
            this.socket?.emit("authenticate", this.config.accessToken);
          } else {
            this.emit("connected");
            resolve();
          }
        });

        // Authenticated event
        this.socket.on("authenticated", (data) => {
          console.log("Authenticated successfully:", data);
          this.isAuthenticated = true;
          this.emit("authenticated", data);
          this.emit("connected");
          resolve();
        });

        // Disconnection event
        this.socket.on("disconnect", (reason) => {
          console.log("Disconnected from real-time server:", reason);
          this.isConnected = false;
          this.isAuthenticated = false;
          this.emit("disconnected", reason);
        });

        // Error event
        this.socket.on("error", (error) => {
          console.error("Socket error:", error);
          this.emit("error", error);
          reject(error);
        });

        // Setup default event listeners
        this.setupDefaultListeners();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Setup default event listeners
   */
  private setupDefaultListeners(): void {
    if (!this.socket) return;

    // Transaction events
    this.socket.on("transaction:update", (update) => {
      this.emit("transaction:update", update);
    });

    this.socket.on("transaction:created", (update) => {
      this.emit("transaction:created", update);
    });

    this.socket.on("transaction:confirmed", (update) => {
      this.emit("transaction:confirmed", update);
    });

    this.socket.on("transaction:failed", (update) => {
      this.emit("transaction:failed", update);
    });

    // Swap events
    this.socket.on("swap:status", (update) => {
      this.emit("swap:status", update);
    });

    // Bot events
    this.socket.on("bot:alert", (alert) => {
      this.emit("bot:alert", alert);
    });

    this.socket.on("bot:status-change", (statusChange) => {
      this.emit("bot:status-change", statusChange);
    });

    this.socket.on("bot:error", (alert) => {
      this.emit("bot:error", alert);
    });

    // Deployment events
    this.socket.on("deployment:status", (status) => {
      this.emit("deployment:status", status);
    });
  }

  /**
   * Subscribe to transaction updates
   */
  public subscribeToTransaction(transactionId: string): void {
    if (this.socket?.connected && this.isAuthenticated) {
      this.socket.emit("subscribe:transactions", transactionId);
      console.log(`Subscribed to transaction: ${transactionId}`);
    }
  }

  /**
   * Subscribe to bot alerts
   */
  public subscribeToBotAlerts(botId?: string): void {
    if (this.socket?.connected && this.isAuthenticated) {
      this.socket.emit("subscribe:bot-alerts", botId);
      console.log(
        `Subscribed to bot alerts${botId ? ` for bot: ${botId}` : ""}`
      );
    }
  }

  /**
   * Register event listener
   */
  public on(eventName: string, handler: (...args: unknown[]) => void): void {
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, new Set());
    }
    this.eventHandlers.get(eventName)!.add(handler);
  }

  /**
   * Unregister event listener
   */
  public off(eventName: string, handler: (...args: unknown[]) => void): void {
    this.eventHandlers.get(eventName)?.delete(handler);
  }

  /**
   * Emit internal event
   */
  private emit(eventName: string, data?: unknown): void {
    this.eventHandlers.get(eventName)?.forEach((handler) => {
      handler(data);
    });
  }

  /**
   * Check if connected
   */
  public isConnectedToServer(): boolean {
    return this.isConnected && (this.socket?.connected ?? false);
  }

  /**
   * Check if authenticated
   */
  public isAuthenticatedWithServer(): boolean {
    return this.isAuthenticated;
  }

  /**
   * Disconnect from server
   */
  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.isConnected = false;
      this.isAuthenticated = false;
    }
  }

  /**
   * Get socket ID
   */
  public getSocketId(): string | undefined {
    return this.socket?.id;
  }
}

/**
 * Example usage factory
 */
export function createRealtimeClient(
  serverUrl: string,
  accessToken?: string
): RealtimeClient {
  return new RealtimeClient({
    url: serverUrl,
    accessToken,
  });
}

// Export types for client usage
export type {
  TransactionStatusUpdate,
  BotAlert,
  BotStatusChange,
  DeploymentStatus,
} from "./socketManager";
