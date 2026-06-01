"use strict";
/**
 * Performance Profiler for Bot Commands
 *
 * This module provides utilities to measure and log the execution time
 * of bot command handlers to the backend for performance monitoring.
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
exports.withPerformanceProfiling = withPerformanceProfiling;
exports.extractCommandName = extractCommandName;
exports.isSlowExecution = isSlowExecution;
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";
/**
 * Log command execution metrics to the backend
 */
function logCommandMetrics(metrics) {
  return __awaiter(this, void 0, void 0, function* () {
    try {
      yield fetch(`${BACKEND_URL}/api/bot/metrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metrics),
      });
    } catch (error) {
      // Fail silently - don't interrupt bot operation if logging fails
      console.error("Failed to log command metrics:", error);
    }
  });
}
/**
 * Wrap a command handler with performance profiling
 *
 * @param command - The command name (e.g., '!help', '/start')
 * @param platform - The platform ('discord' or 'telegram')
 * @param userId - The user ID
 * @param handler - The command handler function to wrap
 * @returns A wrapped function that measures execution time
 */
function withPerformanceProfiling(command, platform, userId, handler) {
  return (...args) =>
    __awaiter(this, void 0, void 0, function* () {
      const startTime = Date.now();
      let success = true;
      let error;
      try {
        const result = yield handler(...args);
        return result;
      } catch (err) {
        success = false;
        error = err instanceof Error ? err.message : String(err);
        throw err; // Re-throw to maintain original error handling
      } finally {
        const executionTimeMs = Date.now() - startTime;
        // Log metrics asynchronously (don't await)
        logCommandMetrics({
          command,
          platform,
          userId,
          executionTimeMs,
          success,
          error,
          timestamp: new Date().toISOString(),
        }).catch(() => {
          // Fail silently
        });
        // Also log to console for immediate visibility
        console.log(
          `[Bot Performance] ${platform} ${command} by ${userId}: ${executionTimeMs}ms${success ? "" : " (failed)"}`
        );
      }
    });
}
/**
 * Extract command name from message content
 */
function extractCommandName(content, platform) {
  const prefix = platform === "discord" ? "!" : "/";
  const parts = content.trim().split(" ");
  return parts[0] || "unknown";
}
/**
 * Determine if execution time is slow (threshold: 2 seconds)
 */
function isSlowExecution(executionTimeMs) {
  return executionTimeMs > 2000;
}
