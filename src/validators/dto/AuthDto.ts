import { IsString, MinLength, MaxLength } from "class-validator";

/**
 * Login request DTO
 */
export class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
}

/**
 * Refresh token request DTO
 */
export class RefreshTokenDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

/**
 * Logout request DTO
 */
export class LogoutDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

/**
 * User role enum
 */
export enum UserRole {
  USER = "user",
  MODERATOR = "moderator",
  ADMIN = "admin",
}

/**
 * Signup request DTO
 */
export class SignupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsString()
  @MinLength(1)
  address!: string;

  @IsString()
  @MinLength(1)
  pk!: string;
}
