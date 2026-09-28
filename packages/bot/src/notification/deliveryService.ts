/**
 * Notification Delivery Service
 * Resilient notification delivery with retries, backpressure, and dead-letter handling
 */

import {
  NotificationMessage,
  DeliveryStatus,
  DeliveryPlatform,
  DeliveryResult,
  DeliveryAttempt,
  NotificationDeliveryState,
  RetryConfig,
  BackpressureConfig,
  DeadLetterConfig,
  DeliveryMetrics,
  PlatformMetrics,
  PlatformDeliveryHandler,
  DeliveryServiceConfig,
  DefaultRetryConfig,
  DefaultBackpressureConfig,
  DefaultDeadLetterConfig,
  DefaultDeliveryServiceConfig,
  NotificationPriority,
} from './core.js';

/**
 * Notification Delivery Service
 */
export class NotificationDeliveryService {
  private queue: Map<string, NotificationMessage>;
  private deliveryStates: Map<string, NotificationDeliveryState>;
  private replayIndex: Map<string, string>;
  private notificationUsers: Map<string, string>;
  private deadLetterQueue: Map<string, { notification: NotificationMessage; state: NotificationDeliveryState; deadLetterAt: number }>;
  private platformHandlers: Map<DeliveryPlatform, PlatformDeliveryHandler>;
  private processing: Set<string>;
  private retryConfig: RetryConfig;
  private backpressureConfig: BackpressureConfig;
  private deadLetterConfig: DeadLetterConfig;
  private metrics: DeliveryMetrics;
  private metricsEnabled: boolean;
  private metricsUpdateInterval: number;
  private metricsTimer: ReturnType<typeof setInterval> | null;
  private concurrencyLimit: number;
  private currentConcurrency: number;

  constructor(config: DeliveryServiceConfig = {}) {
    this.queue = new Map();
    this.deliveryStates = new Map();
    this.replayIndex = new Map();
    this.notificationUsers = new Map();
    this.deadLetterQueue = new Map();
    this.platformHandlers = new Map();
    this.processing = new Set();
    
    this.retryConfig = { ...DefaultRetryConfig, ...config.retry };
    this.backpressureConfig = { ...DefaultBackpressureConfig, ...config.backpressure };
    this.deadLetterConfig = { ...DefaultDeadLetterConfig, ...config.deadLetter };
    
    this.metricsEnabled = config.enableMetrics ?? true;
    this.metricsUpdateInterval = config.metricsUpdateInterval ?? 60000;
    this.metricsTimer = null as ReturnType<typeof setInterval> | null;
    
    this.concurrencyLimit = this.backpressureConfig.maxConcurrency;
    this.currentConcurrency = 0;
    
    this.metrics = this.initializeMetrics();
    
    if (this.metricsEnabled) {
      // @ts-ignore - setInterval should be available at runtime
      this.startMetricsCollection();
    }
  }

  /**
   * Initialize metrics
   */
  private initializeMetrics(): DeliveryMetrics {
    return {
      byPlatform: new Map([
        [DeliveryPlatform.TELEGRAM, this.createPlatformMetrics(DeliveryPlatform.TELEGRAM)],
        [DeliveryPlatform.DISCORD, this.createPlatformMetrics(DeliveryPlatform.DISCORD)],
        [DeliveryPlatform.BOTH, this.createPlatformMetrics(DeliveryPlatform.BOTH)],
      ]),
      totalSent: 0,
      totalDelivered: 0,
      totalFailed: 0,
      totalRetried: 0,
      totalDeadLettered: 0,
      successRate: 0,
      avgDeliveryTime: 0,
      queueSize: 0,
      processingCount: 0,
      lastUpdatedAt: Date.now(),
    };
  }

  /**
   * Create platform metrics
   */
  private createPlatformMetrics(platform: DeliveryPlatform): PlatformMetrics {
    return {
      platform,
      totalSent: 0,
      delivered: 0,
      failed: 0,
      retried: 0,
      deadLettered: 0,
      avgDeliveryTime: 0,
      queueSize: 0,
      processingCount: 0,
    };
  }

  /**
   * Register a platform delivery handler
   */
  registerPlatformHandler(handler: PlatformDeliveryHandler): void {
    this.platformHandlers.set(handler.platform, handler);
  }

