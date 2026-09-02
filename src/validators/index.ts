import {
  IsString,
  IsOptional,
  IsEnum,
  IsEmail,
  IsUrl,
  IsUUID,
  IsInt,
  IsPositive,
  MinLength,
  MaxLength,
  IsDateString,
  IsBoolean,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsObject,
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from "class-validator";
import { StrKey } from "@stellar/stellar-sdk";

// Re-export existing validators
export {
  IsStellarPublicKey,
  IsStellarPublicKeyConstraint,
} from "./IsStellarPublicKey";

/**
 * Common DTOs for platform-wide use
 */

/**
 * Pagination query parameters
 */
export class PaginationDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  limit?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  page?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

/**
 * Date range query parameters
 */
export class DateRangeDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

/**
 * Base bot session DTO
 */
export class BotSessionDto {
  @IsString()
  userId: string;

  @IsString()
  platform: string;

  @IsString()
  sessionType: string;

  @IsInt()
  step: number;

  @IsObject()
  sessionData: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Enum values validator constraint
 */
@ValidatorConstraint({ async: false })
export class IsEnumValuesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (value === undefined || value === null) return true;

    const [enumValues] = args.constraints;
    if (Array.isArray(enumValues)) {
      return enumValues.includes(value);
    }
    return false;
  }

  defaultMessage(args: ValidationArguments): string {
    const [enumValues] = args.constraints;
    const valuesStr = Array.isArray(enumValues)
      ? enumValues.join(", ")
      : String(enumValues);
    return `Value must be one of: ${valuesStr}`;
  }
}

/**
 * Custom decorator to validate enum values
 */
export function IsEnumValues(
  enumValues: string[],
  validationOptions?: ValidationOptions
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isEnumValues",
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [enumValues],
      validator: IsEnumValuesConstraint,
    });
  };
}

/**
 * Stellar address validator constraint
 */
@ValidatorConstraint({ async: false })
export class IsStellarAddressConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== "string") return false;
    try {
      return (
        StrKey.isValidEd25519PublicKey(value) ||
        StrKey.isValidMuxedAccount(value)
      );
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return "Invalid Stellar address format";
  }
}

/**
 * Decorator for validating Stellar addresses
 */
export function IsStellarAddress(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isStellarAddress",
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsStellarAddressConstraint,
    });
  };
}

/**
 * Non-negative number validator
 */
@ValidatorConstraint({ async: false })
export class IsNonNegativeNumberConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value === "number") {
      return value >= 0 && !isNaN(value);
    }
    if (typeof value === "string") {
      const num = parseFloat(value);
      return !isNaN(num) && num >= 0;
    }
    return false;
  }

  defaultMessage(): string {
    return "Value must be a non-negative number";
  }
}

/**
 * Decorator for non-negative numbers
 */
export function IsNonNegativeNumber(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isNonNegativeNumber",
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsNonNegativeNumberConstraint,
    });
  };
}

/**
 * String representing a positive integer
 */
@ValidatorConstraint({ async: false })
export class IsPositiveIntegerStringConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== "string") return false;
    const num = parseInt(value, 10);
    return !isNaN(num) && num > 0 && num.toString() === value;
  }

  defaultMessage(): string {
    return "Value must be a positive integer string";
  }
}

/**
 * Decorator for positive integer strings
 */
export function IsPositiveIntegerString(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isPositiveIntegerString",
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsPositiveIntegerStringConstraint,
    });
  };
}

// Re-export common class-validator decorators for convenience
export {
  IsString,
  IsOptional,
  IsEnum,
  IsEmail,
  IsUrl,
  IsUUID,
  IsInt,
  IsPositive,
  MinLength,
  MaxLength,
  IsDateString,
  IsBoolean,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsObject,
};
