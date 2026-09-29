/**
 * Account Linking Service
 * Handles secure identity linking between bot platforms (Telegram/Discord) and Chen Pilot user accounts
 */

import axios from 'axios';

const BACKEND_URL = process.env.BACKEND_URL || process.env.API_BASE_URL || 'http://localhost:2333';

export interface LinkTokenResponse {
  token: string;
  expiresAt: string;
}

export interface LinkIdentityResponse {
  success: boolean;
  message: string;
  identity?: {
    id: string;
    platform: string;
    platformUserId: string;
    platformUsername?: string;
    linkedAt: string;
  };
}

export class AccountLinkingService {
  private backendUrl: string;

  constructor(backendUrl?: string) {
    this.backendUrl = backendUrl || BACKEND_URL;
  }

  /**
   * Generate a link token for a user to link their bot identity
   */
  async generateLinkToken(userId: string, platform: 'telegram' | 'discord'): Promise<LinkTokenResponse> {
    try {
      const response = await axios.post(`${this.backendUrl}/api/bot-identity/link-token`, {
        userId,
        platform,
      });

      return response.data;
    } catch (error) {
      console.error('Failed to generate link token:', error);
      throw new Error('Failed to generate link token');
    }
  }

  /**
   * Verify a link token and complete the identity linking
   */
  async verifyLinkToken(
    token: string,
    platformUserId: string,
    platformUsername?: string
  ): Promise<LinkIdentityResponse> {
    try {
      const response = await axios.post(`${this.backendUrl}/api/bot-identity/verify-link`, {
        token,
        platformUserId,
        platformUsername,
      });

      return response.data;
    } catch (error) {
      console.error('Failed to verify link token:', error);
      throw new Error('Failed to verify link token');
    }
  }

  /**
   * Get user by bot identity (for authentication)
   */
  async getUserByBotIdentity(
    platform: 'telegram' | 'discord',
    platformUserId: string
  ): Promise<{ userId: string; exists: boolean } | null> {
    try {
      const response = await axios.get(
        `${this.backendUrl}/api/bot-identity/user-by-identity`,
        {
          params: { platform, platformUserId },
        }
      );

      return response.data;
    } catch (error) {
      console.error('Failed to get user by bot identity:', error);
      return null;
    }
  }

  /**
   * Get all linked identities for a user
   */
  async getUserIdentities(userId: string): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.backendUrl}/api/bot-identity/identities/${userId}`
      );

      return response.data;
    } catch (error) {
      console.error('Failed to get user identities:', error);
      return [];
    }
  }

  /**
   * Unlink a bot identity
   */
  async unlinkIdentity(userId: string, platform: 'telegram' | 'discord'): Promise<boolean> {
    try {
      const response = await axios.delete(
        `${this.backendUrl}/api/bot-identity/unlink`,
        {
          data: { userId, platform },
        }
      );

      return response.data.success;
    } catch (error) {
      console.error('Failed to unlink identity:', error);
      return false;
    }
  }
}

export const accountLinkingService = new AccountLinkingService();
