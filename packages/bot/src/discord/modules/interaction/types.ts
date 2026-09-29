/**
 * Discord Interaction Types
 * Type definitions for Discord interaction handling
 */

export type InteractionType = 'command' | 'button' | 'modal' | 'select';

export interface DiscordInteraction {
  type: InteractionType;
  id: string;
  userId: string;
  guildId?: string;
  channelId: string;
  data: any;
  metadata: {
    timestamp: number;
    threadId?: string;
    parentChannelId?: string;
  };
}

export interface InteractionHandler<TInput, TOutput> {
  type: string;
  handler: (interaction: DiscordInteraction, input: TInput) => Promise<InteractionResult<TOutput>>;
  permissions?: Permission[];
  rateLimit?: RateLimitConfig;
  scamCheck?: boolean;
}

export interface InteractionResult<TOutput> {
  success: boolean;
  data?: TOutput;
  error?: InteractionError;
  response?: DiscordResponse;
}

export interface InteractionError {
  code: InteractionErrorCode;
  message: string;
  recoverable: boolean;
  userMessage?: string;
}

export type InteractionErrorCode =
  | 'INVALID_INTERACTION'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'SCAM_DETECTED'
  | 'THREAD_SAFETY_VIOLATION'
  | 'CHANNEL_SAFETY_VIOLATION'
  | 'BACKEND_ERROR'
  | 'VALIDATION_ERROR';

export interface DiscordResponse {
  type: 'message' | 'edit' | 'defer' | 'followup';
  content?: string;
  embeds?: any[];
  components?: any[];
  ephemeral?: boolean;
}

export interface Permission {
  type: 'role' | 'user' | 'channel' | 'custom';
  value: string;
  description?: string;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  skipFailedRequests?: boolean;
}

export interface ScamCheckResult {
  isScam: boolean;
  confidence: number;
  matchedPatterns: string[];
  action: 'warn' | 'block' | 'delete' | 'report';
}
