import { DataSource, EntityManager } from "typeorm";
import logger from "../config/logger";
import {
  decrypt,
  encrypt,
  getActiveEncryptionKeyId,
  inspectCiphertext,
} from "../utils/encryption";
import { recordKeyRotationBatch } from "../observability/keyRotationMetrics";

export interface KeyRotationCheckpoint {
  id: string;
  sourceKeyId: string;
  targetKeyId: string;
  cursor: string | null;
  status: "running" | "completed" | "failed";
  processedCount: number;
  rotatedCount: number;
  skippedCount: number;
  remainingReferences: number | null;
}

export interface KeyRotationBatchResult extends KeyRotationCheckpoint {
  batchProcessed: number;
  batchRotated: number;
  batchSkipped: number;
}

interface EncryptedUserRow {
  id: string;
  encryptedPrivateKey: string;
}

export class EncryptionKeyRotationService {
  public constructor(private readonly dataSource: DataSource) {}

  public async rotateBatch(
    sourceKeyId: string,
    targetKeyId: string,
    batchSize = 100
  ): Promise<KeyRotationBatchResult> {
    if (sourceKeyId === targetKeyId) {
      throw new Error("Source and target encryption keys must differ");
    }
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
      throw new Error(
        "Rotation batch size must be an integer between 1 and 1000"
      );
    }
    if (getActiveEncryptionKeyId() !== targetKeyId) {
      throw new Error(
        "Target key must be the active encryption key before rotation starts"
      );
    }

    recordKeyRotationBatch("started");
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        // Serializes workers for the same key pair while allowing unrelated
        // rotations to proceed. The checkpoint and data updates commit together.
        await manager.query(
          "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
          [sourceKeyId, targetKeyId]
        );
        const checkpoint = await this.lockCheckpoint(
          manager,
          sourceKeyId,
          targetKeyId
        );
        if (checkpoint.status === "completed") {
          return this.result(checkpoint, 0, 0, 0);
        }

        const rows: EncryptedUserRow[] = await manager.query(
          `SELECT id, "encryptedPrivateKey"
             FROM "user"
            WHERE "encryptedPrivateKey" IS NOT NULL
              AND "encryptedPrivateKey" <> ''
              AND ($1::uuid IS NULL OR id > $1::uuid)
            ORDER BY id ASC
            LIMIT $2`,
          [checkpoint.cursor, batchSize]
        );

        let rotated = 0;
        let skipped = 0;
        for (const row of rows) {
          const keyId = inspectCiphertext(row.encryptedPrivateKey).keyId;
          if (keyId === sourceKeyId) {
            const replacement = encrypt(decrypt(row.encryptedPrivateKey));
            const updated: Array<{ id: string }> = await manager.query(
              `UPDATE "user"
                  SET "encryptedPrivateKey" = $1
                WHERE id = $2 AND "encryptedPrivateKey" = $3
                RETURNING id`,
              [replacement, row.id, row.encryptedPrivateKey]
            );
            if (updated.length === 1) rotated += 1;
            else skipped += 1;
          } else {
            skipped += 1;
          }
        }

        const processed = rows.length;
        const cursor = rows[rows.length - 1]?.id || checkpoint.cursor;
        let remaining: number | null = null;
        let status: KeyRotationCheckpoint["status"] = "running";
        let nextCursor = cursor;
        if (rows.length === 0) {
          remaining = await this.countReferencesWithManager(
            manager,
            sourceKeyId
          );
          status = remaining === 0 ? "completed" : "running";
          // A conditional-update conflict can leave an older row behind. A new
          // pass makes retry deterministic without losing concurrent writes.
          nextCursor = remaining === 0 ? cursor : null;
        }

