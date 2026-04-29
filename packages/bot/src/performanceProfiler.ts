/**
 * Performance Profiler for Bot Commands
 * 
 * This module provides utilities to measure and log the execution time
 * of bot command handlers to the backend for performance monitoring.
 */

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";

export interface CommandPerformanceMetrics {
  command: string;
  platform: 'discord' | 'telegram';
  userId: string;
  executionTimeMs: number;
  success: boolean;
  error?: string;
  timestamp: string;
}

/**
 * Log command execution metrics to the backend
 */
async function logCommandMetrics(metrics: CommandPerformanceMetrics): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/api/bot/metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metrics),
    });
  } catch (error) {
    // Fail silently - don't interrupt bot operation if logging fails
    console.error('Failed to log command metrics:', error);
  }
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
export function withPerformanceProfiling<T extends (...args: any[]) => Promise<any>>(
  command: string,
  platform: 'discord' | 'telegram',
  userId: string,
  handler: T
): T {
  return (async (...args: Parameters<T>) => {
    const startTime = Date.now();
    let success = true;
    let error: string | undefined;

    try {
      const result = await handler(...args);
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
      console.log(`[Bot Performance] ${platform} ${command} by ${userId}: ${executionTimeMs}ms${success ? '' : ' (failed)'}`);
    }
  }) as T;
}

/**
 * Extract command name from message content
 */
export function extractCommandName(content: string, platform: 'discord' | 'telegram'): string {
  const prefix = platform === 'discord' ? '!' : '/';
  const parts = content.trim().split(' ');
  return parts[0] || 'unknown';
}

/**
 * Determine if execution time is slow (threshold: 2 seconds)
 */
export function isSlowExecution(executionTimeMs: number): boolean {
  return executionTimeMs > 2000;
}
