# Bot Analytics Pipeline - Command to Backend Execution Correlation

## Overview

Extend bot performance profiling into a meaningful analytics surface that ties command usage, failures, latency, and downstream execution outcomes together for operator visibility.

## Current State Analysis

### Existing Performance Profiling

**Current Features**:
- Basic command execution timing
- Simple error logging
- Rate limiting metrics
- Performance profiling hooks

**Limitations**:
1. **No Correlation**: Commands not linked to backend execution outcomes
2. **Limited Metrics**: Only basic timing and error counts
3. **No Aggregation**: No trend analysis or aggregation over time
3. **No Context**: Missing user, channel, or temporal context
4. **No Alerts**: No anomaly detection or alerting
5. **No Visualization**: No dashboards or reporting
6. **No Retention**: No long-term data storage
7. **No Analysis**: No insights or recommendations

## Analytics Pipeline Design

### Core Components

```typescript
interface AnalyticsConfig {
  // Data collection
  enableCommandTracking: boolean;
  enableBackendTracking: boolean;
  enableUserTracking: boolean;
  enableChannelTracking: boolean;
  
  // Data retention
  retentionPeriodDays: number;
  aggregationIntervalMinutes: number;
  
  // Sampling
  samplingRate: number;  // 0-1, 1 = 100%
  maxEventsPerSecond: number;
  
  // Storage
  storageBackend: 'memory' | 'file' | 'database';
  storageConfig: StorageConfig;
  
  // Real-time processing
  enableRealtimeAggregation: boolean;
  enableAlerting: boolean;
  
  // Privacy
  anonymizeUsers: boolean;
  anonymizeChannels: boolean;
}
```

### Event Schema

```typescript
interface CommandEvent {
  eventId: string;
  timestamp: number;
  platform: 'telegram' | 'discord';
  
  // Command details
  command: string;
  commandType: 'slash' | 'legacy' | 'button' | 'modal';
  userId: string;
  channelId: string;
  guildId?: string;
  
  // Execution details
  executionTimeMs: number;
  status: 'success' | 'error' | 'timeout';
  errorMessage?: string;
  errorCode?: string;
  
  // Input details
  inputSize: number;
  inputHash?: string;
  
  // Context
  metadata: Record<string, unknown>;
  tags: string[];
}

interface BackendEvent {
  eventId: string;
  timestamp: number;
  
  // Backend details
  operation: string;
  service: string;
  endpoint: string;
  
  // Execution details
  executionTimeMs: number;
  status: 'success' | 'error' | 'timeout';
  statusCode?: number;
  errorMessage?: string;
  
  // Request details
  requestSize: number;
  responseSize: number;
  
  // Correlation
  commandEventId?: string;
  userId?: string;
  sessionId?: string;
  
  // Context
  metadata: Record<string, unknown>;
  tags: string[];
}

interface CorrelationEvent {
  correlationId: string;
  commandEvent: CommandEvent;
  backendEvents: BackendEvent[];
  
  // Aggregated metrics
  totalLatencyMs: number;
  commandLatencyMs: number;
  backendLatencyMs: number;
  
  // Status
  overallStatus: 'success' | 'partial_failure' | 'complete_failure';
  
  // Analysis
  bottleneck?: 'command' | 'backend' | 'network' | 'unknown';
  performanceScore: number;  // 0-100
}
```

### Pipeline Architecture