        const updatedRows: KeyRotationCheckpoint[] = await manager.query(
          `UPDATE encryption_key_rotation
              SET cursor = $2,
                  status = $3,
                  "processedCount" = "processedCount" + $4,
                  "rotatedCount" = "rotatedCount" + $5,
                  "skippedCount" = "skippedCount" + $6,
                  "remainingReferences" = $7,
                  "lastError" = NULL,
                  "updatedAt" = now(),
                  "completedAt" = CASE WHEN $3 = 'completed' THEN now() ELSE NULL END
            WHERE id = $1
            RETURNING *`,
          [
            checkpoint.id,
            nextCursor,
            status,
            processed,
            rotated,
            skipped,
            remaining,
          ]
        );
        return this.result(updatedRows[0], processed, rotated, skipped);
      });

      recordKeyRotationBatch("completed", {
        processed: result.batchProcessed,
        rotated: result.batchRotated,
        skipped: result.batchSkipped,
        remaining: result.remainingReferences,
      });
      logger.info("Encryption key rotation batch completed", {
        rotationId: result.id,
        sourceKeyId,
        targetKeyId,
        processed: result.batchProcessed,
        rotated: result.batchRotated,
        skipped: result.batchSkipped,
        remainingReferences: result.remainingReferences,
        status: result.status,
      });
      return result;
    } catch (error) {
      recordKeyRotationBatch("failed");
      // Failure state is best-effort observability. The data batch has already
      // rolled back; this update never advances the durable cursor.
      await this.dataSource
        .query(
          `UPDATE encryption_key_rotation
            SET status = 'failed', "lastError" = 'batch failed', "updatedAt" = now()
          WHERE "sourceKeyId" = $1 AND "targetKeyId" = $2`,
          [sourceKeyId, targetKeyId]
        )
        .catch(() => undefined);
      logger.error("Encryption key rotation batch failed", {
        sourceKeyId,
        targetKeyId,
        error: error instanceof Error ? error.message : "unknown error",
      });
      throw error;
    }
  }

  public async countReferences(keyId: string): Promise<number> {
    return this.dataSource.transaction((manager) =>
      this.countReferencesWithManager(manager, keyId)
    );
  }

  public async assertKeyCanBeRetired(keyId: string): Promise<void> {
    if (keyId === getActiveEncryptionKeyId()) {
      throw new Error("The active encryption key cannot be retired");
    }
    const references = await this.countReferences(keyId);
    if (references > 0) {
      throw new Error(
        `Encryption key '${keyId}' is still referenced by ${references} ciphertext record(s)`
      );
    }
  }

  public async getCheckpoint(
    sourceKeyId: string,
    targetKeyId: string
  ): Promise<KeyRotationCheckpoint | null> {
    const rows: KeyRotationCheckpoint[] = await this.dataSource.query(
      `SELECT * FROM encryption_key_rotation
        WHERE "sourceKeyId" = $1 AND "targetKeyId" = $2`,
      [sourceKeyId, targetKeyId]
    );
    return rows[0] || null;
  }

  private async lockCheckpoint(
    manager: EntityManager,
    sourceKeyId: string,
    targetKeyId: string
  ): Promise<KeyRotationCheckpoint> {
    await manager.query(
      `INSERT INTO encryption_key_rotation ("sourceKeyId", "targetKeyId")
       VALUES ($1, $2)
       ON CONFLICT ("sourceKeyId", "targetKeyId") DO NOTHING`,
      [sourceKeyId, targetKeyId]
    );
    const rows: KeyRotationCheckpoint[] = await manager.query(
      `SELECT * FROM encryption_key_rotation
        WHERE "sourceKeyId" = $1 AND "targetKeyId" = $2
        FOR UPDATE`,
      [sourceKeyId, targetKeyId]
    );
    return rows[0];
  }

  private async countReferencesWithManager(
    manager: EntityManager,
    keyId: string
  ): Promise<number> {
    const rows: Array<{ encryptedPrivateKey: string }> = await manager.query(
      `SELECT "encryptedPrivateKey" FROM "user"
        WHERE "encryptedPrivateKey" IS NOT NULL AND "encryptedPrivateKey" <> ''`
    );
    return rows.reduce((count, row) => {
      const metadata = inspectCiphertext(row.encryptedPrivateKey);
      // Retirement checks validate every envelope as well as counting its
      // declared key. Corrupt or unauthenticated metadata therefore blocks a
      // cutover instead of hiding a reference to a key being removed.
      decrypt(row.encryptedPrivateKey);
      return count + (metadata.keyId === keyId ? 1 : 0);
    }, 0);
  }

  private result(
    checkpoint: KeyRotationCheckpoint,
    batchProcessed: number,
    batchRotated: number,
    batchSkipped: number
  ): KeyRotationBatchResult {
    return { ...checkpoint, batchProcessed, batchRotated, batchSkipped };
  }
}
