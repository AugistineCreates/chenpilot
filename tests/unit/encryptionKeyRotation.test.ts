import { DataSource } from "typeorm";
import { EncryptionKeyRotationService } from "../../src/Security/encryptionKeyRotation.service";
import { encrypt, inspectCiphertext } from "../../src/utils/encryption";

const OLD_KEY = "44".repeat(32);
const NEW_KEY = "55".repeat(32);

interface RecordRow {
  id: string;
  encryptedPrivateKey: string;
}

class FakeRotationDatabase {
  public records: RecordRow[];
  private checkpoint: Record<string, unknown> | null = null;
  public failNextAccountUpdate = false;
  private transactionTail: Promise<void> = Promise.resolve();

  public constructor(records: RecordRow[]) {
    this.records = records;
  }

  public asDataSource(): DataSource {
    return {
      transaction: async (
        work: (manager: {
          query: (sql: string, values?: unknown[]) => Promise<unknown[]>;
        }) => Promise<unknown>
      ) => {
        const previous = this.transactionTail;
        let release!: () => void;
        this.transactionTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        const recordsSnapshot = this.records.map((row) => ({ ...row }));
        const checkpointSnapshot = this.checkpoint
          ? { ...this.checkpoint }
          : null;
        try {
          return await work({
            query: (sql, values = []) => this.query(sql, values),
          });
        } catch (error) {
          this.records = recordsSnapshot;
          this.checkpoint = checkpointSnapshot;
          throw error;
        } finally {
          release();
        }
      },
      query: (sql: string, values: unknown[] = []) => this.query(sql, values),
    } as unknown as DataSource;
  }

  private async query(sql: string, values: unknown[]): Promise<unknown[]> {
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("INSERT INTO encryption_key_rotation")) {
      if (!this.checkpoint) {
        this.checkpoint = {
          id: "99999999-9999-4999-8999-999999999999",
          sourceKeyId: values[0],
          targetKeyId: values[1],
          cursor: null,
          status: "running",
          processedCount: 0,
          rotatedCount: 0,
          skippedCount: 0,
          remainingReferences: null,
        };
      }
      return [];
    }
    if (sql.includes("SELECT * FROM encryption_key_rotation")) {
      if (!this.checkpoint) return [];
      return this.checkpoint.sourceKeyId === values[0] &&
        this.checkpoint.targetKeyId === values[1]
        ? [{ ...this.checkpoint }]
        : [];
    }
    if (sql.includes('SELECT id, "encryptedPrivateKey"')) {
      const cursor = values[0] as string | null;
      const limit = values[1] as number;
      return this.records
        .filter((row) => !cursor || row.id > cursor)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit)
        .map((row) => ({ ...row }));
    }
    if (sql.includes('UPDATE "user"')) {
      if (this.failNextAccountUpdate) {
        this.failNextAccountUpdate = false;
        throw new Error("simulated interruption");
      }
      const [replacement, id, expected] = values as string[];
      const row = this.records.find((candidate) => candidate.id === id);
      if (!row || row.encryptedPrivateKey !== expected) return [];
      row.encryptedPrivateKey = replacement;
      return [{ id }];
    }
    if (sql.includes("UPDATE encryption_key_rotation")) {
      if (!this.checkpoint) throw new Error("missing checkpoint");
      this.checkpoint = {
        ...this.checkpoint,
        cursor: values[1],
        status: values[2],
        processedCount:
          Number(this.checkpoint.processedCount) + Number(values[3]),
        rotatedCount: Number(this.checkpoint.rotatedCount) + Number(values[4]),
        skippedCount: Number(this.checkpoint.skippedCount) + Number(values[5]),
        remainingReferences: values[6],
      };
      return [{ ...this.checkpoint }];
    }
    if (sql.includes('SELECT "encryptedPrivateKey" FROM "user"')) {
      return this.records.map(({ encryptedPrivateKey }) => ({
        encryptedPrivateKey,
      }));
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
}

describe("EncryptionKeyRotationService", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEYS_JSON = JSON.stringify({
      old: OLD_KEY,
      next: NEW_KEY,
    });
    process.env.ENCRYPTION_ACTIVE_KEY_ID = "old";
    delete process.env.ENCRYPTION_REVOKED_KEY_IDS;
  });

  function encryptedRows(): RecordRow[] {
    return [
      {
        id: "00000000-0000-4000-8000-000000000001",
        encryptedPrivateKey: encrypt("one"),
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        encryptedPrivateKey: encrypt("two"),
      },
    ];
  }

  it("rolls back an interrupted batch, resumes, and is idempotent", async () => {
    const database = new FakeRotationDatabase(encryptedRows());
    const before = database.records.map((row) => row.encryptedPrivateKey);
    process.env.ENCRYPTION_ACTIVE_KEY_ID = "next";
    const service = new EncryptionKeyRotationService(database.asDataSource());

    database.failNextAccountUpdate = true;
    await expect(service.rotateBatch("old", "next", 1)).rejects.toThrow(
      "simulated interruption"
    );
    expect(database.records.map((row) => row.encryptedPrivateKey)).toEqual(
      before
    );

    await service.rotateBatch("old", "next", 1);
    await service.rotateBatch("old", "next", 1);
    const completed = await service.rotateBatch("old", "next", 1);
    expect(completed.status).toBe("completed");
    expect(completed.rotatedCount).toBe(2);
    expect(
      database.records.every(
        (row) => inspectCiphertext(row.encryptedPrivateKey).keyId === "next"
      )
    ).toBe(true);

    const retry = await service.rotateBatch("old", "next", 1);
    expect(retry.rotatedCount).toBe(2);
    await expect(service.assertKeyCanBeRetired("old")).resolves.toBeUndefined();
  });

  it("serializes concurrent workers without rotating a record twice", async () => {
    const database = new FakeRotationDatabase(encryptedRows());
    process.env.ENCRYPTION_ACTIVE_KEY_ID = "next";
    const service = new EncryptionKeyRotationService(database.asDataSource());

    await Promise.all([
      service.rotateBatch("old", "next", 1),
      service.rotateBatch("old", "next", 1),
    ]);
    const final = await service.rotateBatch("old", "next", 1);
    expect(final.status).toBe("completed");
    expect(final.rotatedCount).toBe(2);
  });

  it("blocks unsafe retirement and rejects invalid rotation boundaries", async () => {
    const database = new FakeRotationDatabase(encryptedRows());
    process.env.ENCRYPTION_ACTIVE_KEY_ID = "next";
    const service = new EncryptionKeyRotationService(database.asDataSource());

    await expect(service.assertKeyCanBeRetired("old")).rejects.toThrow(
      "still referenced by 2"
    );
    await expect(service.assertKeyCanBeRetired("next")).rejects.toThrow(
      "active encryption key"
    );
    await expect(service.rotateBatch("old", "old", 1)).rejects.toThrow(
      "must differ"
    );
    await expect(service.rotateBatch("old", "next", 0)).rejects.toThrow(
      "between 1 and 1000"
    );
  });
});
