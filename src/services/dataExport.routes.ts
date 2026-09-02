import { Router, Request, Response } from "express";
import { authenticateToken } from "../Auth/auth.middleware";
import { DataExportService } from "./DataExportService";
import { deletionCoordinator } from "../lifecycle/deletionCoordinator";
import { erasureReporter } from "../lifecycle/erasureReporter";
import { HoldBlocksErasureError } from "../lifecycle/legalHold";
import logger from "../config/logger";

const router = Router();
const dataExportService = new DataExportService();

/**
 * GET /export/profile - Export user profile data as JSON
 * Requires authentication
 * Returns all user data in standardized JSON format
 */
router.get(
  "/profile",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const userId = req.user.userId;

      logger.info("User profile export requested", { userId });

      const exportData = await dataExportService.exportUserData(userId);

      logger.info("User profile export completed", {
        userId,
        dataSize: JSON.stringify(exportData).length,
      });

      return res.status(200).json({
        success: true,
        data: exportData,
      });
    } catch (error) {
      logger.error("Profile export error", {
        error,
        userId: req.user?.userId,
      });
      return res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to export profile data",
      });
    }
  }
);

/**
 * GET /export/download - Download user profile data as JSON file
 * Requires authentication
 * Returns JSON file for download
 */
router.get(
  "/download",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const userId = req.user.userId;
      const userName = req.user.username || "user";

      logger.info("User profile download requested", { userId });

      const exportBuffer =
        await dataExportService.exportUserDataAsBuffer(userId);

      const filename = `${userName}_profile_export_${new Date().toISOString().split("T")[0]}.json`;

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.setHeader("Content-Length", exportBuffer.length.toString());

      logger.info("User profile download completed", {
        userId,
        filename,
        fileSize: exportBuffer.length,
      });

      return res.send(exportBuffer);
    } catch (error) {
      logger.error("Profile download error", {
        error,
        userId: req.user?.userId,
      });
      return res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to download profile data",
      });
    }
  }
);

/**
 * GET /export/metadata - Get export metadata without full data
 * Requires authentication
 * Returns summary of what would be exported
 */
router.get(
  "/metadata",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const userId = req.user.userId;

      logger.info("Export metadata requested", { userId });

      const exportData = await dataExportService.exportUserData(userId);

      const metadata = {
        exportVersion: exportData.exportMetadata.exportVersion,
        userId: exportData.exportMetadata.userId,
        statistics: exportData.statistics,
        dataCategories: {
          profile: true,
          contacts: exportData.contacts.length > 0,
          conversationHistory: exportData.conversationHistory.totalEntries > 0,
          sessions: exportData.sessions.length > 0,
        },
      };

      return res.status(200).json({
        success: true,
        data: metadata,
      });
    } catch (error) {
      logger.error("Export metadata error", {
        error,
        userId: req.user?.userId,
      });
      return res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to retrieve export metadata",
      });
    }
  }
);

export default router;

/**
 * POST /export/erase - Permanently erase all user-owned data (GDPR/right-to-erasure)
 *
 * Propagates deletion to: DB rows, Redis caches, disk memory file.
 * Cryptographic erasure: tombstones the per-user DEK, making any remaining
 * encrypted data permanently unreadable.
 *
 * Returns a signed erasure receipt as proof of completion.
 *
 * Returns 409 if an active legal hold blocks erasure.
 */
router.post(
  "/erase",
  authenticateToken,
  async (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const userId = req.user.userId;

    logger.info("User erasure requested", { userId });

    try {
      const result = await deletionCoordinator.eraseUser(userId, {
        reason: "user_request",
        requestedBy: userId,
      });

      const receipt = await erasureReporter.generateReceipt(result);

      logger.info("User erasure completed", {
        userId,
        stepsCompleted: result.stepsCompleted.length,
        stepsFailed: result.stepsFailed.length,
        cryptoErasurePerformed: result.cryptoErasurePerformed,
        receiptId: receipt.receiptId,
      });

      // Return the receipt — it intentionally contains only the hash of the userId,
      // not the userId itself, so it can be shared with compliance teams safely.
      return res.status(200).json({
        success: true,
        message: "Your data has been erased. Keep the receipt as proof.",
        receipt,
      });
    } catch (err) {
      if (err instanceof HoldBlocksErasureError) {
        return res.status(409).json({
          success: false,
          message: err.message,
          holds: err.activeHolds.map((h) => ({
            holdId: h.holdId,
            reason: h.reason,
            dataClasses: h.dataClasses,
            placedAt: h.placedAt,
          })),
        });
      }

      logger.error("User erasure failed", { userId, error: err });
      return res.status(500).json({
        success: false,
        message: err instanceof Error ? err.message : "Erasure failed",
      });
    }
  }
);

/**
 * GET /export/erasure-report - Get the current data lifecycle status for this user
 * Shows active holds, pending data classes, and stored erasure receipts.
 */
router.get(
  "/erasure-report",
  authenticateToken,
  async (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    try {
      const report = await erasureReporter.generateReport(req.user.userId);
      return res.status(200).json({ success: true, data: report });
    } catch (err) {
      logger.error("Erasure report generation failed", { error: err, userId: req.user?.userId });
      return res.status(500).json({ success: false, message: "Failed to generate report" });
    }
  }
);

/**
 * GET /export/erasure-receipt/:receiptId - Retrieve and verify a stored erasure receipt
 */
router.get(
  "/erasure-receipt/:receiptId",
  authenticateToken,
  async (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    try {
      const { receiptId } = req.params;
      const receipt = await erasureReporter.getReceipt(receiptId);

      if (!receipt) {
        return res.status(404).json({ success: false, message: "Receipt not found" });
      }

      const valid = erasureReporter.verifyReceipt(receipt);

      return res.status(200).json({
        success: true,
        data: receipt,
        integrity: { valid },
      });
    } catch (err) {
      logger.error("Receipt retrieval failed", { error: err });
      return res.status(500).json({ success: false, message: "Failed to retrieve receipt" });
    }
  }
);
