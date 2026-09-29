/**
 * Transaction notification data for bot alerts
 */
export interface TransactionNotificationData {
  /**
   * Transaction hash
   */
  hash: string;

  /**
   * Whether the transaction was successful
   */
  successful: boolean;

  /**
   * Amount transferred
   */
  amount: string;

  /**
   * Asset code (e.g., "USDC", "XLM")
   */
  asset: string;

  /**
   * Source account address
   */
  from: string;

  /**
   * Destination account address
   */
  to: string;

  /**
   * Transaction timestamp (ISO string or Unix timestamp)
   */
  timestamp: string | number;

  /**
   * Transaction fee in XLM
   */
  fee?: string;

  /**
   * Transaction memo
   */
  memo?: string;

  /**
   * User ID for the notification
   */
  userId?: string;

  /**
   * Ledger number when transaction was confirmed
   */
  ledger?: number;
}

/**
 * Quest notification data for community quest/challenge alerts
 */
export interface QuestNotificationData {
  /**
   * Unique quest identifier
   */
  questId: string;

  /**
   * Quest title
   */
  title: string;

  /**
   * Short description of the quest
   */
  description: string;

  /**
   * Reward for completing the quest (e.g., "50 XLM")
   */
  reward: string;

  /**
   * Quest expiry timestamp (ISO string or Unix timestamp)
   */
  expiresAt: string | number;

  /**
   * URL to view quest details
   */
  url?: string;
}

/**
 * Bot notification service configuration
 */
export interface BotNotificationConfig {
  /**
   * Enable Telegram notifications
   */
  telegramEnabled: boolean;

  /**
   * Enable Discord notifications
   */
  discordEnabled: boolean;

  /**
   * Minimum confirmations before sending notification
   */
  minConfirmations: number;

  /**
   * Notification template
   */
  template?: "minimal" | "standard" | "detailed";
}

/**
 * User notification preferences
 */
export interface UserNotificationPreferences {
  userId: string;

  /**
   * User's Telegram chat ID
   */
  telegramChatId?: string;

  /**
   * User's Discord user ID
   */
  discordUserId?: string;

  /**
   * Enable transaction notifications
   */
  transactionNotifications: boolean;

  /**
   * Enable price alerts
   */
  priceAlerts: boolean;

  /**
   * Enable general announcements
   */
  announcements: boolean;

  /**
   * Minimum transaction value to notify (in USD)
   */
  minTransactionValue?: number;

  /**
   * Preferred currency for reports (USD, XLM, BTC)
   */
  preferredCurrency?: "USD" | "XLM" | "BTC";
}

/**
 * Price alert configuration
 */
export interface PriceAlert {
  id: string;
  userId: string;
  assetCode: string;
  targetPrice: number;
  currency: "USD" | "XLM" | "BTC";
  condition: "above" | "below";
  createdAt: string;
  triggered: boolean;
}

/**
 * Currency conversion rates
 */
export interface CurrencyRates {
  USD: number;
  XLM: number;
  BTC: number;
}

/**
 * Trending asset data
 */
export interface TrendingAsset {
  assetCode: string;
  issuer: string;
  domain?: string;
  volume24h: number;
  priceChange24h: number;
  holders: number;
  trustlines: number;
}

/**
 * Generic button definition that works for both Telegram and Discord
 */
export interface Button {
  /**
   * Button text label
   */
  label: string;
  /**
   * Unique action ID used to identify the button when pressed
   */
  id: string;
  /**
   * Button style (used by Discord, ignored by Telegram)
   */
  style?: 'primary' | 'secondary' | 'success' | 'danger' | 'link';
  /**
   * URL for link buttons
   */
  url?: string;
}

/**
 * Generic button interaction context
 */
export interface ButtonInteraction {
  /**
   * The platform ('discord' or 'telegram')
   */
  platform: 'discord' | 'telegram';
  /**
   * User ID of the person who pressed the button
   */
  userId: string;
  /**
   * The ID of the pressed button
   */
  buttonId: string;
  /**
   * The chat/channel ID where the button was pressed
   */
  chatId: string;
  /**
   * Platform-specific interaction object
   */
  raw: any;
  /**
   * Reply to the button interaction
   */
  reply: (message: string) => Promise<void>;
}

/**
 * Handler function type for button interactions
 */
export type ButtonHandler = (interaction: ButtonInteraction) => Promise<void>;