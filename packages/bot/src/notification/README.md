# Bot Notification Delivery Service

Resilient notification delivery service with retries, backpressure, dead-letter handling, and per-platform delivery metrics.

## Overview

The Notification Delivery Service provides a robust, production-ready system for delivering bot notifications across multiple platforms (Telegram, Discord) with built-in resilience features:

- **Retry Logic**: Exponential backoff with jitter for failed deliveries
- **Backpressure Handling**: Configurable queue limits and concurrency control
- **Dead-Letter Queue**: Automatic handling of permanently failed notifications
- **Per-Platform Metrics**: Detailed delivery metrics for each platform
- **Monitoring & Observability**: Event logging, health checks, and alerting
- **Platform Handlers**: Extensible handler system for different platforms

## Architecture

### Core Components

1. **Core Types** (`core.ts`)
   - Notification message types and priorities
   - Delivery status and result types
   - Retry, backpressure, and dead-letter configurations
   - Platform metrics definitions

2. **Delivery Service** (`deliveryService.ts`)
   - Queue management with concurrency control
   - Retry logic with exponential backoff
   - Backpressure handling
   - Dead-letter queue management
   - Metrics collection and reporting

3. **Platform Handlers** (`handlers/`)
   - Telegram notification handler
   - Discord notification handler
   - Extensible handler interface

4. **Notification Factory** (`factory.ts`)
   - Helper functions for creating notifications
   - Pre-built notification types (transaction, price alert, etc.)

5. **Monitoring Service** (`monitoring.ts`)
   - Event logging and history
   - Alert thresholds and monitoring
   - Health reporting
   - Metrics export

## Quick Start

### Basic Setup

```typescript
import { NotificationDeliveryService } from './notification/deliveryService.js';
import { TelegramNotificationHandler } from './notification/handlers/telegramHandler.js';
import { DiscordNotificationHandler } from './notification/handlers/discordHandler.js';
import { createTransactionNotification } from './notification/factory.js';

// Create delivery service
const deliveryService = new NotificationDeliveryService({
  retry: {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    useJitter: true,
  },
  backpressure: {
    maxQueueSize: 1000,
    threshold: 0.8,
    maxConcurrency: 10,
  },
  deadLetter: {
    maxSize: 100,
    ttl: 86400000, // 24 hours
  },
});

// Register platform handlers
deliveryService.registerPlatformHandler(
  new TelegramNotificationHandler(telegramAdapter)
);
deliveryService.registerPlatformHandler(
  new DiscordNotificationHandler(discordAdapter)
);
```

### Sending Notifications

```typescript
// Create a transaction notification
const notification = createTransactionNotification({
  userId: 'user123',
  hash: 'abc123...',
  successful: true,
  amount: '100',
  asset: 'XLM',
  from: 'GABC...',
  to: 'GDEF...',
  platforms: ['both'],
});

// Enqueue for delivery
const result = await deliveryService.enqueue(notification);

if (result.accepted) {
  console.log('Notification queued for delivery');
} else {
  console.log('Notification rejected:', result.reason);
}
```

## Notification Types

### Priority Levels

```typescript
enum NotificationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}
```

### Notification Types

```typescript
enum NotificationType {
  TRANSACTION = 'transaction',
  PRICE_ALERT = 'price_alert',
  SYSTEM = 'system',
  ANNOUNCEMENT = 'announcement',
  WARNING = 'warning',
  ERROR = 'error',
  CUSTOM = 'custom',
}
```

### Delivery Platforms

```typescript
enum DeliveryPlatform {
  TELEGRAM = 'telegram',
  DISCORD = 'discord',
  BOTH = 'both',
}
```

## Factory Functions

### Transaction Notification

```typescript
const notification = createTransactionNotification({
  userId: 'user123',
  hash: 'abc123',
  successful: true,
  amount: '100',
  asset: 'XLM',
  from: 'GABC...',
  to: 'GDEF...',
  fee: '0.01',
  memo: 'Payment',
  platforms: ['both'],
});
```

### Price Alert Notification

```typescript
const notification = createPriceAlertNotification({
  userId: 'user123',
  assetCode: 'XLM',
  condition: 'above',
  targetPrice: 0.15,
  currentPrice: 0.16,
  currency: 'USD',
  platforms: ['both'],
});
```

