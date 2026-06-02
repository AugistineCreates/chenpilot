import AppDataSource from "../../config/Datasource";
import { IndexerCursor } from "./indexerCursor.entity";
import { logInfo, logError } from "../../config/logger";

/**
 * Durable cursor store backed by PostgreSQL.
 * Provides atomic upsert so concurrent restarts never lose progress.
 */
export class CursorStore {
  private get repo() {
    return AppDataSource.getRepository(IndexerCursor);
  }

  async get(streamId: string): Promise<IndexerCursor | null> {
    return this.repo.findOneBy({ streamId });
  }

  /**
   * Atomically advance the cursor.  Uses INSERT … ON CONFLICT DO UPDATE
   * so the write is safe under concurrent access.
   */
  async advance(
    streamId: string,
    lastLedger: number,
    lastEventId?: string,
    lastLedgerClosedAt?: string,
    meta?: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(IndexerCursor)
        .values({ streamId, lastLedger, lastEventId, lastLedgerClosedAt, meta })
        .orUpdate(
          ["lastLedger", "lastEventId", "lastLedgerClosedAt", "meta", "updatedAt"],
          ["streamId"]
        )
        .execute();

      logInfo("[CursorStore] advanced", { streamId, lastLedger, lastEventId });
    } catch (err) {
      logError("[CursorStore] failed to advance cursor", err, { streamId });
      throw err;
    }
  }

  async reset(streamId: string, toLedger: number): Promise<void> {
    await this.repo.upsert(
      { streamId, lastLedger: toLedger, lastEventId: undefined },
      ["streamId"]
    );
    logInfo("[CursorStore] reset", { streamId, toLedger });
  }
}

export const cursorStore = new CursorStore();
