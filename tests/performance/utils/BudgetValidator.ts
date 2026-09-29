import * as fs from "fs";
import * as path from "path";
import { BUDGET_METADATA } from "../config/performanceBaselines";

export interface BudgetValidationResult {
  valid: boolean;
  version: string;
  changelogFound: boolean;
  hasEntryForCurrentVersion: boolean;
  errors: string[];
}

export class BudgetValidator {
  private changelogPath: string;

  constructor(changelogPath?: string) {
    this.changelogPath =
      changelogPath || path.resolve(__dirname, "../BUDGET_CHANGELOG.md");
  }

  /**
   * Validates that the budget changelog exists and contains entries for the current budget version
   */
  validate(): BudgetValidationResult {
    const errors: string[] = [];
    const version = BUDGET_METADATA.version;

    if (!fs.existsSync(this.changelogPath)) {
      return {
        valid: false,
        version,
        changelogFound: false,
        hasEntryForCurrentVersion: false,
        errors: [`Budget changelog file not found at ${this.changelogPath}`],
      };
    }

    const content = fs.readFileSync(this.changelogPath, "utf8");
    const hasEntryForCurrentVersion = content.includes(`[${version}]`);

    if (!hasEntryForCurrentVersion) {
      errors.push(
        `Budget changelog is missing an entry for current budget version [${version}]. All budget changes require documented rationale.`
      );
    }

    // Check required section headers
    if (
      !content.includes("## Governance Policy") ||
      !content.includes("## Changelog Entries")
    ) {
      errors.push(
        "Budget changelog must contain 'Governance Policy' and 'Changelog Entries' sections."
      );
    }

    return {
      valid: errors.length === 0,
      version,
      changelogFound: true,
      hasEntryForCurrentVersion,
      errors,
    };
  }
}

export const budgetValidator = new BudgetValidator();
