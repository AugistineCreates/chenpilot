export interface LockOptions {
  ttl?: number;
  retryDelay?: number;
  maxRetries?: number;
}

export interface LockResult {
  acquired: boolean;
  lockKey: string;
  lockValue?: string;
  ttl?: number;
  acquiredAt?: number;
  error?: string;
}

export interface LockInfo {
  key: string;
  value: string;
  ownerId: string;
  ttl: number;
  createdAt: number;
}

export interface LockService {
  acquireLock(
    resourceKey: string,
    identifier: string,
    options?: LockOptions
  ): Promise<LockResult>;

  releaseLock(resourceKey: string, identifier: string): Promise<boolean>;

  forceReleaseLock(resourceKey: string): Promise<boolean>;

  extendLock(
    resourceKey: string,
    identifier: string,
    ttl: number
  ): Promise<boolean>;

  isLocked(resourceKey: string): Promise<boolean>;

  getLockInfo(resourceKey: string): Promise<LockInfo | null>;
}
