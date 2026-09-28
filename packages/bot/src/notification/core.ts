/**
 * Bot Notification Delivery Service
 * Core types and interfaces for resilient notification delivery
 */

// ============================================================================
// Notification Types
// ============================================================================

/**
 * Notification priority levels
 */
export enum NotificationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}

/**
 * Notification types
 */
export enum NotificationType {
  TRANSACTION = 'transaction',
  PRICE_ALERT = 'price_alert',
  SYSTEM = 'system',
  ANNOUNCEMENT = 'announcement',
  WARNING = 'warning',
  ERROR = 'error',
  CUSTOM = 'custom',
}

/**
 * Delivery platforms
 */
export enum DeliveryPlatform {
  TELEGRAM = 'telegram',
  DISCORD = 'discord',
  BOTH = 'both',
}

/**
 * Delivery status
 */
export enum DeliveryStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  RETRYING = 'retrying',
  DEAD_LETTER = 'dead_letter',
  CANCELLED = 'cancelled',
}

// ============================================================================
// Notification Message
// ============================================================================

/**
 * Base notification message
 */
export interface NotificationMessage {
  /**
   * Unique notification ID
   */
  id: string;

  /**
   * User ID to deliver to
   */
  userId: string;

  /**
   * Notification type
   */
  type: NotificationType;

  /**
   * Priority level
   */
  priority: NotificationPriority;

  /**
   * Target platforms
   */
  platforms: DeliveryPlatform[];

  /**
   * Message content
   */
  content: string;

  /**
   * Optional embed data (Discord)
   */
  embed?: {
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  };

  /**
   * Optional metadata
   */
  metadata?: Record<string, unknown>;

  /**
   * Creation timestamp
   */
  createdAt: number;

  /**
   * Expiration timestamp (optional)
   */
  expiresAt?: number;

  /**
   * Maximum retry attempts
   */
  maxRetries?: number;

  /**
   * Custom timeout for delivery
   */
  timeout?: number;
}

// ============================================================================
// Delivery Result
// ============================================================================

/**
 * Result of a delivery attempt
 */
export interface DeliveryResult {
  /**
   * Whether delivery was successful
   */
  success: boolean;

  /**
   * Platform the delivery was attempted on
   */
  platform: DeliveryPlatform;

  /**
   * Error message if failed
   */
  error?: string;

  /**
   * Error code if failed
   */
  errorCode?: string;

  /**
   * Attempt number
   */
  attempt: number;

  /**
   * Time taken for delivery attempt
   */
  duration: number;

  /**
   * Timestamp of delivery attempt
   */
  timestamp: number;
}

// ============================================================================
// Delivery Attempt
// ============================================================================

/**
 * Record of a delivery attempt
 */
export interface DeliveryAttempt {
  /**
   * Attempt number
   */
  attempt: number;

  /**
   * Platform
   */
  platform: DeliveryPlatform;

  /**
   * Status
   */
  status: DeliveryStatus;

  /**
   * Result
   */
  result?: DeliveryResult;

  /**
   * Timestamp
   */
  timestamp: number;

  /**
   * Error message if failed
   */
  error?: string;

  /**
   * Next retry timestamp
   */
  nextRetryAt?: number;
}

// ============================================================================
// Notification Delivery State
// ============================================================================

/**
 * Complete delivery state for a notification
 */
export interface NotificationDeliveryState {
  /**
   * Notification ID
   */
  notificationId: string;

  /**
   * Current status
   */
  status: DeliveryStatus;

  /**
   * Delivery attempts
   */
  attempts: DeliveryAttempt[];

  /**
   * Current attempt number
   */
  currentAttempt: number;

  /**
   * Created timestamp
   */
  createdAt: number;

  /**
   * Last updated timestamp
   */
  updatedAt: number;

  /**
   * Delivered timestamp
   */
  deliveredAt?: number;

  /**
   * Failed timestamp
   */
  failedAt?: number;

  /**
   * Next retry timestamp
   */
  nextRetryAt?: number;

  /**
   * Dead letter timestamp
   */
  deadLetterAt?: number;

  /**
   * User acknowledgement timestamp, independent from platform delivery.
   */
  acknowledgedAt?: number;

  /**
   * Identity that acknowledged the notification.
   */
  acknowledgedBy?: string;

  /**
   * Stable key used to deduplicate replayed critical notifications.
   */
  replayKey?: string;
}

// ============================================================================
// Retry Configuration
// ============================================================================

/**
 * Retry policy configuration
 */
export interface RetryConfig {
  /**
   * Maximum number of retry attempts
   */
  maxAttempts: number;

  /**
   * Initial delay in milliseconds
   */
  initialDelayMs: number;

  /**
   * Maximum delay in milliseconds
   */
  maxDelayMs: number;

  /**
   * Backoff multiplier (exponential)
   */
  backoffMultiplier: number;

  /**
   * Whether to use jitter (random delay variation)
   */
  useJitter: boolean;

  /**
   * Jitter percentage (0-1)
   */
  jitterPercentage: number;
}

/**
 * Default retry configuration
 */
export const DefaultRetryConfig: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  useJitter: true,
  jitterPercentage: 0.2,
};

// ============================================================================
// Backpressure Configuration
// ============================================================================