### System Notification

```typescript
const notification = createSystemNotification({
  userId: 'user123',
  message: 'Your account has been verified',
  priority: 'normal',
  platforms: ['both'],
});
```

### Announcement Notification

```typescript
const notification = createAnnouncementNotification({
  userId: 'user123',
  title: 'New Feature',
  message: 'We have added a new feature...',
  priority: 'high',
  platforms: ['both'],
});
```

### Warning Notification

```typescript
const notification = createWarningNotification({
  userId: 'user123',
  message: 'Your subscription is expiring soon',
  platforms: ['both'],
});
```

### Error Notification

```typescript
const notification = createErrorNotification({
  userId: 'user123',
  error: 'Transaction failed',
  context: { txHash: 'abc123' },
  platforms: ['both'],
});
```

### Custom Notification

```typescript
const notification = createCustomNotification({
  userId: 'user123',
  content: 'Custom message',
  priority: 'normal',
  platforms: ['telegram'],
  embed: {
    title: 'Custom Title',
    description: 'Custom description',
    color: 0x00ff00,
  },
  metadata: { customField: 'value' },
});
```

## Configuration

### Retry Configuration

```typescript
const retryConfig = {
  maxAttempts: 3,              // Maximum retry attempts
  initialDelayMs: 1000,        // Initial delay (1 second)
  maxDelayMs: 60000,           // Maximum delay (60 seconds)
  backoffMultiplier: 2,        // Exponential backoff multiplier
  useJitter: true,             // Add random jitter to delays
  jitterPercentage: 0.2,       // 20% jitter
};
```

### Backpressure Configuration

```typescript
const backpressureConfig = {
  maxQueueSize: 1000,          // Maximum queue size
  threshold: 0.8,              // 80% threshold for backpressure
  maxConcurrency: 10,          // Maximum concurrent deliveries
  rejectWhenUnderPressure: false, // Don't reject, just delay
  backpressureDelayMs: 100,    // Delay when under backpressure
};
```

### Dead-Letter Configuration

```typescript
const deadLetterConfig = {
  maxSize: 100,                // Maximum dead letter queue size
  ttl: 86400000,               // 24 hour TTL
  persist: false,               // Don't persist to disk
  onDeadLetter: (notification, state) => {
    console.log('Notification moved to dead letter:', notification.id);
  },
};
```

## Metrics

### Getting Overall Metrics

```typescript
const metrics = deliveryService.getMetrics();
console.log('Total sent:', metrics.totalSent);
console.log('Total delivered:', metrics.totalDelivered);
console.log('Success rate:', metrics.successRate);
console.log('Average delivery time:', metrics.avgDeliveryTime);
console.log('Queue size:', metrics.queueSize);
```

### Getting Platform-Specific Metrics

```typescript
const telegramMetrics = deliveryService.getPlatformMetrics('telegram');
console.log('Telegram delivered:', telegramMetrics?.delivered);
console.log('Telegram failed:', telegramMetrics?.failed);
console.log('Telegram avg delivery time:', telegramMetrics?.avgDeliveryTime);
```

### Health Check

```typescript
const health = deliveryService.getHealth();
console.log('Healthy:', health.healthy);
console.log('Queue size:', health.queueSize);
console.log('Dead letter size:', health.deadLetterSize);
console.log('Processing count:', health.processingCount);
console.log('Platform health:', health.platformHealth);
```

## Dead-Letter Queue

### Retrying Dead-Letter Notifications

```typescript
const result = await deliveryService.retryDeadLetter('notification-id');
if (result.success) {
  console.log('Notification re-queued for delivery');
} else {
  console.log('Retry failed:', result.reason);
}
```

### Managing Dead-Letter Queue

```typescript
// Get dead letter queue size
const size = deliveryService.getDeadLetterQueueSize();

// Clear dead letter queue
deliveryService.clearDeadLetterQueue();

// Clean up expired entries
const removed = deliveryService.cleanupExpiredDeadLetters();
console.log('Removed expired entries:', removed);
```

## Monitoring

### Setting Up Monitoring