```typescript
class AnalyticsPipeline {
  private eventCollector: EventCollector;
  private eventCorrelator: EventCorrelator;
  private eventAggregator: EventAggregator;
  private eventStorage: EventStorage;
  private alertManager: AlertManager;
  private dashboardGenerator: DashboardGenerator;
  
  constructor(config: AnalyticsConfig) {
    this.eventCollector = new EventCollector(config);
    this.eventCorrelator = new EventCorrelator(config);
    this.eventAggregator = new EventAggregator(config);
    this.eventStorage = new EventStorage(config);
    this.alertManager = new AlertManager(config);
    this.dashboardGenerator = new DashboardGenerator(config);
  }
  
  async trackCommand(event: CommandEvent): Promise<void> {
    await this.eventCollector.collectCommand(event);
  }
  
  async trackBackend(event: BackendEvent): Promise<void> {
    await this.eventCollector.collectBackend(event);
  }
  
  async correlateEvents(timeWindowMs: number): Promise<CorrelationEvent[]> {
    return this.eventCorrelator.correlate(timeWindowMs);
  }
  
  async aggregateMetrics(interval: string): Promise<AggregatedMetrics> {
    return this.eventAggregator.aggregate(interval);
  }
  
  async generateDashboard(timeRange: string): Promise<DashboardData> {
    return this.dashboardGenerator.generate(timeRange);
  }
  
  async checkAlerts(): Promise<Alert[]> {
    return this.alertManager.checkAlerts();
  }
}
```

### Event Collector

```typescript
class EventCollector {
  private commandBuffer: CommandEvent[];
  private backendBuffer: BackendEvent[];
  private samplingRate: number;
  private maxEventsPerSecond: number;
  private eventCount: number;
  private lastSecond: number;
  
  constructor(config: AnalyticsConfig) {
    this.commandBuffer = [];
    this.backendBuffer = [];
    this.samplingRate = config.samplingRate;
    this.maxEventsPerSecond = config.maxEventsPerSecond;
    this.eventCount = 0;
    this.lastSecond = Math.floor(Date.now() / 1000);
  }
  
  async collectCommand(event: CommandEvent): Promise<void> {
    // Check sampling rate
    if (Math.random() > this.samplingRate) {
      return;
    }
    
    // Check rate limit
    const currentSecond = Math.floor(Date.now() / 1000);
    if (currentSecond !== this.lastSecond) {
      this.eventCount = 0;
      this.lastSecond = currentSecond;
    }
    
    if (this.eventCount >= this.maxEventsPerSecond) {
      return;
    }
    
    this.eventCount++;
    
    // Add to buffer
    this.commandBuffer.push(event);
    
    // Flush if buffer is full
    if (this.commandBuffer.length >= 100) {
      await this.flushCommands();
    }
  }
  
  async collectBackend(event: BackendEvent): Promise<void> {
    // Similar sampling and rate limiting
    this.backendBuffer.push(event);
    
    if (this.backendBuffer.length >= 100) {
      await this.flushBackend();
    }
  }
  
  async flushCommands(): Promise<void> {
    if (this.commandBuffer.length === 0) return;
    
    const events = [...this.commandBuffer];
    this.commandBuffer = [];
    
    await this.eventStorage.storeCommands(events);
  }
  
  async flushBackend(): Promise<void> {
    if (this.backendBuffer.length === 0) return;
    
    const events = [...this.backendBuffer];
    this.backendBuffer = [];
    
    await this.eventStorage.storeBackend(events);
  }
  
  async flushAll(): Promise<void> {
    await Promise.all([
      this.flushCommands(),
      this.flushBackend(),
    ]);
  }
}
```

### Event Correlator

