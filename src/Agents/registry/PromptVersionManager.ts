import { AppDataSource } from "../../config/Datasource";
import { PromptVersion } from "./PromptVersion.entity";
import { promptVersionService } from "./PromptVersionService";
import {
  assertMutationAllowed,
  policyFromEnv,
  type SignedRevision,
} from "./PromptChangeControl";
import logger from "../../config/logger";

/**
 * Every mutating method accepts an optional signed revision.
 *
 * Outside production the revision stays optional so local tooling keeps
 * working, but a supplied revision is always validated. In production
 * `assertMutationAllowed` rejects the call unless a signed, approved revision
 * is provided — direct unversioned mutation of live prompt state is not
 * possible (Issue #665).
 */
export class PromptVersionManager {
  private repo = AppDataSource.getRepository(PromptVersion);

  private policy = policyFromEnv();

  async createVersion(
    name: string,
    type: string,
    content: string,
    version: string,
    weight = 50,
    revision?: SignedRevision
  ): Promise<PromptVersion> {
    assertMutationAllowed(this.policy, revision);

    const prompt = this.repo.create({
      name,
      type,
      content,
      version,
      weight,
      isActive: false,
      author: revision?.author,
      authorSignature: revision?.signature,
      revisionDigest: revision?.digest,
      approvals: revision?.approvals,
      changeTicket: revision?.changeTicket,
      emergencyExpiresAt: revision?.emergencyExpiresAt
        ? new Date(revision.emergencyExpiresAt)
        : undefined,
    });

    logger.info("Prompt version created under change control", {
      revisionId: revision?.id,
      digest: revision?.digest,
      author: revision?.author,
      changeTicket: revision?.changeTicket,
      environment: this.policy.environment,
    });

    return await this.repo.save(prompt);
  }

  async activateVersion(id: string, revision?: SignedRevision): Promise<void> {
    assertMutationAllowed(this.policy, revision);

    await this.repo.update(
      { id },
      {
        isActive: true,
        revisionDigest: revision?.digest,
        author: revision?.author,
        authorSignature: revision?.signature,
        approvals: revision?.approvals,
        changeTicket: revision?.changeTicket,
      }
    );

    logger.info("Prompt version activated under change control", {
      promptId: id,
      revisionId: revision?.id,
      digest: revision?.digest,
      author: revision?.author,
      changeTicket: revision?.changeTicket,
      environment: this.policy.environment,
    });
  }

  async deactivateVersion(id: string, revision?: SignedRevision): Promise<void> {
    assertMutationAllowed(this.policy, revision);

    await this.repo.update({ id }, { isActive: false });

    logger.info("Prompt version deactivated under change control", {
      promptId: id,
      revisionId: revision?.id,
      environment: this.policy.environment,
    });
  }

  async updateWeight(
    id: string,
    weight: number,
    revision?: SignedRevision
  ): Promise<void> {
    assertMutationAllowed(this.policy, revision);

    await this.repo.update({ id }, { weight });

    logger.info("Prompt version weight updated under change control", {
      promptId: id,
      weight,
      revisionId: revision?.id,
      environment: this.policy.environment,
    });
  }

  async listVersions(type?: string): Promise<PromptVersion[]> {
    const where = type ? { type } : {};
    const versions = await this.repo.find({ where });
    return versions;
  }

  async compareVersions(id1: string, id2: string) {
    const [metrics1, metrics2] = await Promise.all([
      promptVersionService.getMetrics(id1),
      promptVersionService.getMetrics(id2),
    ]);

    return {
      version1: { id: id1, ...metrics1 },
      version2: { id: id2, ...metrics2 },
      winner:
        metrics1.successRate > metrics2.successRate ? "version1" : "version2",
    };
  }
}

export const promptVersionManager = new PromptVersionManager();