  /**
   * Unregister a platform delivery handler
   */
  unregisterPlatformHandler(platform: DeliveryPlatform): void {
    this.platformHandlers.delete(platform);
  }

  /**
   * Check if under backpressure
   */
  private isUnderBackpressure(): boolean {
    const threshold = this.backpressureConfig.maxQueueSize * this.backpressureConfig.threshold;
    return this.queue.size >= threshold;
  }

  /**
   * Check if can accept new notification
   */
  canAcceptNotification(): boolean {
    if (this.queue.size >= this.backpressureConfig.maxQueueSize) {
      return false;
    }

    if (this.isUnderBackpressure() && this.backpressureConfig.rejectWhenUnderPressure) {
      return false;
    }

    return true;
  }

  /**
   * Enqueue a notification for delivery
   */
  async enqueue(message: NotificationMessage): Promise<{ accepted: boolean; reason?: string }> {
    const replayKey = this.replayKeyFor(message);
    if (replayKey) {
      const existingId = this.replayIndex.get(replayKey);
      if (existingId) {
        return { accepted: false, reason: `Duplicate notification replay for ${existingId}` };
      }
      this.replayIndex.set(replayKey, message.id);
    }

    // Check backpressure
    if (!this.canAcceptNotification()) {
      if (this.queue.size >= this.backpressureConfig.maxQueueSize) {
        return { accepted: false, reason: 'Queue is full' };
      }
      if (this.isUnderBackpressure() && this.backpressureConfig.rejectWhenUnderPressure) {
        return { accepted: false, reason: 'Under backpressure' };
      }
    }

    // Apply backpressure delay if needed
    if (this.isUnderBackpressure()) {
      await this.sleep(this.backpressureConfig.backpressureDelayMs);
    }

    // Add to queue
    this.queue.set(message.id, message);
    this.notificationUsers.set(message.id, message.userId);
    
    // Initialize delivery state
    this.deliveryStates.set(message.id, {
      notificationId: message.id,
      status: DeliveryStatus.PENDING,
      attempts: [],
      currentAttempt: 0,
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
      replayKey,
    });

    // Update metrics
    if (this.metricsEnabled) {
      this.metrics.totalSent++;
      this.metrics.queueSize = this.queue.size;
      for (const platform of message.platforms) {
        const platformMetrics = this.metrics.byPlatform.get(platform);
        if (platformMetrics) {
          platformMetrics.totalSent++;
          platformMetrics.queueSize = this.queue.size;
        }
      }
    }

    // Start processing
    this.processQueue();

    return { accepted: true };
  }

  /**
   * Process the notification queue
   */
  private async processQueue(): Promise<void> {
    if (this.currentConcurrency >= this.concurrencyLimit) {
      return;
    }

    for (const [id, message] of this.queue.entries()) {
      if (this.processing.has(id)) {
        continue;
      }

      if (this.currentConcurrency >= this.concurrencyLimit) {
        break;
      }

      // Check if notification has expired
      if (message.expiresAt && Date.now() > message.expiresAt) {
        this.queue.delete(id);
        this.deliveryStates.delete(id);
        continue;
      }

      this.processing.add(id);
      this.currentConcurrency++;

      // Update metrics
      if (this.metricsEnabled) {
        this.metrics.processingCount++;
        for (const platform of message.platforms) {
          const platformMetrics = this.metrics.byPlatform.get(platform);
          if (platformMetrics) {
            platformMetrics.processingCount++;
          }
        }
      }

      // Process asynchronously
      this.deliverNotification(message).catch(error => {
        // @ts-ignore - console should be available at runtime
        if (typeof console !== 'undefined') {
          // @ts-ignore
          console.error(`Error delivering notification ${id}:`, error);
        }
      }).finally(() => {
        this.processing.delete(id);
        this.currentConcurrency--;
        
        // Update metrics
        if (this.metricsEnabled) {
          this.metrics.processingCount--;
          for (const platform of message.platforms) {
            const platformMetrics = this.metrics.byPlatform.get(platform);
            if (platformMetrics) {
              platformMetrics.processingCount--;
            }
          }
        }

        // Continue processing
        this.processQueue();
      });
    }
  }