```typescript
class EventCorrelator {
  private correlationWindowMs: number;
  
  async correlate(timeWindowMs: number): Promise<CorrelationEvent[]> {
    this.correlationWindowMs = timeWindowMs;
    
    // Get recent events
    const commandEvents = await this.eventStorage.getRecentCommands(timeWindowMs);
    const backendEvents = await this.eventStorage.getRecentBackend(timeWindowMs);
    
    // Build correlation map
    const correlations: CorrelationEvent[] = [];
    
    for (const commandEvent of commandEvents) {
      const relatedBackendEvents = this.findRelatedBackendEvents(
        commandEvent,
        backendEvents
      );
      
      if (relatedBackendEvents.length > 0) {
        const correlation = this.buildCorrelation(
          commandEvent,
          relatedBackendEvents
        );
        correlations.push(correlation);
      }
    }
    
    return correlations;
  }
  
  private findRelatedBackendEvents(
    commandEvent: CommandEvent,
    backendEvents: BackendEvent[]
  ): BackendEvent[] {
    const related: BackendEvent[] = [];
    
    for (const backendEvent of backendEvents) {
      // Check time window
      const timeDiff = Math.abs(backendEvent.timestamp - commandEvent.timestamp);
      if (timeDiff > this.correlationWindowMs) {
        continue;
      }
      
      // Check user correlation
      if (backendEvent.userId && backendEvent.userId !== commandEvent.userId) {
        continue;
      }
      
      // Check explicit correlation ID
      if (backendEvent.commandEventId === commandEvent.eventId) {
        related.push(backendEvent);
        continue;
      }
      
      // Check operation/command matching
      if (this.isOperationRelated(commandEvent.command, backendEvent.operation)) {
        related.push(backendEvent);
      }
    }
    
    return related;
  }
  
  private buildCorrelation(
    commandEvent: CommandEvent,
    backendEvents: BackendEvent[]
  ): CorrelationEvent {
    const totalLatencyMs = Math.max(
      ...backendEvents.map(e => e.timestamp + e.executionTimeMs)
    ) - commandEvent.timestamp;
    
    const commandLatencyMs = commandEvent.executionTimeMs;
    const backendLatencyMs = backendEvents.reduce(
      (sum, e) => sum + e.executionTimeMs,
      0
    );
    
    const overallStatus = this.determineOverallStatus(commandEvent, backendEvents);
    const bottleneck = this.identifyBottleneck(commandEvent, backendEvents);
    const performanceScore = this.calculatePerformanceScore(
      commandEvent,
      backendEvents,
      totalLatencyMs
    );
    
    return {
      correlationId: this.generateCorrelationId(),
      commandEvent,
      backendEvents,
      totalLatencyMs,
      commandLatencyMs,
      backendLatencyMs,
      overallStatus,
      bottleneck,
      performanceScore,
    };
  }
  
  private determineOverallStatus(
    commandEvent: CommandEvent,
    backendEvents: BackendEvent[]
  ): 'success' | 'partial_failure' | 'complete_failure' {
    if (commandEvent.status === 'error') {
      return 'complete_failure';
    }
    
    const failedBackend = backendEvents.filter(e => e.status !== 'success');
    if (failedBackend.length === 0) {
      return 'success';
    }
    
    if (failedBackend.length === backendEvents.length) {
      return 'complete_failure';
    }
    
    return 'partial_failure';
  }
  
  private identifyBottleneck(
    commandEvent: CommandEvent,
    backendEvents: BackendEvent[]
  ): 'command' | 'backend' | 'network' | 'unknown' {
    const commandRatio = commandEvent.executionTimeMs / commandEvent.executionTimeMs;
    const backendRatio = backendEvents.reduce(
      (sum, e) => sum + e.executionTimeMs,
      0
    ) / commandEvent.executionTimeMs;
    
    if (commandRatio > 0.7) return 'command';
    if (backendRatio > 0.7) return 'backend';
    return 'unknown';
  }
  
  private calculatePerformanceScore(
    commandEvent: CommandEvent,
    backendEvents: BackendEvent[],
    totalLatencyMs: number
  ): number {
    // Base score starts at 100
    let score = 100;
    
    // Deduct for errors
    if (commandEvent.status === 'error') score -= 50;
    const failedBackend = backendEvents.filter(e => e.status !== 'success').length;
    score -= failedBackend * 10;
    
    // Deduct for latency
    const latencyPenalty = Math.min(totalLatencyMs / 1000, 50);
    score -= latencyPenalty;
    
    return Math.max(0, Math.min(100, score));
  }
  
  private isOperationRelated(command: string, operation: string): boolean {
    // Simple matching logic - can be enhanced
    return command.toLowerCase().includes(operation.toLowerCase()) ||
           operation.toLowerCase().includes(command.toLowerCase());
  }
  
  private generateCorrelationId(): string {
    return `corr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

### Event Aggregator

