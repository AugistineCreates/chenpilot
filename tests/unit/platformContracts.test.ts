/**
 * Tests for the platform-wide validation contracts.
 *   - ApiError factory helpers & envelope shape
 *   - ok() / created() / noContent() success helpers
 *   - validateBody / validateQuery / validateParams middleware
 *   - Common DTOs from src/contracts/dtos.ts
 *   - Central ErrorHandler middleware integration
 */
import express from "express";
import request from "supertest";

import {
  ApiError,
  ApiErrorCode,
  ok,
  created,
  noContent,
  buildSuccess,
  validateBody,
  validateQuery,
  validateParams,
  PaginationQueryDto,
  BlacklistListQueryDto,
  BlacklistBulkAddBodyDto,
  IpAddressParamDto,
  isApiError,
} from "../../src/contracts";
import { ErrorHandler } from "../../src/Gateway/middleware/errorHandler";
import { LoginDto } from "../../src/validators/dto/AuthDto";
import { AuditLogListQueryDto } from "../../src/contracts";
import { NotFoundError, UnauthorizedError } from "../../src/utils/error";

describe("ApiError contract", () => {
  it("badRequest() builds a 400 BAD_REQUEST envelope", () => {
    const e = ApiError.badRequest("nope");
    expect(e.statusCode).toBe(400);
    expect(e.code).toBe(ApiErrorCode.BAD_REQUEST);
    expect(e.message).toBe("nope");
    expect(e.toResponse(false)).toEqual({
      success: false,
      status: 400,
      error: {
        message: "nope",
        code: "BAD_REQUEST",
        details: undefined,
        stack: undefined,
      },
    });
  });

  it("factory helpers map status → default code when one is not given", () => {
    expect(ApiError.notFound().code).toBe("NOT_FOUND");
    expect(ApiError.unauthorized().code).toBe("UNAUTHORIZED");
    expect(ApiError.forbidden().code).toBe("FORBIDDEN");
    expect(ApiError.conflict().code).toBe("CONFLICT");
    expect(ApiError.internal().code).toBe("INTERNAL_SERVER_ERROR");
    expect(ApiError.serviceUnavailable().code).toBe("SERVICE_UNAVAILABLE");
  });

  it("validationFailed(details[]) carries the full failure list", () => {
    const details = [
      { field: "email", message: "must be an email" },
      { field: "age", message: "must be >= 0" },
    ];
    const e = ApiError.validationFailed(details, "Invalid input");
    expect(e.statusCode).toBe(422);
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.details).toEqual(details);
    expect(e.toResponse(false).error.details).toEqual(details);
  });

  it("isApiError() narrows correctly for ApiError and legacy errors", () => {
    expect(isApiError(ApiError.badRequest("x"))).toBe(true);
    expect(isApiError(new Error("plain"))).toBe(false);
    expect(isApiError(new NotFoundError("legacy"))).toBe(true);
  });

  it("legacy ApplicationError subclasses extend ApiError", () => {
    const err = new UnauthorizedError("no token");
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("UNAUTHORIZED");
    expect(isApiError(err)).toBe(true);
  });
});

describe("Success-response helpers", () => {
  it("ok() returns 200 with the canonical envelope", () => {
    const res = makeMockRes();
    ok(res as unknown as express.Response, { foo: "bar" }, "yay");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { foo: "bar" },
      message: "yay",
    });
  });

  it("ok() omits `data` when undefined (preserves legacy /auth/logout wire shape)", () => {
    const res = makeMockRes();
    ok(res as unknown as express.Response, undefined, "Logged out");
    expect(res.body).toEqual({ success: true, message: "Logged out" });
    expect("data" in res.body).toBe(false);
  });

  it("ok() includes `data: null` when explicitly null", () => {
    const res = makeMockRes();
    ok(res as unknown as express.Response, null, "null payload");
    expect(res.body).toEqual({
      success: true,
      data: null,
      message: "null payload",
    });
  });

  it("ok() omits `message` when not provided", () => {
    const res = makeMockRes();
    ok(res as unknown as express.Response, { foo: "bar" });
    expect(res.body).toEqual({ success: true, data: { foo: "bar" } });
  });

  it("created() returns 201 with the canonical envelope", () => {
    const res = makeMockRes();
    created(res as unknown as express.Response, { id: 1 }, "made");
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({
      success: true,
      data: { id: 1 },
      message: "made",
    });
  });

  it("created() also omits `data` when undefined", () => {
    const res = makeMockRes();
    created(res as unknown as express.Response, undefined, "ok");
    expect(res.body).toEqual({ success: true, message: "ok" });
    expect("data" in res.body).toBe(false);
  });

  it("noContent() returns 204 with no body", () => {
    const res = makeMockRes();
    noContent(res as unknown as express.Response);
    expect(res.statusCode).toBe(204);
  });

  it("buildSuccess() produces a response envelope without sending", () => {
    expect(buildSuccess({ x: 1 }, "ok")).toEqual({
      success: true,
      data: { x: 1 },
      message: "ok",
    });
  });
});

