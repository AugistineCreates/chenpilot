// Common type utilities
export type Timestamp = string; // ISO 8601 format
export type UUID = string;
export type Address = string;
export type Amount = string; // Decimal string for precision

// Base entity interface
export interface BaseEntity {
  id: UUID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  version: number;
}

// Result pattern for error handling
export type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E };

// Pagination types
export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// Value object base
export abstract class ValueObject<T> {
  protected readonly _value: T;

  constructor(value: T) {
    this._value = Object.freeze(value);
  }

  get value(): T {
    return this._value;
  }

  equals(other: ValueObject<T>): boolean {
    return JSON.stringify(this._value) === JSON.stringify(other._value);
  }
}
