import { IsString, IsOptional, IsDateString } from "class-validator";
import { IsEnumValues } from "../index";

/**
 * Transaction query DTO for validating query parameters
 */
export class TransactionQueryDto {
  @IsOptional()
  @IsEnumValues(["funding", "deployment", "swap", "transfer", "all"])
  type?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  cursor?: string;
}

/**
 * User ID param DTO
 */
export class UserIdParamDto {
  @IsString()
  userId!: string;
}

/**
 * Session ID param DTO
 */
export class SessionIdParamDto {
  @IsString()
  sessionId!: string;
}
