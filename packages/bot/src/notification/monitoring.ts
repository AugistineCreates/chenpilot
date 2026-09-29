/**
 * Notification Delivery Monitoring
 * Observability and monitoring for the notification delivery service
 */

import {
  DeliveryMetrics,
  PlatformMetrics,
  DeliveryStatus,
  NotificationDeliveryState,
} from './core.js';

/**
 * Monitoring event types
 */
export enum MonitoringEventType {
  NOTIFICATION_QUEUED = 'notification_queued',
  NOTIFICATION_DELIVERED = 'notification_delivered',
  NOTIFICATION_FAILED = 'notification_failed',
  NOTIFICATION_RETRIED = 'notification_retried',
  NOTIFICATION_DEAD_LETTERED = 'notification_dead_lettered',
  BACKPRESSURE_TRIGGERED = 'backpressure_triggered',
  BACKPRESSURE_RELEASED = 'backpressure_released',
  HANDLER_UNAVAILABLE = 'handler_unavailable',
  HANDLER_RECOVERED = 'handler_recovered',
  QUEUE_FULL = 'queue_full',
  DEAD_LETTER_FULL = 'dead_letter_full',
}

/**
 * Monitoring event
 */
export interface MonitoringEvent {
  type: MonitoringEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

/**
 * Alert threshold configuration
 */
export interface AlertThreshold {
  /**
   * Metric name
   */
  metric: string;

  /**
   * Threshold value
   */
  threshold: number;

  /**
   * Comparison operator
   */
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';

  /**
   * Alert callback
   */
  onAlert: (current: number, threshold: number) => void;
}

/**
 * Monitoring service configuration
 */
export interface MonitoringConfig {
  /**
   * Enable event logging
   */
  enableEventLogging?: boolean;

  /**
   * Maximum event history size
   */
  maxEventHistory?: number;

  /**
   * Alert thresholds
   */
  alertThresholds?: AlertThreshold[];

  /**
   * Metrics update interval (milliseconds)
   */
  metricsUpdateInterval?: number;
}

/**
 * Notification monitoring service
 */
export class NotificationMonitoringService {
  private events: MonitoringEvent[];
  private maxEventHistory: number;
  private alertThresholds: AlertThreshold[];
  private enabled: boolean;
  private metricsUpdateInterval: number;
  private metricsTimer: any;
  private lastMetrics: DeliveryMetrics | null;
  private alertState: Map<string, boolean>;

  constructor(config: MonitoringConfig = {}) {
    this.events = [];
    this.maxEventHistory = config.maxEventHistory || 1000;
    this.alertThresholds = config.alertThresholds || [];
    this.enabled = config.enableEventLogging ?? true;
    this.metricsUpdateInterval = config.metricsUpdateInterval || 60000;
    this.metricsTimer = null;
    this.lastMetrics = null;
    this.alertState = new Map();
  }

  /**
   * Log a monitoring event
   */
  logEvent(type: MonitoringEventType, data: Record<string, unknown>): void {
    if (!this.enabled) return;

    const event: MonitoringEvent = {
      type,
      timestamp: Date.now(),
      data,
    };

    this.events.push(event);

    // Enforce max history size
    if (this.events.length > this.maxEventHistory) {
      this.events.shift();
    }
  }

  /**
   * Get event history
   */
  getEventHistory(filter?: {
    type?: MonitoringEventType;
    since?: number;
    until?: number;
  }): MonitoringEvent[] {
    let filtered = this.events;

    if (filter?.type) {
      filtered = filtered.filter(e => e.type === filter.type);
    }

    if (filter?.since) {
      filtered = filtered.filter(e => e.timestamp >= filter.since!);
    }

    if (filter?.until) {
      filtered = filtered.filter(e => e.timestamp <= filter.until!);
    }

    return filtered;
  }

  /**
   * Get event statistics
   */
  getEventStats(): Record<MonitoringEventType, number> {
    const stats: Record<string, number> = {};

    for (const event of this.events) {
      stats[event.type] = (stats[event.type] || 0) + 1;
    }

    return stats as Record<MonitoringEventType, number>;
  }

