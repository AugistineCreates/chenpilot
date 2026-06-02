import { NextFunction, Request, Response } from "express";
import {
  buildCorrelationHeaders,
  createObservabilityContext,
  extractObservabilityContextFromHeaders,
  runWithObservabilityContext,
} from "./context";

export function observabilityMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const initialContext = createObservabilityContext({
    ...extractObservabilityContextFromHeaders(req.headers),
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

  runWithObservabilityContext(initialContext, () => next());
}
