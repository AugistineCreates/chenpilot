import { Request } from "express";
import crypto from "crypto";
import AppDataSource from "../config/Datasource";
import { User } from "../Auth/user.entity";

/**
 * Stellar Horizon Webhook Payload Types
 */
export interface StellarWebhookPayload {
  id: string;
  type: string;
  source: string;
  created_at: string;
  data: {
    id: string;
    account: string;
    funder: string;
    amount: string;
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    transaction_hash: string;
    operation_index: number;
    transaction_successful: boolean;
  };
}

/**
 * Webhook Processing Result
 */
export interface WebhookResult {
  success: boolean;
  message: string;
  userId?: string;
  deploymentTriggered?: boolean;
}

/**
 * Service for handling Stellar funding webhooks
 */
export class StellarWebhookService {
  private readonly WEBHOOK_SECRET: string;
  private readonly userRepository = AppDataSource.getRepository(User);
  private readonly processedWebhooks = new Map<string, number>();

  constructor() {
    this.WEBHOOK_SECRET = process.env.STELLAR_WEBHOOK_SECRET || "";
    if (!this.WEBHOOK_SECRET) {
      console.warn(
        "STELLAR_WEBHOOK_SECRET not set. Signature verification will be disabled."
      );
    }
  }

  /**
   * Verify webhook signature from Stellar Horizon
   * Uses HMAC-SHA256 for signature verification
   */
  private verifySignature(
    payload: string,
    signature: string,
    timestamp: string
  ): boolean {
    if (!this.WEBHOOK_SECRET) {
      // If no secret is configured, skip verification (not recommended for production)
      console.warn(
        "Signature verification skipped - no webhook secret configured"
      );
      return true;
    }

    try {
      // Create HMAC using the secret
      const hmac = crypto.createHmac("sha256", this.WEBHOOK_SECRET);
      const signedPayload = `${timestamp}.${payload}`;
      hmac.update(signedPayload);
      const expectedSignature = hmac.digest("hex");

      // Use constant-time comparison to prevent timing attacks
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      console.error("Signature verification error:", error);
      return false;
    }
  }

  /**
   * Validate the webhook payload structure
   */
  private validatePayload(payload: unknown): payload is StellarWebhookPayload {
    if (!payload || typeof payload !== "object") {
      return false;
    }

    // Type guard to ensure payload is a record
    const payloadRecord = payload as Record<string, unknown>;

    const { id, type, source, created_at, data } = payloadRecord;

    // Check required top-level fields
    if (
      typeof id !== "string" ||
      typeof type !== "string" ||
      typeof source !== "string" ||
      typeof created_at !== "string"
    ) {
      return false;
    }

    // Check required data fields
    if (!data || typeof data !== "object") {
      return false;
    }

    // Type guard to ensure data is a record
    const dataRecord = data as Record<string, unknown>;

    const {
      account,
      funder,
      amount,
      asset_type,
      transaction_hash,
      transaction_successful,
    } = dataRecord;

    if (
      typeof account !== "string" ||
      typeof funder !== "string" ||
      typeof amount !== "string" ||
      typeof asset_type !== "string" ||
      typeof transaction_hash !== "string" ||
      typeof transaction_successful !== "boolean"
    ) {
      return false;
    }

    // Validate Stellar address format (basic check)
    const stellarAddressRegex = /^G[A-Z0-9]{55}$/;
    if (
      !stellarAddressRegex.test(account) ||
      !stellarAddressRegex.test(funder)
    ) {
      return false;
    }

    // Ensure transaction was successful
    if (!transaction_successful) {
      return false;
    }

    return true;
  }

  /**
   * Check for idempotency - prevent duplicate webhook processing
   */
  private isDuplicateWebhook(webhookId: string): boolean {
    const now = Date.now();
    const lastProcessed = this.processedWebhooks.get(webhookId);

    // If already processed within the last 5 minutes, treat as duplicate
    if (lastProcessed && now - lastProcessed < 5 * 60 * 1000) {
      return true;
    }

    // Mark as processed
    this.processedWebhooks.set(webhookId, now);

    // Clean up old entries (older than 10 minutes)
    for (const [id, timestamp] of this.processedWebhooks.entries()) {
      if (now - timestamp > 10 * 60 * 1000) {
        this.processedWebhooks.delete(id);
      }
    }

    return false;
  }

  /**
   * Find user by Stellar address
   */
  private async findUserByAddress(address: string): Promise<User | null> {
    try {
      return await this.userRepository.findOne({
        where: { address },
      });
    } catch (error) {
      console.error("Error finding user by address:", error);
      return null;
    }
  }

  /**
   * Update user funding status
   */
  private async updateUserFundingStatus(
    user: User,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _amount: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _transactionHash: string
  ): Promise<User> {
    user.isFunded = true;
    user.updatedAt = new Date();
    return await this.userRepository.save(user);
  }

  /**
   * Trigger auto-deployment for a funded user
   * This is a placeholder - implement your actual deployment logic here
   */
  private async triggerAutoDeployment(user: User): Promise<boolean> {
    try {
      console.log(`Triggering auto-deployment for user: ${user.id}`);

      // TODO: Implement your actual deployment logic here
      // This could involve:
      // - Calling a deployment service
      // - Triggering a smart contract deployment
      // - Sending a notification to another service
      // - Queuing a deployment job

      // For now, we'll just mark the user as deployed
      user.isDeployed = true;
      await this.userRepository.save(user);

      console.log(`Auto-deployment completed for user: ${user.id}`);
      return true;
    } catch (error) {
      console.error("Error triggering auto-deployment:", error);
      return false;
    }
  }

  /**
   * Process the funding webhook
   */
  public async processFundingWebhook(req: Request): Promise<WebhookResult> {
    try {
      // Extract headers
      const signature = req.headers["x-stellar-signature"] as string;
      const timestamp = req.headers["x-stellar-timestamp"] as string;

      // Get raw body for signature verification
      const rawBody = req.body;

      // Verify signature if secret is configured
      if (this.WEBHOOK_SECRET && (!signature || !timestamp)) {
        return {
          success: false,
          message: "Missing signature headers",
        };
      }

      if (this.WEBHOOK_SECRET && signature && timestamp) {
        const isValid = this.verifySignature(
          JSON.stringify(rawBody),
          signature,
          timestamp
        );

        if (!isValid) {
          return {
            success: false,
            message: "Invalid signature",
          };
        }
      }

      // Validate payload structure
      if (!this.validatePayload(rawBody)) {
        return {
          success: false,
          message: "Invalid payload structure",
        };
      }

      const payload: StellarWebhookPayload = rawBody;

      // Check for idempotency
      if (this.isDuplicateWebhook(payload.id)) {
        return {
          success: true,
          message: "Webhook already processed (idempotent)",
        };
      }

      // Find user by Stellar address
      const user = await this.findUserByAddress(payload.data.account);

      if (!user) {
        return {
          success: false,
          message: "User not found for this address",
        };
      }

      // Check if user is already funded
      if (user.isFunded) {
        return {
          success: true,
          message: "User already funded",
          userId: user.id,
        };
      }

      // Update user funding status
      const updatedUser = await this.updateUserFundingStatus(
        user,
        payload.data.amount,
        payload.data.transaction_hash
      );

      // Trigger auto-deployment
      const deploymentTriggered = await this.triggerAutoDeployment(updatedUser);

      return {
        success: true,
        message: "Funding webhook processed successfully",
        userId: updatedUser.id,
        deploymentTriggered,
      };
    } catch (error) {
      console.error("Error processing funding webhook:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  }
}

// Export singleton instance
export const stellarWebhookService = new StellarWebhookService();
