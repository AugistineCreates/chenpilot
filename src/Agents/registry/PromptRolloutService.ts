import { AppDataSource } from "../../config/Datasource";
import { PromptVersion } from "./PromptVersion.entity";
import { promptVersionService } from "./PromptVersionService";
import { toolRegistry } from "./ToolRegistry";
import { assertMutationAllowed, policyFromEnv, type SignedRevision } from "./PromptChangeControl";
import logger from "../../config/logger";

export class PromptRolloutService {
  private promptRepo = AppDataSource.getRepository(PromptVersion);

  private policy = policyFromEnv();

  /**
   * Validate if a prompt version is compatible with the current system state
   */
  async validateCompatibility(
    promptId: string
  ): Promise<{ valid: boolean; errors: string[] }> {
    const prompt = await this.promptRepo.findOne({ where: { id: promptId } });
    if (!prompt) return { valid: false, errors: ["Prompt not found"] };

    const errors: string[] = [];
    const availableTools = toolRegistry.getToolMetadata().map((t) => t.name);

    if (prompt.compatibility?.requiredTools) {
      for (const tool of prompt.compatibility.requiredTools) {
        if (!availableTools.includes(tool)) {
          errors.push(
            `Required tool '${tool}' is not available in the current registry`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Safe activation with automated policy checks.
   *
   * `revision` carries the signed authorship and approval evidence. It is
   * mandatory in production: `assertMutationAllowed` rejects unversioned
   * activation of live prompt configuration (Issue #665).
   */
  async activateWithPolicy(
    promptId: string,
    rollbackVersionId?: string,
    revision?: SignedRevision
  ): Promise<void> {
    assertMutationAllowed(this.policy, revision);

    const validation = await this.validateCompatibility(promptId);
    if (!validation.valid) {
      throw new Error(
        `Compatibility check failed: ${validation.errors.join(", ")}`
      );
    }

    await this.promptRepo.update(
      { id: promptId },
      {
        isActive: true,
        rollbackVersionId,
        revisionDigest: revision?.digest,
        author: revision?.author,
        authorSignature: revision?.signature,
        approvals: revision?.approvals,
        changeTicket: revision?.changeTicket,
      }
    );

    logger.info("Prompt version activated with rollout policy", {
      promptId,
      rollbackVersionId,
      revisionId: revision?.id,
      digest: revision?.digest,
      author: revision?.author,
      changeTicket: revision?.changeTicket,
      environment: this.policy.environment,
    });
  }

  /**
   * Check if a prompt version should be rolled back based on performance metrics
   */
  async evaluateRollback(promptId: string): Promise<boolean> {
    const prompt = await this.promptRepo.findOne({ where: { id: promptId } });
    if (
      !prompt ||
      !prompt.rollbackVersionId ||
      !prompt.rolloutPolicy?.autoRollbackThreshold
    ) {
      return false;
    }

    const metrics = await promptVersionService.getMetrics(promptId);
    const minExecutions = prompt.rolloutPolicy.minExecutionsBeforePolicy || 20;

    if (metrics.total >= minExecutions) {
      const successRate = metrics.successRate * 100;
      if (successRate < prompt.rolloutPolicy.autoRollbackThreshold) {
        logger.warn(
          "Auto-rolling back prompt version due to poor performance",
          {
            promptId,
            successRate,
            threshold: prompt.rolloutPolicy.autoRollbackThreshold,
            rollbackTo: prompt.rollbackVersionId,
          }
        );

        await this.performRollback(promptId);
        return true;
      }
    }

    return false;
  }

  /**
   * Automated safety rollback. It is triggered by policy rather than by an
   * operator, so it deliberately does not require a new approval quorum —
   * the original activation already carries the change-control evidence.
   */
  private async performRollback(promptId: string): Promise<void> {
    const prompt = await this.promptRepo.findOne({ where: { id: promptId } });
    if (!prompt || !prompt.rollbackVersionId) return;

    await AppDataSource.transaction(async (manager) => {
      await manager.update(
        PromptVersion,
        { id: promptId },
        { isActive: false }
      );
      await manager.update(
        PromptVersion,
        { id: prompt.rollbackVersionId },
        { isActive: true }
      );
    });

    logger.info("Prompt version auto-rolled back under rollout policy", {
      promptId,
      rollbackVersionId: prompt.rollbackVersionId,
      environment: this.policy.environment,
    });
  }
}

export const promptRolloutService = new PromptRolloutService();
