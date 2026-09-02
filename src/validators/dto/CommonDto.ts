import { IsString, MinLength } from "class-validator";
import { IsPositiveIntegerString } from "../index";

/**
 * Generic ID parameter DTO
 */
export class IdParamDto {
  @IsString()
  @IsPositiveIntegerString()
  id!: string;
}

/**
 * Generic UUID parameter DTO
 */
export class UUIDParamDto {
  @IsString()
  @MinLength(1)
  id!: string;
}
