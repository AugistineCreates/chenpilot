import AppDataSource from "../config/Datasource";
import { IPBlacklist, BlacklistReason } from "./ipBlacklist.entity";
import logger from "../config/logger";

interface AddToBlacklistOptions {
  reason: BlacklistReason;
  description?: string;
  expiresAt?: Date;
  addedBy?: string;
  metadata?: Record<string, unknown>;
}

interface BlacklistSearchOptions {
  limit?: number;
  offset?: number;
  activeOnly?: boolean;
  reason?: BlacklistReason;
}

/**
 * Service for managing IP address blacklist
 */
class IPBlacklistService {
  private repository = AppDataSource.getRepository(IPBlacklist);

  /**
   * Check if an IP address is blacklisted
   */
  async isBlacklisted(ipAddress: string): Promise<boolean> {
    try {
      const entry = await this.repository.findOne({
        where: {
          ipAddress: this.normalizeIP(ipAddress),
          isActive: true,
        },
      });

      if (!entry) {
        return false;
      }

      // Check if entry has expired
      if (entry.expiresAt && new Date() > entry.expiresAt) {
        // Automatically deactivate expired entry
        await this.repository.update(entry.id, { isActive: false });
        return false;
      }

      // Update last blocked time
      await this.repository.update(entry.id, {
        blockCount: entry.blockCount + 1,
        lastBlockedAt: new Date(),
      });

      return true;
    } catch (error) {
      logger.error("Error checking IP blacklist", { ipAddress, error });
      return false;
    }
  }

  /**
   * Get blacklist entry for an IP
   */
  async getBlacklistEntry(ipAddress: string): Promise<IPBlacklist | null> {
    try {
      const entry = await this.repository.findOne({
        where: {
          ipAddress: this.normalizeIP(ipAddress),
        },
      });

      return entry || null;
    } catch (error) {
      logger.error("Error fetching blacklist entry", { ipAddress, error });
      return null;
    }
  }

  /**
   * Add an IP address to the blacklist
   */
  async addToBlacklist(
    ipAddress: string,
    options: AddToBlacklistOptions
  ): Promise<IPBlacklist> {
    try {
      const normalizedIP = this.normalizeIP(ipAddress);

      // Check if already exists
      let entry = await this.repository.findOne({
        where: { ipAddress: normalizedIP },
      });

      if (entry) {
        // Update existing entry
        entry.isActive = true;
        entry.reason = options.reason;
        entry.description = options.description;
        entry.expiresAt = options.expiresAt;
        entry.addedBy = options.addedBy;
        entry.metadata = options.metadata;
        entry = await this.repository.save(entry);

        logger.info("Updated IP blacklist entry", {
          ipAddress: normalizedIP,
          reason: options.reason,
        });
      } else {
        // Create new entry
        entry = this.repository.create({
          ipAddress: normalizedIP,
          reason: options.reason,
          description: options.description,
          expiresAt: options.expiresAt,
          addedBy: options.addedBy,
          metadata: options.metadata,
          isActive: true,
          blockCount: 0,
        });

        entry = await this.repository.save(entry);

        logger.info("Added IP to blacklist", {
          ipAddress: normalizedIP,
          reason: options.reason,
        });
      }

      return entry;
    } catch (error) {
      logger.error("Error adding IP to blacklist", {
        ipAddress,
        error,
      });
      throw error;
    }
  }

  /**
   * Remove an IP address from the blacklist
   */
  async removeFromBlacklist(ipAddress: string): Promise<boolean> {
    try {
      const normalizedIP = this.normalizeIP(ipAddress);
      const result = await this.repository.update(
        { ipAddress: normalizedIP },
        { isActive: false }
      );

      if (result.affected && result.affected > 0) {
        logger.info("Removed IP from blacklist", { ipAddress: normalizedIP });
        return true;
      }

      return false;
    } catch (error) {
      logger.error("Error removing IP from blacklist", {
        ipAddress,
        error,
      });
      throw error;
    }
  }