```typescript
class EventAggregator {
  async aggregate(interval: string): Promise<AggregatedMetrics> {
    const timeRange = this.parseInterval(interval);
    
    // Get events in time range
    const commandEvents = await this.eventStorage.getCommandsInRange(timeRange);
    const backendEvents = await this.eventStorage.getBackendInRange(timeRange);
    const correlations = await this.eventStorage.getCorrelationsInRange(timeRange);
    
    // Aggregate command metrics
    const commandMetrics = this.aggregateCommands(commandEvents);
    
    // Aggregate backend metrics
    const backendMetrics = this.aggregateBackends(backendEvents);
    
    // Aggregate correlation metrics
    const correlationMetrics = this.aggregateCorrelations(correlations);
    
    // Aggregate user metrics
    const userMetrics = this.aggregateUsers(commandEvents, backendEvents);
    
    // Aggregate channel metrics
    const channelMetrics = this.aggregateChannels(commandEvents);
    
    return {
      timeRange,
      interval,
      commandMetrics,
      backendMetrics,
      correlationMetrics,
      userMetrics,
      channelMetrics,
      timestamp: Date.now(),
    };
  }
  
  private aggregateCommands(events: CommandEvent[]): CommandMetrics {
    const total = events.length;
    const successful = events.filter(e => e.status === 'success').length;
    const failed = events.filter(e => e.status === 'error').length;
    const timeouts = events.filter(e => e.status === 'timeout').length;
    
    const avgExecutionTime = total > 0
      ? events.reduce((sum, e) => sum + e.executionTimeMs, 0) / total
      : 0;
    
    const p50ExecutionTime = this.percentile(events.map(e => e.executionTimeMs), 50);
    const p95ExecutionTime = this.percentile(events.map(e => e.executionTimeMs), 95);
    const p99ExecutionTime = this.percentile(events.map(e => e.executionTimeMs), 99);
    
    // Command breakdown
    const commandBreakdown = this.groupByCommand(events);
    
    // Platform breakdown
    const platformBreakdown = this.groupByPlatform(events);
    
    return {
      total,
      successful,
      failed,
      timeouts,
      successRate: total > 0 ? successful / total : 0,
      avgExecutionTime,
      p50ExecutionTime,
      p95ExecutionTime,
      p99ExecutionTime,
      commandBreakdown,
      platformBreakdown,
    };
  }
  
  private aggregateBackends(events: BackendEvent[]): BackendMetrics {
    const total = events.length;
    const successful = events.filter(e => e.status === 'success').length;
    const failed = events.filter(e => e.status === 'error').length;
    const timeouts = events.filter(e => e.status === 'timeout').length;
    
    const avgExecutionTime = total > 0
      ? events.reduce((sum, e) => sum + e.executionTimeMs, 0) / total
      : 0;
    
    const avgRequestSize = total > 0
      ? events.reduce((sum, e) => sum + e.requestSize, 0) / total
      : 0;
    
    const avgResponseSize = total > 0
      ? events.reduce((sum, e) => sum + e.responseSize, 0) / total
      : 0;
    
    // Service breakdown
    const serviceBreakdown = this.groupByService(events);
    
    // Endpoint breakdown
    const endpointBreakdown = this.groupByEndpoint(events);
    
    return {
      total,
      successful,
      failed,
      timeouts,
      successRate: total > 0 ? successful / total : 0,
      avgExecutionTime,
      avgRequestSize,
      avgResponseSize,
      serviceBreakdown,
      endpointBreakdown,
    };
  }
  
  private aggregateCorrelations(events: CorrelationEvent[]): CorrelationMetrics {
    const total = events.length;
    const successful = events.filter(e => e.overallStatus === 'success').length;
    const partialFailures = events.filter(e => e.overallStatus === 'partial_failure').length;
    const completeFailures = events.filter(e => e.overallStatus === 'complete_failure').length;
    
    const avgTotalLatency = total > 0
      ? events.reduce((sum, e) => sum + e.totalLatencyMs, 0) / total
      : 0;
    
    const avgCommandLatency = total > 0
      ? events.reduce((sum, e) => sum + e.commandLatencyMs, 0) / total
      : 0;
    
    const avgBackendLatency = total > 0
      ? events.reduce((sum, e) => sum + e.backendLatencyMs, 0) / total
      : 0;
    
    const avgPerformanceScore = total > 0
      ? events.reduce((sum, e) => sum + e.performanceScore, 0) / total
      : 0;
    
    // Bottleneck breakdown
    const bottleneckBreakdown = this.groupByBottleneck(events);
    
    return {
      total,
      successful,
      partialFailures,
      completeFailures,
      successRate: total > 0 ? successful / total : 0,
      avgTotalLatency,
      avgCommandLatency,
      avgBackendLatency,
      avgPerformanceScore,
      bottleneckBreakdown,
    };
  }
  
  private aggregateUsers(
    commandEvents: CommandEvent[],
    backendEvents: BackendEvent[]
  ): UserMetrics {
    const userCommandCounts = this.groupByUser(commandEvents);
    const userBackendCounts = this.groupByUserBackend(backendEvents);
    
    const topUsersByCommands = this.getTopUsers(userCommandCounts, 10);
    const topUsersByBackend = this.getTopUsers(userBackendCounts, 10);
    
    return {
      totalUsers: new Set([...Object.keys(userCommandCounts), ...Object.keys(userBackendCounts)]).size,
      topUsersByCommands,
      topUsersByBackend,
    };
  }
  
  private aggregateChannels(events: CommandEvent[]): ChannelMetrics {
    const channelCounts = this.groupByChannel(events);
    
    const topChannels = this.getTopChannels(channelCounts, 10);
    
    return {
      totalChannels: Object.keys(channelCounts).length,
      topChannels,
    };
  }
  
  private percentile(values: number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
  
  private groupByCommand(events: CommandEvent[]): Record<string, number> {
    return events.reduce((acc, e) => {
      acc[e.command] = (acc[e.command] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }
  
  private groupByPlatform(events: CommandEvent[]): Record<string, number> {
    return events.reduce((acc, e) => {
      acc[e.platform] = (acc[e.platform] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }
  
  private groupByService(events: BackendEvent[]): Record<string, number> {
    return events.reduce((acc, e) => {
      acc[e.service] = (acc[e.service] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }
  
  private groupByEndpoint(events: BackendEvent[]): Record<string, number> {
    return events.reduce((acc, e) => {
      acc[e.endpoint] = (acc[e.endpoint] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }
  
  private groupByBottleneck(events: CorrelationEvent[]): Record<string, number> {
    return events.reduce((acc, e) => {
      acc[e.bottleneck] = (acc[e.bottleneck] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }
  
  private groupByUser(events: CommandEvent[]): Record<string, number> {
    return events.reduce((acc, e) => {
      acc[e.userId] = (acc[e.userId] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }
  
  private groupByChannel(events: CommandEvent[]): Record<string, number> {
    return events.reduce((acc, e) => {
      acc[e.channelId] = (acc[e.channelId] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }
  
  private getTopUsers(counts: Record<string, number>, limit: number): Array<{userId: string; count: number}> {
    return Object.entries(counts)
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
  
  private getTopChannels(counts: Record<string, number>, limit: number): Array<{channelId: string; count: number}> {
    return Object.entries(counts)
      .map(([channelId, count]) => ({ channelId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
  
  private parseInterval(interval: string): { start: number; end: number } {
    const now = Date.now();
    
    switch (interval) {
      case '1h':
        return { start: now - 3600000, end: now };
      case '24h':
        return { start: now - 86400000, end: now };
      case '7d':
        return { start: now - 604800000, end: now };
      case '30d':
        return { start: now - 2592000000, end: now };
      default:
        return { start: now - 3600000, end: now };
    }
  }
}
```

