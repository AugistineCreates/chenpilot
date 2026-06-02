import { Repository } from "typeorm";
import { User } from "../Auth/user.entity";
import { Contact } from "../Contacts/contact.entity";
import { RefreshToken } from "../Auth/refreshToken.entity";
import AppDataSource from "../config/Datasource";
import { memoryStore } from "../Agents/memory/memory";
import logger from "../config/logger";
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";

export interface UserProfileExport {
  exportMetadata: {
    exportDate: string;
    exportVersion: string;
    userId: string;
  };
  profile: {
    id: string;
    name: string;
    email?: string;
    address: string;
    tokenType: string;
    role: string;
    isDeployed: boolean;
    isFunded: boolean;
    isEmailVerified: boolean;
    createdAt: string;
    updatedAt: string;
  };
  contacts: Array<{
    id: string;
    name: string;
    address: string;
    tokenType: string;
    createdAt: string;
    updatedAt: string;
  }>;
  conversationHistory: {
    totalEntries: number;
    entries: string[];
  };
  sessions: Array<{
    id: string;
    createdAt: string;
    expiresAt: string;
    isRevoked: boolean;
    revokedReason?: string;
  }>;
  statistics: {
    totalContacts: number;
    totalSessions: number;
    totalConversationEntries: number;
    accountAge: string;
  };
}

export class DataExportService {
  private userRepository: Repository<User>;
  private contactRepository: Repository<Contact>;
  private refreshTokenRepository: Repository<RefreshToken>;

  constructor() {
    this.userRepository = AppDataSource.getRepository(User);
    this.contactRepository = AppDataSource.getRepository(Contact);
    this.refreshTokenRepository = AppDataSource.getRepository(RefreshToken);
  }

  async exportUserData(userId: string): Promise<UserProfileExport> {
    logger.info("Starting user data export", { userId });

    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        throw new Error("User not found");
      }

      const contacts = await this.getContactsByUserId(userId);
      const conversationHistory = this.getConversationHistory(userId);
      const sessions = await this.getUserSessions(userId);

      const accountAge = this.calculateAccountAge(user.createdAt);

      const exportData: UserProfileExport = {
        exportMetadata: {
          exportDate: new Date().toISOString(),
          exportVersion: "1.0.0",
          userId: user.id,
        },
        profile: {
          id: user.id,
          name: user.name,
          email: user.email,
          address: user.address,
          tokenType: user.tokenType,
          role: user.role,
          isDeployed: user.isDeployed,
          isFunded: user.isFunded,
          isEmailVerified: user.isEmailVerified,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        },
        contacts: contacts.map((contact) => ({
          id: contact.id,
          name: contact.name,
          address: contact.address,
          tokenType: contact.tokenType,
          createdAt: contact.createdAt.toISOString(),
          updatedAt: contact.updatedAt.toISOString(),
        })),
        conversationHistory: {
          totalEntries: conversationHistory.length,
          entries: conversationHistory,
        },
        sessions: sessions.map((session) => ({
          id: session.id,
          createdAt: session.createdAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          isRevoked: session.isRevoked,
          revokedReason: session.revokedReason,
        })),
        statistics: {
          totalContacts: contacts.length,
          totalSessions: sessions.length,
          totalConversationEntries: conversationHistory.length,
          accountAge,
        },
      };

      logger.info("User data export completed successfully", {
        userId,
        contactsCount: contacts.length,
        conversationEntriesCount: conversationHistory.length,
        sessionsCount: sessions.length,
      });

      await auditLogService.log({
        userId,
        action: AuditAction.DATA_EXPORT,
        severity: AuditSeverity.INFO,
        resource: "profile_export",
        metadata: {
          exportVersion: exportData.exportMetadata.exportVersion,
          dataCategories: {
            profile: true,
            contacts: contacts.length > 0,
            conversationHistory: conversationHistory.length > 0,
            sessions: sessions.length > 0,
          },
          counts: {
            contacts: contacts.length,
            conversationEntries: conversationHistory.length,
            sessions: sessions.length,
          },
        },
      });

      return exportData;
    } catch (error) {
      logger.error("Failed to export user data", { userId, error });
      throw error;
    }
  }

  private async getContactsByUserId(userId: string): Promise<Contact[]> {
    return this.contactRepository.find({
      where: { userId },
      order: { createdAt: "DESC" },
    });
  }

  private getConversationHistory(userId: string): string[] {
    return memoryStore.get(userId);
  }

  private async getUserSessions(userId: string): Promise<RefreshToken[]> {
    return this.refreshTokenRepository.find({
      where: { userId },
      order: { createdAt: "DESC" },
    });
  }

  private calculateAccountAge(createdAt: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - createdAt.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return "Less than 1 day";
    } else if (diffDays === 1) {
      return "1 day";
    } else if (diffDays < 30) {
      return `${diffDays} days`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return months === 1 ? "1 month" : `${months} months`;
    } else {
      const years = Math.floor(diffDays / 365);
      const remainingMonths = Math.floor((diffDays % 365) / 30);
      if (remainingMonths === 0) {
        return years === 1 ? "1 year" : `${years} years`;
      }
      return `${years} year${years > 1 ? "s" : ""} and ${remainingMonths} month${remainingMonths > 1 ? "s" : ""}`;
    }
  }

  async exportUserDataAsJSON(userId: string): Promise<string> {
    const exportData = await this.exportUserData(userId);
    return JSON.stringify(exportData, null, 2);
  }

  async exportUserDataAsBuffer(userId: string): Promise<Buffer> {
    const jsonString = await this.exportUserDataAsJSON(userId);
    return Buffer.from(jsonString, "utf-8");
  }
}