  /**
   * List blacklisted IPs
   */
  async listBlacklist(
    options: BlacklistSearchOptions = {}
  ): Promise<{ entries: IPBlacklist[]; total: number }> {
    try {
      const { limit = 50, offset = 0, activeOnly = true, reason } = options;

      const query = this.repository.createQueryBuilder("blacklist");

      if (activeOnly) {
        query.andWhere("blacklist.isActive = :isActive", { isActive: true });
      }

      if (reason) {
        query.andWhere("blacklist.reason = :reason", { reason });
      }

      const [entries, total] = await query
        .orderBy("blacklist.createdAt", "DESC")
        .limit(limit)
        .offset(offset)
        .getManyAndCount();

      return { entries, total };
    } catch (error) {
      logger.error("Error listing blacklist", { error });
      throw error;
    }
  }

  /**
   * Bulk add IPs to blacklist
   */
  async bulkAddToBlacklist(
    ips: Array<{ ip: string; options: AddToBlacklistOptions }>
  ): Promise<IPBlacklist[]> {
    try {
      const entries: IPBlacklist[] = [];

      for (const { ip, options } of ips) {
        const entry = await this.addToBlacklist(ip, options);
        entries.push(entry);
      }

      logger.info("Bulk added IPs to blacklist", { count: entries.length });
      return entries;
    } catch (error) {
      logger.error("Error bulk adding IPs to blacklist", { error });
      throw error;
    }
  }

  /**
   * Auto-expire old blacklist entries
   */
  async cleanupExpiredEntries(): Promise<number> {
    try {
      const result = await this.repository
        .createQueryBuilder()
        .update(IPBlacklist)
        .set({ isActive: false })
        .where("expiresAt < :now", { now: new Date() })
        .andWhere("isActive = true")
        .execute();

      const count = result.affected || 0;
      if (count > 0) {
        logger.info("Cleaned up expired blacklist entries", { count });
      }

      return count;
    } catch (error) {
      logger.error("Error cleaning up expired entries", { error });
      throw error;
    }
  }

  /**
   * Get statistics about blacklist
   */
  async getStatistics(): Promise<{
    totalActive: number;
    totalInactive: number;
    byReason: Record<string, number>;
    mostRecent: IPBlacklist[];
    mostBlocked: IPBlacklist[];
  }> {
    try {
      const totalActive = await this.repository.count({
        where: { isActive: true },
      });

      const totalInactive = await this.repository.count({
        where: { isActive: false },
      });

      // Get breakdown by reason
      const byReasonData = await this.repository
        .createQueryBuilder()
        .select("blacklist.reason", "reason")
        .addSelect("COUNT(*)", "count")
        .where("blacklist.isActive = true")
        .groupBy("blacklist.reason")
        .getRawMany();

      const byReason: Record<string, number> = {};
      for (const row of byReasonData) {
        byReason[row.reason] = parseInt(row.count);
      }

      // Most recent
      const mostRecent = await this.repository.find({
        where: { isActive: true },
        order: { createdAt: "DESC" },
        take: 10,
      });

      // Most blocked
      const mostBlocked = await this.repository.find({
        where: { isActive: true },
        order: { blockCount: "DESC" },
        take: 10,
      });

      return {
        totalActive,
        totalInactive,
        byReason,
        mostRecent,
        mostBlocked,
      };
    } catch (error) {
      logger.error("Error getting blacklist statistics", { error });
      throw error;
    }
  }

  /**
   * Normalize IP address (handle IPv6)
   */
  private normalizeIP(ip: string): string {
    // Remove port if present
    let normalized = ip.split(":")[0];

    // Handle IPv6 localhost
    if (normalized === "::1") {
      normalized = "127.0.0.1";
    }

    // Handle IPv6 mapped IPv4
    if (normalized.includes("::ffff:")) {
      normalized = normalized.replace("::ffff:", "");
    }

    return normalized.trim();
  }
}

export const ipBlacklistService = new IPBlacklistService();
export default IPBlacklistService;
