import "express";

declare module "express" {
  interface Request {
    clientIP?: string;
    user?: {
      userId: string;
      id: string;
      role?: string;
      [key: string]: unknown;
    };
  }
}