### Alert Manager

```typescript
class AlertManager {
  private alertRules: AlertRule[];
  private activeAlerts: Map<string, Alert>;
  
  constructor(config: AnalyticsConfig) {
    this.alertRules = this.getDefaultAlertRules();
    this.activeAlerts = new Map();
  }
  
  async checkAlerts(): Promise<Alert[]> {
    const metrics = await this.eventAggregator.aggregate('1h');
    const newAlerts: Alert[] = [];
    
    for (const rule of this.alertRules) {
      const triggered = await this.evaluateRule(rule, metrics);
      
      if (triggered) {
        const alert = this.createAlert(rule, metrics);
        newAlerts.push(alert);
        this.activeAlerts.set(alert.id, alert);
      }
    }
    
    return newAlerts;
  }
  
  private async evaluateRule(rule: AlertRule, metrics: AggregatedMetrics): Promise<boolean> {
    switch (rule.type) {
      case 'high_error_rate':
        return metrics.commandMetrics.successRate < rule.threshold;
      case 'high_latency':
        return metrics.commandMetrics.p95ExecutionTime > rule.threshold;
      case 'backend_failure':
        return metrics.backendMetrics.successRate < rule.threshold;
      case 'correlation_failure':
        return metrics.correlationMetrics.successRate < rule.threshold;
      default:
        return false;
    }
  }
  
  private createAlert(rule: AlertRule, metrics: AggregatedMetrics): Alert {
    return {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: rule.type,
      severity: rule.severity,
      message: rule.message,
      metrics: this.extractRelevantMetrics(rule.type, metrics),
      timestamp: Date.now(),
      acknowledged: false,
    };
  }
  
  private extractRelevantMetrics(type: string, metrics: AggregatedMetrics): Record<string, number> {
    switch (type) {
      case 'high_error_rate':
        return {
          successRate: metrics.commandMetrics.successRate,
          totalCommands: metrics.commandMetrics.total,
        };
      case 'high_latency':
        return {
          p95Latency: metrics.commandMetrics.p95ExecutionTime,
          avgLatency: metrics.commandMetrics.avgExecutionTime,
        };
      case 'backend_failure':
        return {
          successRate: metrics.backendMetrics.successRate,
          totalRequests: metrics.backendMetrics.total,
        };
      case 'correlation_failure':
        return {
          successRate: metrics.correlationMetrics.successRate,
          totalCorrelations: metrics.correlationMetrics.total,
        };
      default:
        return {};
    }
  }
  
  private getDefaultAlertRules(): AlertRule[] {
    return [
      {
        type: 'high_error_rate',
        threshold: 0.95,
        severity: 'critical',
        message: 'Command error rate exceeds 5%',
        enabled: true,
      },
      {
        type: 'high_latency',
        threshold: 5000,
        severity: 'warning',
        message: 'P95 command latency exceeds 5 seconds',
        enabled: true,
      },
      {
        type: 'backend_failure',
        threshold: 0.95,
        severity: 'critical',
        message: 'Backend success rate below 95%',
        enabled: true,
      },
      {
        type: 'correlation_failure',
        threshold: 0.90,
        severity: 'warning',
        message: 'Correlation success rate below 90%',
        enabled: true,
      },
    ];
  }
}
```

