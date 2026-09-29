import { NextFunction, Request, Response } from "express";
import {
  buildCorrelationHeaders,
  createExecutionContext,
  extractContextFromHeaders,
  runWithExecutionContext,
} from "./context";

export function observabilityMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const initialContext = createExecutionContext({
    ...extractContextFromHeaders(req.headers),
    transport: "http",
    method: req.method,
    path: req.path,
    ip:
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      undefined,
    userAgent: req.headers["user-agent"] as string | undefined,
    operationName: `${req.method} ${req.path}`,
    component: "http",
  });

  req.requestId = initialContext.requestId;
  req.executionId = initialContext.executionId;
  req.rootExecutionId = initialContext.rootExecutionId;
  req.parentExecutionId = initialContext.parentExecutionId;

  const headers = buildCorrelationHeaders(initialContext);
  Object.entries(headers).forEach(([headerName, value]) => {
    res.setHeader(headerName, value);
  });

  runWithExecutionContext(initialContext, () => next());
}

export function withTrace<T>(
  options: {
    kind: "tool" | "queue" | "llm" | "blockchain" | "custom";
    name: string;
  },
  callback: () => Promise<T>
): Promise<T> {
  return callback();
}
