import { Repository, LessThan } from "typeorm";
import AppDataSource from "../config/Datasource";
import { BotSession, BotSessionType, BotPlatform } from "./botSession.entity";
import logger from "../config/logger";

export interface CreateBotSessionParams {
  userId: string;
  platform: BotPlatform;
  sessionType: BotSessionType;
  step: number;
  sessionData: Record<string, unknown>;
  expiresAt?: Date;
}

export interface UpdateBotSessionParams {
  step?: number;
  sessionData?: Record<string, unknown>;
  expiresAt?: Date;
  isActive?: boolean;
}

export interface BotSessionQuery {
  userId?: string;
  platform?: BotPlatform;
  sessionType?: BotSessionType;
  isActive?: boolean;
}

export class BotSessionService {
  private botSessionRepository: Repository<BotSession>;

  constructor() {
    this.botSessionRepository = AppDataSource.getRepository(BotSession);
  }

  /**
   * Create a new bot session
   */
  async create(params: CreateBotSessionParams): Promise<BotSession> {
    try {
      // Check if there's an existing active session for this user/platform/type
      const existingSession = await this.findActiveSession(
        params.userId,
        params.platform,
        params.sessionType
      );

      if (existingSession) {
        // Update existing session instead of creating a new one
        return this.update(existingSession.id, {
          step: params.step,
          sessionData: params.sessionData,
          expiresAt: params.expiresAt,
          isActive: true,
        });
      }

      const session = this.botSessionRepository.create({
        userId: params.userId,
        platform: params.platform,
        sessionType: params.sessionType,
        step: params.step,
        sessionData: params.sessionData,
        expiresAt: params.expiresAt,
        isActive: true,
      });

      const savedSession = await this.botSessionRepository.save(session);
      logger.info("Bot session created", {
        sessionId: savedSession.id,
        userId: params.userId,
        platform: params.platform,
        sessionType: params.sessionType,
      });

      return savedSession;
    } catch (error) {
      logger.error("Error creating bot session", { error, params });
      throw error;
    }
  }

  /**
   * Update an existing bot session
   */
  async update(
    sessionId: string,
    params: UpdateBotSessionParams
  ): Promise<BotSession> {
    try {
      const session = await this.botSessionRepository.findOne({
        where: { id: sessionId },
      });
      if (!session) {
        throw new Error(`Session with id ${sessionId} not found`);
      }

      if (params.step !== undefined) session.step = params.step;
      if (params.sessionData !== undefined)
        session.sessionData = params.sessionData;
      if (params.expiresAt !== undefined) session.expiresAt = params.expiresAt;
      if (params.isActive !== undefined) session.isActive = params.isActive;

      const updatedSession = await this.botSessionRepository.save(session);
      logger.info("Bot session updated", {
        sessionId: updatedSession.id,
        userId: updatedSession.userId,
        platform: updatedSession.platform,
      });

      return updatedSession;
    } catch (error) {
      logger.error("Error updating bot session", { error, sessionId, params });
      throw error;
    }
  }

  /**
   * Find an active session for a user/platform/type
   */
  async findActiveSession(
    userId: string,
    platform: BotPlatform,
    sessionType: BotSessionType
  ): Promise<BotSession | null> {
    try {
      const session = await this.botSessionRepository.findOne({
        where: {
          userId,
          platform,
          sessionType,
          isActive: true,
          expiresAt: undefined as any, // Will be handled by cleanup
        },
        order: { createdAt: "DESC" },
      });

      // Check if session has expired
      if (session && session.expiresAt && session.expiresAt < new Date()) {
        await this.deactivateSession(session.id);
        return null;
      }

      return session || null;
    } catch (error) {
      logger.error("Error finding active bot session", {
        error,
        userId,
        platform,
        sessionType,
      });
      throw error;
    }
  }

  /**
   * Get a session by ID
   */
  async getById(sessionId: string): Promise<BotSession | null> {
    try {
      const session = await this.botSessionRepository.findOne({
        where: { id: sessionId },
      });

      // Check if session has expired
      if (session && session.expiresAt && session.expiresAt < new Date()) {
        await this.deactivateSession(session.id);
        return null;
      }

      return session || null;
    } catch (error) {
      logger.error("Error getting bot session by ID", { error, sessionId });
      throw error;
    }
  }

  /**
   * Deactivate a session
   */
  async deactivateSession(sessionId: string): Promise<void> {
    try {
      await this.botSessionRepository.update(sessionId, { isActive: false });
      logger.info("Bot session deactivated", { sessionId });
    } catch (error) {
      logger.error("Error deactivating bot session", { error, sessionId });
      throw error;
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.botSessionRepository.delete(sessionId);
      logger.info("Bot session deleted", { sessionId });
    } catch (error) {
      logger.error("Error deleting bot session", { error, sessionId });
      throw error;
    }
  }

  /**
   * Query sessions with filters
   */
  async query(query: BotSessionQuery): Promise<BotSession[]> {
    try {
      const where: any = {};
      if (query.userId) where.userId = query.userId;
      if (query.platform) where.platform = query.platform;
      if (query.sessionType) where.sessionType = query.sessionType;
      if (query.isActive !== undefined) where.isActive = query.isActive;

      const sessions = await this.botSessionRepository.find({
        where,
        order: { createdAt: "DESC" },
      });

      // Filter out expired sessions
      const now = new Date();
      const activeSessions = sessions.filter(
        (session) => !session.expiresAt || session.expiresAt > now
      );

      return activeSessions;
    } catch (error) {
      logger.error("Error querying bot sessions", { error, query });
      throw error;
    }
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      const now = new Date();
      const result = await this.botSessionRepository.update(
        {
          expiresAt: LessThan(now),
          isActive: true,
        },
        { isActive: false }
      );

      const affectedCount = result.affected || 0;
      if (affectedCount > 0) {
        logger.info("Expired bot sessions cleaned up", {
          count: affectedCount,
        });
      }

      return affectedCount;
    } catch (error) {
      logger.error("Error cleaning up expired bot sessions", { error });
      throw error;
    }
  }

  /**
   * Deactivate all active sessions for a user
   */
  async deactivateUserSessions(
    userId: string,
    platform?: BotPlatform
  ): Promise<number> {
    try {
      const where: any = { userId, isActive: true };
      if (platform) where.platform = platform;

      const result = await this.botSessionRepository.update(where, {
        isActive: false,
      });
      const affectedCount = result.affected || 0;

      logger.info("User bot sessions deactivated", {
        userId,
        platform,
        count: affectedCount,
      });
      return affectedCount;
    } catch (error) {
      logger.error("Error deactivating user bot sessions", {
        error,
        userId,
        platform,
      });
      throw error;
    }
  }
}
