/**
 * Bot Session Manager
 *
 * Manages bot session persistence by communicating with the backend API.
 * This allows interactive bot sessions (wizards, multi-step flows) to survive bot restarts.
 */

export interface BotSessionData {
  userId: string;
  platform: "discord" | "telegram";
  sessionType: "multisig_wizard" | "swap_wizard" | "custom_flow";
  step: number;
  sessionData: Record<string, unknown>;
  expiresAt?: string;
}

export interface BotSessionResponse {
  success: boolean;
  session?: {
    id: string;
    userId: string;
    platform: string;
    sessionType: string;
    step: number;
    sessionData: Record<string, unknown>;
    expiresAt?: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
  message?: string;
}

export class SessionManager {
  private backendUrl: string;

  constructor(backendUrl?: string) {
    this.backendUrl =
      backendUrl || process.env.BACKEND_URL || "http://localhost:3000";
  }

  /**
   * Create or update a bot session
   */
  async saveSession(data: BotSessionData): Promise<BotSessionResponse> {
    try {
      const response = await fetch(`${this.backendUrl}/api/bot/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const result = (await response.json()) as BotSessionResponse;
      return result;
    } catch (error) {
      console.error("Error saving bot session:", error);
      return {
        success: false,
        message: "Failed to save session",
      };
    }
  }

  /**
   * Get active session for a user
   */
  async getSession(
    userId: string,
    platform: "discord" | "telegram",
    sessionType: "multisig_wizard" | "swap_wizard" | "custom_flow"
  ): Promise<BotSessionResponse> {
    try {
      const params = new URLSearchParams({
        userId,
        platform,
        sessionType,
      });

      const response = await fetch(
        `${this.backendUrl}/api/bot/session?${params}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const result = (await response.json()) as BotSessionResponse;
      return result;
    } catch (error) {
      console.error("Error getting bot session:", error);
      return {
        success: false,
        message: "Failed to get session",
      };
    }
  }

  /**
   * Update an existing session
   */
  async updateSession(
    sessionId: string,
    updates: Partial<{
      step: number;
      sessionData: Record<string, unknown>;
      expiresAt: string;
      isActive: boolean;
    }>
  ): Promise<BotSessionResponse> {
    try {
      const response = await fetch(
        `${this.backendUrl}/api/bot/session/${sessionId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updates),
        }
      );

      const result = (await response.json()) as BotSessionResponse;
      return result;
    } catch (error) {
      console.error("Error updating bot session:", error);
      return {
        success: false,
        message: "Failed to update session",
      };
    }
  }

  /**
   * Deactivate a session
   */
  async deactivateSession(sessionId: string): Promise<BotSessionResponse> {
    try {
      const response = await fetch(
        `${this.backendUrl}/api/bot/session/${sessionId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const result = (await response.json()) as BotSessionResponse;
      return result;
    } catch (error) {
      console.error("Error deactivating bot session:", error);
      return {
        success: false,
        message: "Failed to deactivate session",
      };
    }
  }

  /**
   * Deactivate all sessions for a user
   */
  async deactivateUserSessions(
    userId: string,
    platform?: "discord" | "telegram"
  ): Promise<BotSessionResponse> {
    try {
      const url = platform
        ? `${this.backendUrl}/api/bot/sessions/user/${userId}?platform=${platform}`
        : `${this.backendUrl}/api/bot/sessions/user/${userId}`;

      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const result = (await response.json()) as BotSessionResponse;
      return result;
    } catch (error) {
      console.error("Error deactivating user sessions:", error);
      return {
        success: false,
        message: "Failed to deactivate sessions",
      };
    }
  }
}