### Dashboard Generator

```typescript
class DashboardGenerator {
  async generate(timeRange: string): Promise<DashboardData> {
    const metrics = await this.eventAggregator.aggregate(timeRange);
    
    return {
      overview: this.generateOverview(metrics),
      commandPerformance: this.generateCommandPerformance(metrics),
      backendPerformance: this.generateBackendPerformance(metrics),
      correlationAnalysis: this.generateCorrelationAnalysis(metrics),
      userActivity: this.generateUserActivity(metrics),
      channelActivity: this.generateChannelActivity(metrics),
      alerts: await this.alertManager.checkAlerts(),
      timestamp: Date.now(),
    };
  }
  
  private generateOverview(metrics: AggregatedMetrics): OverviewData {
    return {
      totalCommands: metrics.commandMetrics.total,
      commandSuccessRate: metrics.commandMetrics.successRate,
      avgCommandLatency: metrics.commandMetrics.avgExecutionTime,
      totalBackendRequests: metrics.backendMetrics.total,
      backendSuccessRate: metrics.backendMetrics.successRate,
      avgBackendLatency: metrics.backendMetrics.avgExecutionTime,
      totalCorrelations: metrics.correlationMetrics.total,
      correlationSuccessRate: metrics.correlationMetrics.successRate,
      avgPerformanceScore: metrics.correlationMetrics.avgPerformanceScore,
    };
  }
  
  private generateCommandPerformance(metrics: AggregatedMetrics): CommandPerformanceData {
    return {
      successRate: metrics.commandMetrics.successRate,
      avgExecutionTime: metrics.commandMetrics.avgExecutionTime,
      p50ExecutionTime: metrics.commandMetrics.p50ExecutionTime,
      p95ExecutionTime: metrics.commandMetrics.p95ExecutionTime,
      p99ExecutionTime: metrics.commandMetrics.p99ExecutionTime,
      commandBreakdown: metrics.commandMetrics.commandBreakdown,
      platformBreakdown: metrics.commandMetrics.platformBreakdown,
    };
  }
  
  private generateBackendPerformance(metrics: AggregatedMetrics): BackendPerformanceData {
    return {
      successRate: metrics.backendMetrics.successRate,
      avgExecutionTime: metrics.backendMetrics.avgExecutionTime,
      avgRequestSize: metrics.backendMetrics.avgRequestSize,
      avgResponseSize: metrics.backendMetrics.avgResponseSize,
      serviceBreakdown: metrics.backendMetrics.serviceBreakdown,
      endpointBreakdown: metrics.backendMetrics.endpointBreakdown,
    };
  }
  
  private generateCorrelationAnalysis(metrics: AggregatedMetrics): CorrelationAnalysisData {
    return {
      successRate: metrics.correlationMetrics.successRate,
      avgTotalLatency: metrics.correlationMetrics.avgTotalLatency,
      avgCommandLatency: metrics.correlationMetrics.avgCommandLatency,
      avgBackendLatency: metrics.correlationMetrics.avgBackendLatency,
      avgPerformanceScore: metrics.correlationMetrics.avgPerformanceScore,
      bottleneckBreakdown: metrics.correlationMetrics.bottleneckBreakdown,
    };
  }
  
  private generateUserActivity(metrics: AggregatedMetrics): UserActivityData {
    return {
      totalUsers: metrics.userMetrics.totalUsers,
      topUsersByCommands: metrics.userMetrics.topUsersByCommands,
      topUsersByBackend: metrics.userMetrics.topUsersByBackend,
    };
  }
  
  private generateChannelActivity(metrics: AggregatedMetrics): ChannelActivityData {
    return {
      totalChannels: metrics.channelMetrics.totalChannels,
      topChannels: metrics.channelMetrics.topChannels,
    };
  }
}
```

