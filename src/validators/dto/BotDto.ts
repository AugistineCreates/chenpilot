import {
  IsString,
  IsOptional,
  IsInt,
  IsPositive,
  IsEnumValues,
  IsObject,
  IsDateString,
  MinLength,
} from "../index";
import { BotPlatform, BotSessionType } from "../../Bot/botSession.entity";

/**
 * Bot metrics DTO
 */
export class BotMetricsDto {
  @IsString()
  @MinLength(1)
  command!: string;

  @IsString()
  @MinLength(1)
  platform!: string;

  @IsString()
  @MinLength(1)
  userId!: string;

  @IsPositive()
  executionTimeMs!: number;

  @IsOptional()
  @IsString()
  error?: string;

  @IsOptional()
  @IsDateString()
  timestamp?: string;

  @IsOptional()
  @IsString()
  success?: string; // Will be converted to boolean
}

/**
 * Create bot session DTO
 */
export class CreateBotSessionDto {
  @IsString()
  @MinLength(1)
  userId!: string;

  @IsEnumValues(Object.values(BotPlatform))
  platform!: BotPlatform;

  @IsEnumValues(Object.values(BotSessionType))
  sessionType!: BotSessionType;

  @IsInt()
  @IsPositive()
  step!: number;

  @IsObject()
  sessionData!: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

/**
 * Query bot session DTO
 */
export class QueryBotSessionDto {
  @IsString()
  @MinLength(1)
  userId!: string;

  @IsEnumValues(Object.values(BotPlatform))
  platform!: BotPlatform;

  @IsEnumValues(Object.values(BotSessionType))
  sessionType!: BotSessionType;
}

/**
 * Update bot session DTO
 */
export class UpdateBotSessionDto {
  @IsOptional()
  @IsInt()
  step?: number;

  @IsOptional()
  @IsObject()
  sessionData?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  isActive?: string; // Will be converted to boolean
}
