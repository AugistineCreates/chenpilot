export class DomainError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class InsufficientBalanceError extends DomainError {
  constructor(asset: string, available: string, requested: string) {
    super(`Insufficient balance for ${asset}: available ${available}, requested ${requested}`, 'INSUFFICIENT_BALANCE');
    this.name = 'InsufficientBalanceError';
  }
}

export class AssetNotFoundError extends DomainError {
  constructor(assetCode: string) {
    super(`Asset not found: ${assetCode}`, 'ASSET_NOT_FOUND');
    this.name = 'AssetNotFoundError';
  }
}

export class InvalidAmountError extends DomainError {
  constructor(amount: string, reason: string) {
    super(`Invalid amount ${amount}: ${reason}`, 'INVALID_AMOUNT');
    this.name = 'InvalidAmountError';
  }
}