/**
 * Backpressure configuration
 */
export interface BackpressureConfig {
  /**
   * Maximum queue size before applying backpressure
   */
  maxQueueSize: number;

  /**
   * Threshold to start applying backpressure (percentage of max)
   */
  threshold: number;

  /**
   * Maximum concurrent deliveries
   */
  maxConcurrency: number;

  /**
   * Whether to reject new notifications when under backpressure
   */
  rejectWhenUnderPressure: boolean;

  /**
   * Backpressure delay in milliseconds
   */
  backpressureDelayMs: number;
}

/**
 * Default backpressure configuration
 */
export const DefaultBackpressureConfig: BackpressureConfig = {
  maxQueueSize: 1000,
  threshold: 0.8,
  maxConcurrency: 10,
  rejectWhenUnderPressure: false,
  backpressureDelayMs: 100,
};

// ============================================================================
// Dead Letter Configuration
// ============================================================================

/**
 * Dead letter queue configuration
 */
export interface DeadLetterConfig {
  /**
   * Maximum size of dead letter queue
   */
  maxSize: number;

  /**
   * TTL for dead letter entries (milliseconds)
   */
  ttl: number;

  /**
   * Whether to persist dead letter entries
   */
  persist: boolean;

  /**
   * Callback when notification is moved to dead letter
   */
  onDeadLetter?: (notification: NotificationMessage, state: NotificationDeliveryState) => void;
}

/**
 * Default dead letter configuration
 */
export const DefaultDeadLetterConfig: DeadLetterConfig = {
  maxSize: 100,
  ttl: 86400000, // 24 hours
  persist: false,
};

// ============================================================================
// Platform Metrics
// ============================================================================

/**
 * Metrics for a specific platform
 */
export interface PlatformMetrics {
  /**
   * Platform name
   */
  platform: DeliveryPlatform;

  /**
   * Total notifications sent
   */
  totalSent: number;

  /**
   * Successfully delivered
   */
  delivered: number;

  /**
   * Failed deliveries
   */
  failed: number;

  /**
   * Retried
   */
  retried: number;

  /**
   * Dead lettered
   */
  deadLettered: number;

  /**
   * Average delivery time (milliseconds)
   */
  avgDeliveryTime: number;

  /**
   * Current queue size
   */
  queueSize: number;

  /**
   * Current processing count
   */
  processingCount: number;

  /**
   * Last delivery timestamp
   */
  lastDeliveryAt?: number;

  /**
   * Last failure timestamp
   */
  lastFailureAt?: number;
}

/**
 * Overall delivery metrics
 */
export interface DeliveryMetrics {
  /**
   * Metrics by platform
   */
  byPlatform: Map<DeliveryPlatform, PlatformMetrics>;

  /**
   * Total notifications sent
   */
  totalSent: number;

  /**
   * Total delivered
   */
  totalDelivered: number;

  /**
   * Total failed
   */
  totalFailed: number;

  /**
   * Total retried
   */
  totalRetried: number;

  /**
   * Total dead lettered
   */
  totalDeadLettered: number;

  /**
   * Overall success rate
   */
  successRate: number;

  /**
   * Overall average delivery time
   */
  avgDeliveryTime: number;

  /**
   * Current queue size
   */
  queueSize: number;

  /**
   * Current processing count
   */
  processingCount: number;

  /**
   * Timestamp of last update
   */
  lastUpdatedAt: number;
}

// ============================================================================
// Delivery Service Configuration
// ============================================================================

/**
 * Complete configuration for notification delivery service
 */
export interface DeliveryServiceConfig {
  /**
   * Retry configuration
   */
  retry?: Partial<RetryConfig>;

  /**
   * Backpressure configuration
   */
  backpressure?: Partial<BackpressureConfig>;

  /**
   * Dead letter configuration
   */
  deadLetter?: Partial<DeadLetterConfig>;

  /**
   * Whether to enable metrics collection
   */
  enableMetrics?: boolean;

  /**
   * Metrics update interval (milliseconds)
   */
  metricsUpdateInterval?: number;

  /**
   * Whether to enable persistence
   */
  enablePersistence?: boolean;

  /**
   * Persistence key prefix
   */
  persistencePrefix?: string;
}

/**
 * Default delivery service configuration
 */
export const DefaultDeliveryServiceConfig: DeliveryServiceConfig = {
  retry: DefaultRetryConfig,
  backpressure: DefaultBackpressureConfig,
  deadLetter: DefaultDeadLetterConfig,
  enableMetrics: true,
  metricsUpdateInterval: 60000, // 1 minute
  enablePersistence: false,
  persistencePrefix: 'notification_delivery',
};

// ============================================================================
// Platform Delivery Handler
// ============================================================================

/**
 * Handler for delivering notifications to a specific platform
 */
export interface PlatformDeliveryHandler {
  /**
   * Platform this handler delivers to
   */
  platform: DeliveryPlatform;

  /**
   * Deliver a notification
   */
  deliver(message: NotificationMessage): Promise<DeliveryResult>;

  /**
   * Check if handler is available
   */
  isAvailable(): boolean;

  /**
   * Get handler health status
   */
  getHealth(): {
    available: boolean;
    latency?: number;
    errorRate?: number;
  };
}
