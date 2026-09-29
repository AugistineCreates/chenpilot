import { IsString, IsOptional } from "class-validator";

/**
 * DTO for Horizon proxy query parameters
 */
export class HorizonProxyQueryDto {
  @IsString()
  path!: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  order?: string;
}