### Event Storage

```typescript
class EventStorage {
  private backend: StorageBackend;
  
  constructor(config: AnalyticsConfig) {
    this.backend = this.createStorageBackend(config);
  }
  
  async storeCommands(events: CommandEvent[]): Promise<void> {
    await this.backend.store('commands', events);
  }
  
  async storeBackend(events: BackendEvent[]): Promise<void> {
    await this.backend.store('backend', events);
  }
  
  async storeCorrelations(events: CorrelationEvent[]): Promise<void> {
    await this.backend.store('correlations', events);
  }
  
  async getRecentCommands(timeWindowMs: number): Promise<CommandEvent[]> {
    return this.backend.query('commands', {
      timestamp: { $gte: Date.now() - timeWindowMs },
    });
  }
  
  async getRecentBackend(timeWindowMs: number): Promise<BackendEvent[]> {
    return this.backend.query('backend', {
      timestamp: { $gte: Date.now() - timeWindowMs },
    });
  }
  
  async getCommandsInRange(range: { start: number; end: number }): Promise<CommandEvent[]> {
    return this.backend.query('commands', {
      timestamp: { $gte: range.start, $lte: range.end },
    });
  }
  
  async getBackendInRange(range: { start: number; end: number }): Promise<BackendEvent[]> {
    return this.backend.query('backend', {
      timestamp: { $gte: range.start, $lte: range.end },
    });
  }
  
  async getCorrelationsInRange(range: { start: number; end: number }): Promise<CorrelationEvent[]> {
    return this.backend.query('correlations', {
      timestamp: { $gte: range.start, $lte: range.end },
    });
  }
  
  private createStorageBackend(config: AnalyticsConfig): StorageBackend {
    switch (config.storageBackend) {
      case 'memory':
        return new MemoryStorageBackend();
      case 'file':
        return new FileStorageBackend(config.storageConfig);
      case 'database':
        return new DatabaseStorageBackend(config.storageConfig);
      default:
        return new MemoryStorageBackend();
    }
  }
}
```

