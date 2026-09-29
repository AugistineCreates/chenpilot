/**
 * Thread Safety
 * Thread safety checks and validation
 */

export interface ThreadOperation {
  type: 'create' | 'archive' | 'delete' | 'send' | 'pin';
  threadId: string;
  channelId: string;
  userId: string;
  permissions: string[];
  metadata: Record<string, any>;
}

export interface ThreadSafetyCheck {
  allowed: boolean;
  reason?: string;
  requiredPermissions?: string[];
  warnings?: string[];
}

export class ThreadSafety {
  private operationHistory: Map<string, number[]>;
  private rateLimits: Map<string, { count: number; resetTime: number }>;

  constructor() {
    this.operationHistory = new Map();
    this.rateLimits = new Map();
  }

  /**
   * Check if a thread operation is safe to execute
   */
  async checkOperation(operation: ThreadOperation): Promise<ThreadSafetyCheck> {
    const warnings: string[] = [];

    // Check rate limit
    if (!this.checkRateLimit(operation.userId)) {
      return {
        allowed: false,
        reason: 'Rate limit exceeded',
        warnings,
      };
    }

    // Check operation history
    const history = this.operationHistory.get(operation.userId) || [];
    const recentOperations = history.filter(
      timestamp => Date.now() - timestamp < 60000 // Last minute
    );

    if (recentOperations.length > 20) {
      warnings.push('High operation frequency detected');
    }

    // Check permissions
    const requiredPermissions = this.getRequiredPermissions(operation.type);
    const hasPermissions = this.validatePermissions(operation.permissions, requiredPermissions);

    if (!hasPermissions) {
      return {
        allowed: false,
        reason: 'Insufficient permissions',
        requiredPermissions,
        warnings,
      };
    }

    // Record operation
    this.recordOperation(operation.userId);

    return {
      allowed: true,
      warnings,
    };
  }

  /**
   * Validate permissions for operation
   */
  private validatePermissions(userPermissions: string[], required: string[]): boolean {
    return required.every(perm => userPermissions.includes(perm));
  }

  /**
   * Get required permissions for operation type
   */
  private getRequiredPermissions(type: string): string[] {
    switch (type) {
      case 'create':
        return ['MANAGE_THREADS'];
      case 'archive':
        return ['MANAGE_THREADS'];
      case 'delete':
        return ['MANAGE_THREADS', 'ADMINISTRATOR'];
      case 'send':
        return ['SEND_MESSAGES_IN_THREADS'];
      case 'pin':
        return ['MANAGE_MESSAGES'];
      default:
        return [];
    }
  }

  /**
   * Check rate limit for user
   */
  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(userId);

    if (!entry || now > entry.resetTime) {
      this.rateLimits.set(userId, { count: 1, resetTime: now + 60000 }); // 1 minute window
      return true;
    }

    if (entry.count >= 30) {
      return false;
    }

    entry.count++;
    return true;
  }

  /**
   * Record operation for history
   */
  private recordOperation(userId: string): void {
    const history = this.operationHistory.get(userId) || [];
    history.push(Date.now());

    // Keep only last 100 operations
    if (history.length > 100) {
      history.shift();
    }

    this.operationHistory.set(userId, history);
  }

  /**
   * Get operation history for user
   */
  getOperationHistory(userId: string): number[] {
    return this.operationHistory.get(userId) || [];
  }

  /**
   * Clear operation history for user
   */
  clearHistory(userId: string): void {
    this.operationHistory.delete(userId);
    this.rateLimits.delete(userId);
  }

  /**
   * Clear all history
   */
  clearAllHistory(): void {
    this.operationHistory.clear();
    this.rateLimits.clear();
  }
}
