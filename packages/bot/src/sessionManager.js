"use strict";
/**
 * Bot Session Manager
 *
 * Manages bot session persistence by communicating with the backend API.
 * This allows interactive bot sessions (wizards, multi-step flows) to survive bot restarts.
 */
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
class SessionManager {
  constructor(backendUrl) {
    this.backendUrl =
      backendUrl || process.env.BACKEND_URL || "http://localhost:3000";
  }
  /**
   * Create or update a bot session
   */
  saveSession(data) {
    return __awaiter(this, void 0, void 0, function* () {
      try {
        const response = yield fetch(`${this.backendUrl}/api/bot/session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        });
        const result = yield response.json();
        return result;
      } catch (error) {
        console.error("Error saving bot session:", error);
        return {
          success: false,
          message: "Failed to save session",
        };
      }
    });
  }
  /**
   * Get active session for a user
   */
  getSession(userId, platform, sessionType) {
    return __awaiter(this, void 0, void 0, function* () {
      try {
        const params = new URLSearchParams({
          userId,
          platform,
          sessionType,
        });
        const response = yield fetch(
          `${this.backendUrl}/api/bot/session?${params}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
        const result = yield response.json();
        return result;
      } catch (error) {
        console.error("Error getting bot session:", error);
        return {
          success: false,
          message: "Failed to get session",
        };
      }
    });
  }
  /**
   * Update an existing session
   */
  updateSession(sessionId, updates) {
    return __awaiter(this, void 0, void 0, function* () {
      try {
        const response = yield fetch(
          `${this.backendUrl}/api/bot/session/${sessionId}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(updates),
          }
        );
        const result = yield response.json();
        return result;
      } catch (error) {
        console.error("Error updating bot session:", error);
        return {
          success: false,
          message: "Failed to update session",
        };
      }
    });
  }
  /**
   * Deactivate a session
   */
  deactivateSession(sessionId) {
    return __awaiter(this, void 0, void 0, function* () {
      try {
        const response = yield fetch(
          `${this.backendUrl}/api/bot/session/${sessionId}`,
          {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
        const result = yield response.json();
        return result;
      } catch (error) {
        console.error("Error deactivating bot session:", error);
        return {
          success: false,
          message: "Failed to deactivate session",
        };
      }
    });
  }
  /**
   * Deactivate all sessions for a user
   */
  deactivateUserSessions(userId, platform) {
    return __awaiter(this, void 0, void 0, function* () {
      try {
        const url = platform
          ? `${this.backendUrl}/api/bot/sessions/user/${userId}?platform=${platform}`
          : `${this.backendUrl}/api/bot/sessions/user/${userId}`;
        const response = yield fetch(url, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
        });
        const result = yield response.json();
        return result;
      } catch (error) {
        console.error("Error deactivating user sessions:", error);
        return {
          success: false,
          message: "Failed to deactivate sessions",
        };
      }
    });
  }
}
exports.SessionManager = SessionManager;