## Integration Strategy

### Phase 1: Instrumentation

Add analytics tracking to existing bot code:

```typescript
// In command handlers
const analytics = getAnalyticsPipeline();

try {
  const startTime = Date.now();
  
  // Execute command
  const result = await executeCommand(input);
  
  const executionTime = Date.now() - startTime;
  
  // Track command event
  await analytics.trackCommand({
    eventId: generateEventId(),
    timestamp: Date.now(),
    platform: 'telegram',
    command: 'swap',
    commandType: 'slash',
    userId: ctx.userId,
    channelId: ctx.chatId,
    executionTimeMs: executionTime,
    status: 'success',
    inputSize: JSON.stringify(input).length,
    metadata: {},
    tags: [],
  });
} catch (error) {
  await analytics.trackCommand({
    eventId: generateEventId(),
    timestamp: Date.now(),
    platform: 'telegram',
    command: 'swap',
    commandType: 'slash',
    userId: ctx.userId,
    channelId: ctx.chatId,
    executionTimeMs: Date.now() - startTime,
    status: 'error',
    errorMessage: error.message,
    inputSize: JSON.stringify(input).length,
    metadata: {},
    tags: [],
  });
}
```

### Phase 2: Backend Integration

Add correlation IDs to backend calls:

```typescript
// In backend client
const correlationId = generateCorrelationId();

const result = await backendClient.executeCommand(
  command,
  input,
  {
    correlationId,
    userId: context.userId,
  }
);

await analytics.trackBackend({
  eventId: generateEventId(),
  timestamp: Date.now(),
  operation: command,
  service: 'main',
  endpoint: `/commands/${command}`,
  executionTimeMs: executionTime,
  status: 'success',
  requestSize: JSON.stringify(input).length,
  responseSize: JSON.stringify(result).length,
  commandEventId: correlationId,
  userId: context.userId,
  metadata: {},
  tags: [],
});
```

### Phase 3: Dashboard Setup

Create analytics dashboard:

```typescript
// Dashboard endpoint
app.get('/analytics/dashboard', async (req, res) => {
  const timeRange = req.query.range || '24h';
  const dashboard = await analytics.generateDashboard(timeRange);
  res.json(dashboard);
});

// Metrics endpoint
app.get('/analytics/metrics', async (req, res) => {
  const interval = req.query.interval || '1h';
  const metrics = await analytics.aggregateMetrics(interval);
  res.json(metrics);
});

// Alerts endpoint
app.get('/analytics/alerts', async (req, res) => {
  const alerts = await analytics.checkAlerts();
  res.json(alerts);
});
```

## Benefits

1. **Visibility**: Clear view of command-to-backend execution flow
2. **Performance**: Identify bottlenecks and optimization opportunities
3. **Reliability**: Detect and alert on failures and anomalies
4. **Insights**: Understand user behavior and patterns
5. **Debugging**: Correlate issues across the stack
6. **Optimization**: Data-driven performance improvements
7. **Alerting**: Proactive issue detection
8. **Reporting**: Comprehensive analytics and reporting

## Next Steps

1. Implement event collector
2. Implement event correlator
3. Implement event aggregator
4. Implement event storage
5. Implement alert manager
6. Implement dashboard generator
7. Add instrumentation to bot
8. Add instrumentation to backend
9. Set up dashboard
10. Monitor and iterate