  /**
   * Update metrics and check alerts
   */
  updateMetrics(metrics: DeliveryMetrics): void {
    this.lastMetrics = metrics;
    this.checkAlerts(metrics);
  }

  /**
   * Check alert thresholds
   */
  private checkAlerts(metrics: DeliveryMetrics): void {
    for (const threshold of this.alertThresholds) {
      const currentValue = this.getMetricValue(metrics, threshold.metric);
      if (currentValue === undefined) continue;

      const triggered = this.evaluateThreshold(currentValue, threshold);
      const previousState = this.alertState.get(threshold.metric) || false;

      if (triggered && !previousState) {
        // Alert triggered
        threshold.onAlert(currentValue, threshold.threshold);
        this.alertState.set(threshold.metric, true);
        this.logEvent(MonitoringEventType.HANDLER_UNAVAILABLE, {
          metric: threshold.metric,
          currentValue,
          threshold: threshold.threshold,
        });
      } else if (!triggered && previousState) {
        // Alert cleared
        this.alertState.set(threshold.metric, false);
        this.logEvent(MonitoringEventType.HANDLER_RECOVERED, {
          metric: threshold.metric,
          currentValue,
        });
      }
    }
  }

  /**
   * Get metric value by name
   */
  private getMetricValue(metrics: DeliveryMetrics, metric: string): number | undefined {
    switch (metric) {
      case 'queueSize':
        return metrics.queueSize;
      case 'processingCount':
        return metrics.processingCount;
      case 'successRate':
        return metrics.successRate;
      case 'avgDeliveryTime':
        return metrics.avgDeliveryTime;
      case 'totalFailed':
        return metrics.totalFailed;
      case 'totalDeadLettered':
        return metrics.totalDeadLettered;
      default:
        // Check platform metrics
        for (const [platform, platformMetrics] of metrics.byPlatform) {
          if (metric.startsWith(`${platform}.`)) {
            const platformMetric = metric.substring(platform.length + 1);
            switch (platformMetric) {
              case 'totalSent':
                return platformMetrics.totalSent;
              case 'delivered':
                return platformMetrics.delivered;
              case 'failed':
                return platformMetrics.failed;
              case 'retried':
                return platformMetrics.retried;
              case 'deadLettered':
                return platformMetrics.deadLettered;
              case 'avgDeliveryTime':
                return platformMetrics.avgDeliveryTime;
              case 'queueSize':
                return platformMetrics.queueSize;
              case 'processingCount':
                return platformMetrics.processingCount;
            }
          }
        }
        return undefined;
    }
  }

  /**
   * Evaluate threshold condition
   */
  private evaluateThreshold(current: number, threshold: AlertThreshold): boolean {
    switch (threshold.operator) {
      case 'gt':
        return current > threshold.threshold;
      case 'lt':
        return current < threshold.threshold;
      case 'eq':
        return current === threshold.threshold;
      case 'gte':
        return current >= threshold.threshold;
      case 'lte':
        return current <= threshold.threshold;
      default:
        return false;
    }
  }

  /**
   * Add alert threshold
   */
  addAlertThreshold(threshold: AlertThreshold): void {
    this.alertThresholds.push(threshold);
  }

  /**
   * Remove alert threshold
   */
  removeAlertThreshold(metric: string): void {
    this.alertThresholds = this.alertThresholds.filter(t => t.metric !== metric);
    this.alertState.delete(metric);
  }

  /**
   * Get last metrics snapshot
   */
  getLastMetrics(): DeliveryMetrics | null {
    return this.lastMetrics;
  }

  /**
   * Clear event history
   */
  clearEventHistory(): void {
    this.events = [];
  }

  /**
   * Enable/disable monitoring
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Get monitoring summary
   */
  getSummary(): {
    enabled: boolean;
    eventCount: number;
    alertCount: number;
    activeAlerts: string[];
    lastMetrics?: DeliveryMetrics;
  } {
    const activeAlerts = Array.from(this.alertState.entries())
      .filter(([_, triggered]) => triggered)
      .map(([metric]) => metric);

    return {
      enabled: this.enabled,
      eventCount: this.events.length,
      alertCount: this.alertThresholds.length,
      activeAlerts,
      lastMetrics: this.lastMetrics || undefined,
    };
  }

