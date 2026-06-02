import { ValidationError } from './errors';

export const validateNonNegative = (value: string, fieldName: string): void => {
  const num = parseFloat(value);
  if (isNaN(num)) {
    throw new ValidationError(`${fieldName} must be a valid number, got ${value}`);
  }
  if (num < 0) {
    throw new ValidationError(`${fieldName} cannot be negative, got ${value}`);
  }
};

export const validatePositive = (value: string, fieldName: string): void => {
  const num = parseFloat(value);
  if (isNaN(num)) {
    throw new ValidationError(`${fieldName} must be a valid number, got ${value}`);
  }
  if (num <= 0) {
    throw new ValidationError(`${fieldName} must be positive, got ${value}`);
  }
};

export const validateAddress = (address: string): void => {
  // Stellar address format validation
  const stellarAddressRegex = /^G[A-Z0-9]{55}$/;
  if (!stellarAddressRegex.test(address)) {
    throw new ValidationError(`Invalid Stellar address: ${address}`);
  }
};

export const validateAssetCode = (code: string): void => {
  if (!code || code.length < 1 || code.length > 12) {
    throw new ValidationError(`Asset code must be 1-12 characters, got ${code}`);
  }
  if (!/^[A-Za-z0-9]+$/.test(code)) {
    throw new ValidationError(`Asset code must be alphanumeric, got ${code}`);
  }
};