  /**
   * Deliver a notification
   */
  private async deliverNotification(message: NotificationMessage): Promise<void> {
    const state = this.deliveryStates.get(message.id);
    if (!state) {
      return;
    }

    state.status = DeliveryStatus.PROCESSING;
    state.updatedAt = Date.now();

    const platforms = this.determinePlatforms(message);
    let allDelivered = true;

    for (const platform of platforms) {
      const handler = this.platformHandlers.get(platform);
      if (!handler || !handler.isAvailable()) {
        allDelivered = false;
        continue;
      }

      const attempt: DeliveryAttempt = {
        attempt: state.currentAttempt + 1,
        platform,
        status: DeliveryStatus.PROCESSING,
        timestamp: Date.now(),
      };

      state.attempts.push(attempt);
      state.currentAttempt++;

      try {
        const startTime = Date.now();
        const result = await this.deliverWithTimeout(handler, message, message.timeout || 30000);
        const duration = Date.now() - startTime;

        attempt.result = result;
        attempt.status = result.success ? DeliveryStatus.DELIVERED : DeliveryStatus.FAILED;
        attempt.error = result.error;

        if (result.success) {
          state.status = DeliveryStatus.DELIVERED;
          state.deliveredAt = Date.now();
          
          // Update metrics
          if (this.metricsEnabled) {
            this.metrics.totalDelivered++;
            const platformMetrics = this.metrics.byPlatform.get(platform);
            if (platformMetrics) {
              platformMetrics.delivered++;
              platformMetrics.avgDeliveryTime = this.updateAverage(
                platformMetrics.avgDeliveryTime,
                duration,
                platformMetrics.delivered
              );
              platformMetrics.lastDeliveryAt = Date.now();
            }
          }
        } else {
          allDelivered = false;
          state.status = DeliveryStatus.FAILED;
          state.failedAt = Date.now();
          
          // Update metrics
          if (this.metricsEnabled) {
            this.metrics.totalFailed++;
            const platformMetrics = this.metrics.byPlatform.get(platform);
            if (platformMetrics) {
              platformMetrics.failed++;
              platformMetrics.lastFailureAt = Date.now();
            }
          }
        }
      } catch (error) {
        allDelivered = false;
        attempt.status = DeliveryStatus.FAILED;
        attempt.error = error instanceof Error ? error.message : String(error);
        
        // Update metrics
        if (this.metricsEnabled) {
          this.metrics.totalFailed++;
          const platformMetrics = this.metrics.byPlatform.get(platform);
          if (platformMetrics) {
            platformMetrics.failed++;
            platformMetrics.lastFailureAt = Date.now();
          }
        }
      }

      state.updatedAt = Date.now();
    }

    // Handle retry or dead letter
    if (!allDelivered && state.currentAttempt < this.retryConfig.maxAttempts) {
      state.status = DeliveryStatus.RETRYING;
      const delay = this.calculateRetryDelay(state.currentAttempt);
      state.nextRetryAt = Date.now() + delay;
      
      // Update metrics
      if (this.metricsEnabled) {
        this.metrics.totalRetried++;
        for (const platform of platforms) {
          const platformMetrics = this.metrics.byPlatform.get(platform);
          if (platformMetrics) {
            platformMetrics.retried++;
          }
        }
      }

      // Schedule retry
      // @ts-ignore - setTimeout should be available at runtime
      setTimeout(() => {
        this.queue.set(message.id, message);
        this.processQueue();
      }, delay);
    } else if (!allDelivered) {
      // Move to dead letter
      this.moveToDeadLetter(message, state);
    } else {
      // Successfully delivered - remove from queue
      this.queue.delete(message.id);
    }

    state.updatedAt = Date.now();
  }

  /**
   * Deliver with timeout
   */
  private async deliverWithTimeout(
    handler: PlatformDeliveryHandler,
    message: NotificationMessage,
    timeout: number
  ): Promise<DeliveryResult> {
    return Promise.race([
      handler.deliver(message),
      new Promise<DeliveryResult>((_, reject) =>
        // @ts-ignore - setTimeout should be available at runtime
        setTimeout(() => reject(new Error('Delivery timeout')), timeout)
      ),
    ]);
  }

  /**
   * Determine platforms to deliver to
   */
  private determinePlatforms(message: NotificationMessage): DeliveryPlatform[] {
    if (message.platforms.includes(DeliveryPlatform.BOTH)) {
      return [DeliveryPlatform.TELEGRAM, DeliveryPlatform.DISCORD];
    }
    return message.platforms;
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = this.retryConfig.initialDelayMs * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1);
    const cappedDelay = Math.min(baseDelay, this.retryConfig.maxDelayMs);
    