```typescript
import { NotificationMonitoringService, DefaultAlertThresholds } from './notification/monitoring.js';

const monitoring = new NotificationMonitoringService({
  enableEventLogging: true,
  maxEventHistory: 1000,
  alertThresholds: DefaultAlertThresholds,
});

// Add custom alert threshold
monitoring.addAlertThreshold({
  metric: 'queueSize',
  threshold: 500,
  operator: 'gt',
  onAlert: (current, threshold) => {
    console.warn(`Queue size alert: ${current} > ${threshold}`);
  },
});
```

### Event History

```typescript
// Get all events
const events = monitoring.getEventHistory();

// Filter by type
const failedEvents = monitoring.getEventHistory({ type: 'notification_failed' });

// Filter by time range
const recentEvents = monitoring.getEventHistory({
  since: Date.now() - 3600000, // Last hour
});

// Get event statistics
const stats = monitoring.getEventStats();
console.log('Event statistics:', stats);
```

### Health Report

```typescript
const report = monitoring.generateHealthReport();
console.log('Healthy:', report.healthy);
console.log('Issues:', report.issues);
console.log('Warnings:', report.warnings);
```

### Export Metrics

```typescript
const exportData = monitoring.exportMetrics();
console.log('Exported data:', exportData);
```

## Platform Handlers

### Creating Custom Platform Handler

```typescript
import { PlatformDeliveryHandler } from './notification/core.js';

class CustomPlatformHandler implements PlatformDeliveryHandler {
  platform = DeliveryPlatform.TELEGRAM;
  private adapter: any;

  constructor(adapter: any) {
    this.adapter = adapter;
  }

  async deliver(message: NotificationMessage): Promise<DeliveryResult> {
    const startTime = Date.now();
    try {
      // Custom delivery logic
      await this.adapter.send(message.userId, message.content);
      
      return {
        success: true,
        platform: this.platform,
        attempt: 1,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        success: false,
        platform: this.platform,
        error: error instanceof Error ? error.message : String(error),
        attempt: 1,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    }
  }

  isAvailable(): boolean {
    return !!this.adapter;
  }

  getHealth() {
    return {
      available: this.isAvailable(),
    };
  }
}
```

### Registering Handler

```typescript
deliveryService.registerPlatformHandler(new CustomPlatformHandler(adapter));
```

## Advanced Usage

### Custom Retry Policy

```typescript
const notification = createCustomNotification({
  userId: 'user123',
  content: 'Important message',
  maxRetries: 5, // Override default retry count
  timeout: 60000, // 60 second timeout
  platforms: ['both'],
});
```

### Expiring Notifications

```typescript
const notification = createCustomNotification({
  userId: 'user123',
  content: 'Time-sensitive message',
  expiresAt: Date.now() + 300000, // Expire in 5 minutes
  platforms: ['both'],
});
```

### Priority-Based Delivery

```typescript
const urgentNotification = createCustomNotification({
  userId: 'user123',
  content: 'Urgent message',
  priority: 'urgent',
  platforms: ['both'],
});
```

### Canceling Notifications

```typescript
const cancelled = deliveryService.cancelNotification('notification-id');
if (cancelled) {
  console.log('Notification cancelled');
}
```

### Getting Delivery State

```typescript
const state = deliveryService.getDeliveryState('notification-id');
if (state) {
  console.log('Status:', state.status);
  console.log('Attempts:', state.attempts);
  console.log('Current attempt:', state.currentAttempt);
}
```

## Integration with Existing Services

### Transaction Notification Service

```typescript
import { transactionNotificationService } from '../../src/services/transactionNotification.service.js';
import { NotificationDeliveryService } from './notification/deliveryService.js';

// Replace direct adapter calls with delivery service
const deliveryService = new NotificationDeliveryService();

// In transaction notification service
private async sendTransactionNotification(
  pending: PendingTransaction,
  successful: boolean
): Promise<void> {
  const notification = createTransactionNotification({
    userId: pending.userId,
    hash: pending.hash,
    successful,
    amount: pending.amount,
    asset: pending.asset,
    from: pending.from,
    to: pending.to,
    fee: pending.fee,
    memo: pending.memo,
  });

  await deliveryService.enqueue(notification);
}
```

### Price Spike Alert Service

```typescript
import { priceSpikeAlertService } from '../../src/services/priceSpikeAlert.service.js';
import { NotificationDeliveryService } from './notification/deliveryService.js';

// In price spike alert service
const notification = createCustomNotification({
  userId: 'broadcast',
  content: message,
  type: 'price_alert',
  priority: 'high',
  platforms: ['both'],
});

await deliveryService.enqueue(notification);
```

