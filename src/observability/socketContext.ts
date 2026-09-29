import { Socket } from "socket.io";
import { ExecutionContext, getExecutionContext, runWithExecutionContext } from "../observability/context";

export interface SocketContext {
  socket: Socket;
  userId?: string;
  roles?: string[];
}

export function createSocketContext(socket: Socket, userId?: string): ExecutionContext {
  const current = getExecutionContext();
  return {
    requestId: current?.requestId || undefined,
    executionId: current?.executionId || undefined,
    rootExecutionId: current?.rootExecutionId || undefined,
    parentExecutionId: current?.parentExecutionId,
    userId,
    roles: userId ? [] : undefined,
    transport: "websocket",
    ip:
      (socket.handshake.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      socket.handshake.address ||
      undefined,
    userAgent: socket.handshake.headers["user-agent"] as string | undefined,
    path: socket.handshake.url,
    component: "websocket",
    messageId: socket.id,
  };
}

export function propagateSocketContext<T>(
  socket: Socket,
  userId?: string,
  callback: () => T
): T {
  const context = createSocketContext(socket, userId);
  return runWithExecutionContext(context, callback);
}