describe("Validation middleware — validateBody / validateQuery / validateParams", () => {
  function makeApp(
    middleware: express.RequestHandler,
    handler: express.RequestHandler
  ) {
    const app = express();
    app.use(express.json());
    app.post("/x", middleware, handler);
    app.get("/x", middleware, handler);
    app.use(ErrorHandler);
    return app;
  }

  it("validateBody(LoginDto) accepts valid bodies and exposes typed body downstream", async () => {
    const seen: { body: unknown } = { body: undefined };
    const app = makeApp(validateBody(LoginDto), (req, res) => {
      seen.body = req.body;
      ok(res, { ok: true });
    });

    const res = await request(app).post("/x").send({ name: "alice" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { ok: true } });
    expect((seen.body as LoginDto).name).toBe("alice");
  });

  it("validateBody rejects missing required fields with a validation envelope", async () => {
    const app = makeApp(validateBody(LoginDto), (_req, res) =>
      ok(res, { ok: true })
    );

    const res = await request(app).post("/x").send({});
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(
      (res.body.error.details as Array<{ field: string }>).some(
        (d) => d.field === "name"
      )
    ).toBe(true);
  });

  it("validateBody rejects unknown fields when forbidNonWhitelisted is set", async () => {
    const app = makeApp(validateBody(LoginDto), (_req, res) =>
      ok(res, { ok: true })
    );

    const res = await request(app).post("/x").send({ name: "alice", evil: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("validateQuery(PaginationQueryDto) coerces and clamps query strings", async () => {
    const seen: { query: unknown } = { query: undefined };
    const app = makeApp(validateQuery(PaginationQueryDto), (req, res) => {
      seen.query = req.query;
      ok(res, { ok: true });
    });

    const res = await request(app).get("/x?limit=10&offset=2");
    expect(res.status).toBe(200);
    const q = seen.query as PaginationQueryDto;
    expect(q.limit).toBe(10);
    expect(q.offset).toBe(2);
  });

  it("validateQuery rejects out-of-range limits (above 500)", async () => {
    const app = makeApp(validateQuery(PaginationQueryDto), (_req, res) =>
      ok(res, { ok: true })
    );

    const res = await request(app).get("/x?limit=10000");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(
      (res.body.error.details as Array<{ field: string }>).some(
        (d) => d.field === "limit"
      )
    ).toBe(true);
  });

  it("validateQuery(BlacklistListQueryDto) coerces activeOnly=true|false", async () => {
    const seen: { query: unknown } = { query: undefined };
    const app = makeApp(validateQuery(BlacklistListQueryDto), (req, res) => {
      seen.query = req.query;
      ok(res, { ok: true });
    });
    const res = await request(app).get("/x?activeOnly=true&limit=5&offset=0");
    expect(res.status).toBe(200);
    const q = seen.query as BlacklistListQueryDto;
    expect(q.activeOnly).toBe(true);
    expect(q.limit).toBe(5);
    expect(q.offset).toBe(0);

    const res2 = await request(app).get("/x?activeOnly=garbage");
    expect(res2.status).toBe(422);
  });

  it("validateParams(IpAddressParamDto) accepts v4 and v6", async () => {
    const seen: { ip: unknown } = { ip: undefined };
    const app = express();
    app.use("/x/:ip", validateParams(IpAddressParamDto), (req, res) => {
      seen.ip = (req.params as IpAddressParamDto).ip;
      ok(res, { ok: true });
    });
    app.use(ErrorHandler);

    const r1 = await request(app).get("/x/127.0.0.1");
    expect(r1.status).toBe(200);
    expect(seen.ip).toBe("127.0.0.1");

    const r2 = await request(app).get("/x/::1");
    expect(r2.status).toBe(200);
    expect(seen.ip).toBe("::1");

    const r3 = await request(app).get("/x/not-an-ip");
    expect(r3.status).toBe(422);
  });

  it("BlacklistBulkAddBodyDto rejects empty ips[] with field=ips", async () => {
    const app = makeApp(validateBody(BlacklistBulkAddBodyDto), (_req, res) =>
      ok(res, { ok: true })
    );
    const res = await request(app).post("/x").send({ ips: [] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(
      (res.body.error.details as Array<{ field: string }>).some(
        (d) => d.field === "ips"
      )
    ).toBe(true);
  });

  it("BlacklistBulkAddBodyDto rejects >1000 entries with field=ips", async () => {
    const ips = Array.from({ length: 1001 }, (_, i) => `10.0.0.${i % 256}`);
    const app = makeApp(validateBody(BlacklistBulkAddBodyDto), (_req, res) =>
      ok(res, { ok: true })
    );
    const res = await request(app).post("/x").send({ ips });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(
      (res.body.error.details as Array<{ field: string }>).some(
        (d) => d.field === "ips"
      )
    ).toBe(true);
  });

  it("BlacklistBulkAddBodyDto rejects entries that aren't valid IPs", async () => {
    const app = makeApp(validateBody(BlacklistBulkAddBodyDto), (_req, res) =>
      ok(res, { ok: true })
    );
    const res = await request(app)
      .post("/x")
      .send({ ips: ["127.0.0.1", "not-an-ip", "also-not-an-ip"] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(
      (
        res.body.error.details as Array<{ field: string; message: string }>
      ).some((d) => d.field === "ips")
    ).toBe(true);
  });

  it("IsOptionalBooleanString rejects garbage strings (no silent truthy-coerce)", async () => {
    const app = makeApp(validateQuery(BlacklistListQueryDto), (_req, res) =>
      ok(res, { ok: true })
    );
    const res = await request(app).get(
      "/x?activeOnly=garbage&limit=5&offset=0"
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(
      (res.body.error.details as Array<{ field: string }>).some(
        (d) => d.field === "activeOnly"
      )
    ).toBe(true);
  });

  it("AuditLogListQueryDto.success rejects garbage (mirrors activeOnly test)", async () => {
    // Regression test: the audit-log route uses the canonical
    //   @Transform(booleanFromStringTransform) @IsOptionalBooleanString()
    // pattern (without a leading @IsOptional(), which would short-circuit
    // the validator when the transform sentinel is `null`). This test
    // guards against any future copy-paste that re-adds `@IsOptional()`
    // and silently re-introduces the truthy-coerce regression.
    const app = makeApp(validateQuery(AuditLogListQueryDto), (_req, res) =>
      ok(res, { ok: true })
    );
    const res = await request(app).get("/x?success=garbage");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(
      (res.body.error.details as Array<{ field: string }>).some(
        (d) => d.field === "success"
      )
    ).toBe(true);
  });

  it("validateBody with messagePrefix prefixes the thrown error message", async () => {
    const app = makeApp(
      validateBody(LoginDto, { messagePrefix: "login" }),
      (_req, res) => ok(res, { ok: true })
    );

    const res = await request(app).post("/x").send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(String(res.body.error.message).startsWith("login")).toBe(true);
  });
});

describe("Central ErrorHandler middleware", () => {
  function buildApp(handler: express.RequestHandler, throwWith?: unknown) {
    const app = express();
    app.get("/boom", (_req, _res, _next) => {
      if (throwWith !== undefined) throw throwWith;
      handler(_req, _res, _next);
    });
    app.use(ErrorHandler);
    return app;
  }

  it("renders an ApiError into the canonical envelope", async () => {
    const app = buildApp(() => undefined, ApiError.notFound("no such user"));
    const res = await request(app).get("/boom");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      status: 404,
      error: { code: "NOT_FOUND", message: "no such user" },
    });
  });

  it("renders a legacy ApplicationError subclass with the canonical envelope", async () => {
    const app = buildApp(
      () => undefined,
      new NotFoundError("legacy not found")
    );
    const res = await request(app).get("/boom");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 500 with INTERNAL_SERVER_ERROR for an unknown error", async () => {
    const app = buildApp(() => undefined, new Error("boom"));
    const res = await request(app).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("translates Postgres error code 23505 to DUPLICATE_ENTRY (409)", async () => {
    const pg = Object.assign(new Error("dup"), { code: "23505" });
    const app = buildApp(() => undefined, pg);
    const res = await request(app).get("/boom");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_ENTRY");
  });
});

/* ----------------------- helpers ----------------------- */
type MockResponse = {
  body: unknown;
  statusCode: number;
  status: (code: number) => MockResponse;
  json: (body: unknown) => MockResponse;
  send: (body?: unknown) => MockResponse;
};

function makeMockRes(): MockResponse {
  const res: MockResponse = {
    body: undefined,
    statusCode: 200,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    send(body?: unknown) {
      res.body = body ?? null;
      return res;
    },
  };
  return res;
}