## Best Practices

1. **Use Appropriate Priority**: Set priority based on notification urgency
2. **Configure Timeouts**: Set appropriate timeouts for different notification types
3. **Monitor Dead-Letter Queue**: Regularly check and retry dead-letter notifications
4. **Set Reasonable Limits**: Configure queue sizes based on expected load
5. **Enable Monitoring**: Always enable metrics and monitoring in production
6. **Handle Errors Gracefully**: Use error notifications for critical failures
7. **Use Platform-Specific Features**: Leverage embeds for Discord, formatting for Telegram
8. **Clean Up Resources**: Call shutdown() when stopping the service

## Troubleshooting

### Notifications Not Delivering

1. Check platform handler availability
2. Verify queue size and backpressure status
3. Check dead-letter queue for failed notifications
4. Review metrics for error rates
5. Check platform API rate limits

### High Failure Rate

1. Check platform handler health
2. Review error messages in delivery attempts
3. Verify platform API credentials
4. Check network connectivity
5. Review retry configuration

### Queue Backing Up

1. Increase concurrency limit
2. Check platform handler performance
3. Review notification priority
4. Consider scaling platform handlers
5. Check for rate limiting

### Dead-Letter Queue Growing

1. Review dead-letter reasons
2. Check platform handler availability
3. Verify notification content validity
4. Review retry configuration
5. Consider increasing max retry attempts

## Performance Considerations

- **Concurrency**: Adjust maxConcurrency based on platform API limits
- **Queue Size**: Monitor queue size to prevent memory issues
- **Metrics Overhead**: Disable metrics if not needed for performance
- **Backpressure**: Use backpressure to prevent overload
- **Retry Delays**: Configure appropriate retry delays for your use case

## Security Considerations

1. **User Privacy**: Ensure notification content doesn't expose sensitive data
2. **Rate Limiting**: Respect platform API rate limits
3. **Input Validation**: Validate notification content before delivery
4. **Error Messages**: Don't expose internal errors in notifications
5. **Access Control**: Ensure only authorized users can send notifications

## Migration Guide

### From Direct Adapter Calls

**Before:**
```typescript
await telegramAdapter.sendNotification(userId, message);
await discordAdapter.sendNotification(userId, message);
```

**After:**
```typescript
const notification = createCustomNotification({
  userId,
  content: message,
  platforms: ['both'],
});
await deliveryService.enqueue(notification);
```

### From In-Process Maps

**Before:**
```typescript
const notifications = new Map<string, Notification>();
notifications.set(id, notification);
// Manual delivery logic
```

**After:**
```typescript
const notification = createCustomNotification({...});
await deliveryService.enqueue(notification);
// Automatic delivery with retries
```

## Testing

### Unit Test Delivery Service

```typescript
describe('NotificationDeliveryService', () => {
  it('should enqueue and deliver notification', async () => {
    const service = new NotificationDeliveryService();
    const mockHandler = {
      platform: 'telegram',
      deliver: async () => ({ success: true, platform: 'telegram', attempt: 1, duration: 100, timestamp: Date.now() }),
      isAvailable: () => true,
      getHealth: () => ({ available: true }),
    };

    service.registerPlatformHandler(mockHandler);

    const notification = createCustomNotification({
      userId: 'user1',
      content: 'Test',
      platforms: ['telegram'],
    });

    const result = await service.enqueue(notification);
    expect(result.accepted).toBe(true);
  });
});
```

### Integration Test with Monitoring

```typescript
describe('Notification Monitoring', () => {
  it('should log events and trigger alerts', async () => {
    const monitoring = new NotificationMonitoringService();
    monitoring.logEvent('notification_queued', { userId: 'user1' });

    const events = monitoring.getEventHistory();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('notification_queued');
  });
});
```

## Future Enhancements

- [ ] Persistent queue storage (Redis, database)
- [ ] Distributed delivery across multiple instances
- [ ] Webhook delivery support
- [ ] Notification templates
- [ ] User preference management
- [ ] Scheduled notifications
- [ ] Notification aggregation
- [ ] Advanced routing rules
- [ ] Real-time metrics dashboard
- [ ] Integration with external monitoring systems