  /**
   * Generate health report
   */
  generateHealthReport(): {
    healthy: boolean;
    issues: string[];
    warnings: string[];
    metrics?: DeliveryMetrics;
  } {
    const issues: string[] = [];
    const warnings: string[] = [];

    if (!this.lastMetrics) {
      return {
        healthy: false,
        issues: ['No metrics available'],
        warnings: [],
      };
    }

    const metrics = this.lastMetrics;

    // Check for issues
    if (metrics.successRate < 0.9) {
      issues.push(`Low success rate: ${(metrics.successRate * 100).toFixed(1)}%`);
    }

    if (metrics.totalFailed > 100) {
      issues.push(`High failure count: ${metrics.totalFailed}`);
    }

    if (metrics.totalDeadLettered > 10) {
      issues.push(`High dead letter count: ${metrics.totalDeadLettered}`);
    }

    if (metrics.avgDeliveryTime > 5000) {
      warnings.push(`High average delivery time: ${metrics.avgDeliveryTime}ms`);
    }

    if (metrics.queueSize > 500) {
      warnings.push(`High queue size: ${metrics.queueSize}`);
    }

    // Check platform-specific issues
    for (const [platform, platformMetrics] of metrics.byPlatform) {
      const platformTotal = platformMetrics.delivered + platformMetrics.failed;
      const platformSuccessRate = platformTotal > 0 ? platformMetrics.delivered / platformTotal : 0;

      if (platformSuccessRate < 0.8 && platformTotal > 10) {
        issues.push(`${platform} low success rate: ${(platformSuccessRate * 100).toFixed(1)}%`);
      }

      if (platformMetrics.deadLettered > 5) {
        issues.push(`${platform} high dead letter count: ${platformMetrics.deadLettered}`);
      }
    }

    return {
      healthy: issues.length === 0,
      issues,
      warnings,
      metrics,
    };
  }

  /**
   * Export metrics for external monitoring
   */
  exportMetrics(): {
    timestamp: number;
    metrics: DeliveryMetrics;
    events: MonitoringEvent[];
    alerts: Record<string, boolean>;
  } {
    return {
      timestamp: Date.now(),
      metrics: this.lastMetrics || this.createEmptyMetrics(),
      events: this.events,
      alerts: Object.fromEntries(this.alertState),
    };
  }

  /**
   * Create empty metrics
   */
  private createEmptyMetrics(): DeliveryMetrics {
    return {
      byPlatform: new Map(),
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
   * Shutdown monitoring
   */
  shutdown(): void {
    if (this.metricsTimer) {
      // @ts-ignore - clearInterval should be available at runtime
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
  }
}

/**
 * Default alert thresholds
 */
export const DefaultAlertThresholds: AlertThreshold[] = [
  {
    metric: 'successRate',
    threshold: 0.9,
    operator: 'lt',
    onAlert: (current, threshold) => {
      // @ts-ignore - console should be available at runtime
      if (typeof console !== 'undefined') {
        // @ts-ignore
        console.warn(`ALERT: Success rate dropped below ${(threshold * 100).toFixed(0)}%: ${(current * 100).toFixed(1)}%`);
      }
    },
  },
  {
    metric: 'queueSize',
    threshold: 800,
    operator: 'gt',
    onAlert: (current, threshold) => {
      // @ts-ignore - console should be available at runtime
      if (typeof console !== 'undefined') {
        // @ts-ignore
        console.warn(`ALERT: Queue size exceeded threshold: ${current} > ${threshold}`);
      }
    },
  },
  {
    metric: 'totalFailed',
    threshold: 50,
    operator: 'gt',
    onAlert: (current, threshold) => {
      // @ts-ignore - console should be available at runtime
      if (typeof console !== 'undefined') {
        // @ts-ignore
        console.warn(`ALERT: High failure count: ${current} > ${threshold}`);
      }
    },
  },
];
