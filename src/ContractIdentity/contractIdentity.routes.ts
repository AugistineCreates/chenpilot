/**
 * contractIdentity.routes.ts
 *
 * Admin API for signed deployment manifests (Issue #676).
 *
 *   GET    /api/contract-identity/manifests          list all manifests
 *   GET    /api/contract-identity/manifests/:network/:name  read one manifest
 *   POST   /api/contract-identity/manifests          publish a signed manifest (admin)
 *   POST   /api/contract-identity/manifests/:network/:name/rotate  rotate identity (admin)
 *   GET    /api/contract-identity/status             runtime identity-gate status
 *
 * Publish / rotate are restricted to authenticated admins and are recorded in
 * the security audit ledger (signed + auditable rotation).
 */

import { Router, Request, Response } from "express";
import { authenticateToken } from "../Auth/auth.middleware";
import { requireAdmin } from "../Gateway/middleware/rbac.middleware";
import { manifestService } from "./manifestService";
import { identityGateStatus } from "./codeIdentityGate";
import { ManifestError } from "./errors";
import { ManifestNetwork } from "./deploymentManifest.types";

const router = Router();

function parseNetwork(value: string): ManifestNetwork {
  if (value === "testnet" || value === "mainnet") return value;
  throw new ManifestError(
    `Invalid network "${value}"; must be testnet or mainnet`
  );
}

// List all signed deployment manifests
router.get("/manifests", async (_req: Request, res: Response) => {
  try {
    const manifests = await manifestService.list();
    res.json({ success: true, data: manifests });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Read a single manifest by network + name
router.get("/manifests/:network/:name", async (req: Request, res: Response) => {
  try {
    const network = parseNetwork(req.params.network);
    const manifest = await manifestService.get(network, req.params.name);
    if (!manifest) {
      return res
        .status(404)
        .json({ success: false, error: "Manifest not found" });
    }
    res.json({ success: true, data: manifest });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Publish a new signed manifest (admin)
router.post(
  "/manifests",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const manifest = await manifestService.publish(req.body);
      res.status(201).json({ success: true, data: manifest });
    } catch (err) {
      const status = err instanceof ManifestError ? 400 : 500;
      res
        .status(status)
        .json({ success: false, error: (err as Error).message });
    }
  }
);

// Rotate a manifest to a new identity (admin, signed + auditable)
router.post(
  "/manifests/:network/:name/rotate",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const network = parseNetwork(req.params.network);
      const actor = {
        userId: (req as Request & { user?: { userId?: string } }).user?.userId,
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      };
      const final = await manifestService.rotate(
        network,
        req.params.name,
        req.body as never,
        actor
      );
      res.json({ success: true, data: final });
    } catch (err) {
      const status = err instanceof ManifestError ? 400 : 500;
      res
        .status(status)
        .json({ success: false, error: (err as Error).message });
    }
  }
);

// Runtime identity-gate status (read side, used by operator reporting)
router.get("/status", async (_req: Request, res: Response) => {
  res.json({ success: true, data: identityGateStatus() });
});

export default router;