    if (this.retryConfig.useJitter) {
      const jitter = cappedDelay * this.retryConfig.jitterPercentage;
      const randomJitter = Math.random() * jitter * 2 - jitter;
      return Math.max(0, cappedDelay + randomJitter);
    }
    
    return cappedDelay;
  }

  /**
   * Move notification to dead letter queue
   */
  private moveToDeadLetter(message: NotificationMessage, state: NotificationDeliveryState): void {
    state.status = DeliveryStatus.DEAD_LETTER;
    state.deadLetterAt = Date.now();
    
    this.deadLetterQueue.set(message.id, {
      notification: message,
      state,
      deadLetterAt: Date.now(),
    });

    // Remove from queue
    this.queue.delete(message.id);

    // Update metrics
    if (this.metricsEnabled) {
      this.metrics.totalDeadLettered++;
      for (const platform of message.platforms) {
        const platformMetrics = this.metrics.byPlatform.get(platform);
        if (platformMetrics) {
          platformMetrics.deadLettered++;
        }
      }
    }

    // Call dead letter callback
    if (this.deadLetterConfig.onDeadLetter) {
      this.deadLetterConfig.onDeadLetter(message, state);
    }

    // Enforce dead letter queue size limit
    this.enforceDeadLetterLimit();
  }

  /**
   * Enforce dead letter queue size limit
   */
  private enforceDeadLetterLimit(): void {
    if (this.deadLetterQueue.size <= this.deadLetterConfig.maxSize) {
      return;
    }

    const entries = Array.from(this.deadLetterQueue.entries())
      .sort((a, b) => a[1].deadLetterAt - b[1].deadLetterAt);

    const toRemove = entries.length - this.deadLetterConfig.maxSize;
    for (let i = 0; i < toRemove; i++) {
      this.deadLetterQueue.delete(entries[i][0]);
    }
  }

  /**
   * Retry a dead letter notification
   */
  async retryDeadLetter(notificationId: string): Promise<{ success: boolean; reason?: string }> {
    const entry = this.deadLetterQueue.get(notificationId);
    if (!entry) {
      return { success: false, reason: 'Notification not found in dead letter queue' };
    }

    // Reset state
    entry.state.status = DeliveryStatus.PENDING;
    entry.state.currentAttempt = 0;
    entry.state.attempts = [];
    entry.state.nextRetryAt = undefined;
    entry.state.deadLetterAt = undefined;

    // Remove from dead letter queue
    this.deadLetterQueue.delete(notificationId);

    // Re-enqueue
    const result = await this.enqueue(entry.notification);
    return { success: result.accepted, reason: result.reason };
  }

  /**
   * Get delivery metrics
   */
  getMetrics(): DeliveryMetrics {
    if (this.metricsEnabled) {
      this.updateMetrics();
    }
    return { ...this.metrics, byPlatform: new Map(this.metrics.byPlatform) };
  }

  /**
   * Get platform-specific metrics
   */
  getPlatformMetrics(platform: DeliveryPlatform): PlatformMetrics | undefined {
    if (this.metricsEnabled) {
      this.updateMetrics();
    }
    return this.metrics.byPlatform.get(platform);
  }

  /**
   * Update metrics
   */
  private updateMetrics(): void {
    this.metrics.queueSize = this.queue.size;
    this.metrics.processingCount = this.currentConcurrency;
    
    const total = this.metrics.totalDelivered + this.metrics.totalFailed;
    this.metrics.successRate = total > 0 ? this.metrics.totalDelivered / total : 0;
    
    // Update platform metrics
    for (const [platform, metrics] of this.metrics.byPlatform) {
      metrics.queueSize = this.queue.size;
      metrics.processingCount = this.currentConcurrency;
      
      const platformTotal = metrics.delivered + metrics.failed;
      // Success rate is calculated per platform based on their own deliveries
    }
    
    this.metrics.lastUpdatedAt = Date.now();
  }

  /**
   * Update running average
   */
  private updateAverage(current: number, newValue: number, count: number): number {
    if (count === 0) return newValue;
    return (current * (count - 1) + newValue) / count;
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    // @ts-ignore - setInterval should be available at runtime
    this.metricsTimer = setInterval(() => {
      this.updateMetrics();
    }, this.metricsUpdateInterval);
  }

  /**
   * Stop metrics collection
   */
  private stopMetricsCollection(): void {
    if (this.metricsTimer) {
      // @ts-ignore - clearInterval should be available at runtime
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
  }

  /**
   * Get queue size
   */
  getQueueSize(): number {
    return this.queue.size;
  }

  /**
   * Get dead letter queue size
   */
  getDeadLetterQueueSize(): number {
    return this.deadLetterQueue.size;
  }

  /**
   * Get delivery state for a notification
   */
  getDeliveryState(notificationId: string): NotificationDeliveryState | undefined {
    return this.deliveryStates.get(notificationId);
  }

  getDeliveryHistoryForUser(userId: string): NotificationDeliveryState[] {
    return [...this.deliveryStates.values()]
      .filter((state) => this.notificationUsers.get(state.notificationId) === userId)
      .map((state) => ({ ...state, attempts: state.attempts.map((attempt) => ({ ...attempt })) }));
  }

  acknowledge(notificationId: string, identityId: string, at = Date.now()): { acknowledged: boolean; reason?: string } {
    const state = this.deliveryStates.get(notificationId);
    if (!state) {
      return { acknowledged: false, reason: "Notification not found" };
    }
    state.acknowledgedAt = at;
    state.acknowledgedBy = identityId;
    state.updatedAt = at;
    return { acknowledged: true };
  }

  async recoverMissedCritical(notificationId: string): Promise<{ accepted: boolean; reason?: string }> {
    const entry = this.deadLetterQueue.get(notificationId);
    if (!entry) {
      return { accepted: false, reason: "Notification not found in dead letter queue" };
    }
    const recovered: NotificationMessage = {
      ...entry.notification,
      id: `${entry.notification.id}:recovery`,
      metadata: {
        ...(entry.notification.metadata ?? {}),
        replayKey: `recovery:${entry.notification.id}`,
        recoveryOf: entry.notification.id,
        suppressFinancialSideEffects: true,
      },
      createdAt: Date.now(),
    };
    return this.enqueue(recovered);
  }

  /**
   * Cancel a notification
   */
  cancelNotification(notificationId: string): boolean {
    const state = this.deliveryStates.get(notificationId);
    if (!state) {
      return false;
    }

    if (state.status === DeliveryStatus.DELIVERED || state.status === DeliveryStatus.DEAD_LETTER) {
      return false;
    }

    state.status = DeliveryStatus.CANCELLED;
    this.queue.delete(notificationId);
    this.processing.delete(notificationId);

    return true;
  }

  /**
   * Clear dead letter queue
   */
  clearDeadLetterQueue(): void {
    this.deadLetterQueue.clear();
  }

  /**
   * Clean up expired dead letter entries
   */
  cleanupExpiredDeadLetters(): number {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, entry] of this.deadLetterQueue.entries()) {
      if (now - entry.deadLetterAt > this.deadLetterConfig.ttl) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this.deadLetterQueue.delete(id);
    }

    return toRemove.length;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      // @ts-ignore - setTimeout should be available at runtime
      setTimeout(resolve, ms);
    });
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    this.stopMetricsCollection();
    
    // Wait for current processing to complete
    while (this.currentConcurrency > 0) {
      await this.sleep(100);
    }

    // Clear queues
    this.queue.clear();
    this.processing.clear();
  }

  private replayKeyFor(message: NotificationMessage): string | undefined {
    const raw = message.metadata?.replayKey ?? message.metadata?.eventId;
    return typeof raw === "string" ? `${message.userId}:${raw}` : undefined;
  }

  /**
   * Get service health status
   */
  getHealth(): {
    healthy: boolean;
    queueSize: number;
    deadLetterSize: number;
    processingCount: number;
    platformHealth: Map<DeliveryPlatform, boolean>;
  } {
    const platformHealth = new Map<DeliveryPlatform, boolean>();
    for (const [platform, handler] of this.platformHandlers) {
      platformHealth.set(platform, handler.isAvailable());
    }

    return {
      healthy: this.currentConcurrency < this.concurrencyLimit && this.queue.size < this.backpressureConfig.maxQueueSize,
      queueSize: this.queue.size,
      deadLetterSize: this.deadLetterQueue.size,
      processingCount: this.currentConcurrency,
      platformHealth,
    };
  }
}
