/**
 * Notification Factory
 * Helper functions for creating notification messages
 */

import {
  NotificationMessage,
  NotificationType,
  NotificationPriority,
  DeliveryPlatform,
} from './core.js';

/**
 * Create a notification message
 */
export function createNotificationMessage(config: {
  userId: string;
  type: NotificationType;
  priority?: NotificationPriority;
  platforms?: DeliveryPlatform[];
  content: string;
  embed?: {
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  };
  metadata?: Record<string, unknown>;
  expiresAt?: number;
  maxRetries?: number;
  timeout?: number;
}): NotificationMessage {
  const id = generateNotificationId(config.userId, config.type);

  return {
    id,
    userId: config.userId,
    type: config.type,
    priority: config.priority || NotificationPriority.NORMAL,
    platforms: config.platforms || [DeliveryPlatform.BOTH],
    content: config.content,
    embed: config.embed,
    metadata: config.metadata,
    createdAt: Date.now(),
    expiresAt: config.expiresAt,
    maxRetries: config.maxRetries,
    timeout: config.timeout,
  };
}

/**
 * Create a transaction notification
 */
export function createTransactionNotification(config: {
  userId: string;
  hash: string;
  successful: boolean;
  amount: string;
  asset: string;
  from: string;
  to: string;
  fee?: string;
  memo?: string;
  platforms?: DeliveryPlatform[];
}): NotificationMessage {
  const status = config.successful ? '✅ Transaction Successful' : '❌ Transaction Failed';
  let content = `${status}\n\n` +
    `Hash: \`${config.hash}\`\n` +
    `Amount: ${config.amount} ${config.asset}\n` +
    `From: ${config.from}\n` +
    `To: ${config.to}`;

  if (config.fee) {
    content += `\nFee: ${config.fee}`;
  }

  if (config.memo) {
    content += `\nMemo: ${config.memo}`;
  }

  return createNotificationMessage({
    userId: config.userId,
    type: NotificationType.TRANSACTION,
    priority: config.successful ? NotificationPriority.NORMAL : NotificationPriority.HIGH,
    platforms: config.platforms,
    content,
    embed: {
      title: status,
      description: `Transaction ${config.hash}`,
      color: config.successful ? 0x00ff00 : 0xff0000,
      fields: [
        { name: 'Amount', value: `${config.amount} ${config.asset}`, inline: true },
        { name: 'From', value: config.from, inline: true },
        { name: 'To', value: config.to, inline: true },
      ],
    },
    metadata: {
      hash: config.hash,
      successful: config.successful,
      amount: config.amount,
      asset: config.asset,
    },
  });
}

/**
 * Create a price alert notification
 */
export function createPriceAlertNotification(config: {
  userId: string;
  assetCode: string;
  condition: 'above' | 'below';
  targetPrice: number;
  currentPrice: number;
  currency: string;
  platforms?: DeliveryPlatform[];
}): NotificationMessage {
  const direction = config.condition === 'above' ? '📈' : '📉';
  const content = `${direction} Price Alert: ${config.assetCode}\n\n` +
    `Target: ${config.condition} ${config.targetPrice} ${config.currency}\n` +
    `Current: ${config.currentPrice} ${config.currency}`;

  return createNotificationMessage({
    userId: config.userId,
    type: NotificationType.PRICE_ALERT,
    priority: NotificationPriority.NORMAL,
    platforms: config.platforms,
    content,
    embed: {
      title: `${direction} ${config.assetCode} Price Alert`,
      description: `Price ${config.condition} target`,
      color: config.condition === 'above' ? 0x00ff00 : 0xff0000,
      fields: [
        { name: 'Target', value: `${config.targetPrice} ${config.currency}`, inline: true },
        { name: 'Current', value: `${config.currentPrice} ${config.currency}`, inline: true },
      ],
    },
    metadata: {
      assetCode: config.assetCode,
      condition: config.condition,
      targetPrice: config.targetPrice,
      currentPrice: config.currentPrice,
    },
  });
}

/**
 * Create a system notification
 */
export function createSystemNotification(config: {
  userId: string;
  message: string;
  priority?: NotificationPriority;
  platforms?: DeliveryPlatform[];
}): NotificationMessage {
  return createNotificationMessage({
    userId: config.userId,
    type: NotificationType.SYSTEM,
    priority: config.priority || NotificationPriority.NORMAL,
    platforms: config.platforms,
    content: `🔔 ${config.message}`,
    metadata: {
      systemMessage: true,
    },
  });
}

/**
 * Create an announcement notification
 */
export function createAnnouncementNotification(config: {
  userId: string;
  title: string;
  message: string;
  priority?: NotificationPriority;
  platforms?: DeliveryPlatform[];
}): NotificationMessage {
  return createNotificationMessage({
    userId: config.userId,
    type: NotificationType.ANNOUNCEMENT,
    priority: config.priority || NotificationPriority.NORMAL,
    platforms: config.platforms,
    content: `📢 ${config.title}\n\n${config.message}`,
    embed: {
      title: `📢 ${config.title}`,
      description: config.message,
      color: 0x00bfff,
    },
    metadata: {
      announcement: true,
    },
  });
}

/**
 * Create a warning notification
 */
export function createWarningNotification(config: {
  userId: string;
  message: string;
  platforms?: DeliveryPlatform[];
}): NotificationMessage {
  return createNotificationMessage({
    userId: config.userId,
    type: NotificationType.WARNING,
    priority: NotificationPriority.HIGH,
    platforms: config.platforms,
    content: `⚠️ ${config.message}`,
    embed: {
      title: '⚠️ Warning',
      description: config.message,
      color: 0xffaa00,
    },
    metadata: {
      warning: true,
    },
  });
}

/**
 * Create an error notification
 */
export function createErrorNotification(config: {
  userId: string;
  error: string;
  context?: Record<string, unknown>;
  platforms?: DeliveryPlatform[];
}): NotificationMessage {
  return createNotificationMessage({
    userId: config.userId,
    type: NotificationType.ERROR,
    priority: NotificationPriority.URGENT,
    platforms: config.platforms,
    content: `❌ Error: ${config.error}`,
    embed: {
      title: '❌ Error',
      description: config.error,
      color: 0xff0000,
    },
    metadata: {
      error: config.error,
      context: config.context,
    },
  });
}

/**
 * Create a custom notification
 */
export function createCustomNotification(config: {
  userId: string;
  content: string;
  priority?: NotificationPriority;
  platforms?: DeliveryPlatform[];
  embed?: {
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  };
  metadata?: Record<string, unknown>;
}): NotificationMessage {
  return createNotificationMessage({
    userId: config.userId,
    type: NotificationType.CUSTOM,
    priority: config.priority || NotificationPriority.NORMAL,
    platforms: config.platforms,
    content: config.content,
    embed: config.embed,
    metadata: config.metadata,
  });
}

/**
 * Generate a unique notification ID
 */
function generateNotificationId(userId: string, type: NotificationType): string {
  return `${type}:${userId}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
}
