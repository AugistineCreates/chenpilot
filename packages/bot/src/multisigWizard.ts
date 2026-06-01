import {
  Workflow,
  WorkflowResult,
  WorkflowState,
} from "./services/workflowService";

export interface MultisigConfig {
  threshold: number;
  signers: Array<{
    key: string;
    weight: number;
  }>;
  masterKey: string;
}

export class MultisigWizard implements Workflow {
  public type = "multisig_wizard";
  private readonly MAX_SIGNERS = 20;
  private readonly MAX_THRESHOLD = 20;
  private readonly MIN_THRESHOLD = 1;

  /**
   * Policy check for multisig wizard
   */
  async checkPolicy(
    userId: string,
    platform: "discord" | "telegram"
  ): Promise<{ allowed: boolean; message?: string }> {
    // Check if user has sufficient risk tolerance for multisig operations
    const { botWorkflowManager } = await import("./services/workflowService");
    const policy = await botWorkflowManager.checkRiskPolicy(userId, "medium");

    if (!policy.allowed) {
      return {
        allowed: false,
        message: `⚠️ Your current risk tolerance is set to '${policy.reason?.split("(")[1]?.split(")")[0] || "low"}', which prevents starting a multisig setup on ${platform}. Please update your preferences on the dashboard.`,
      };
    }
    return { allowed: true };
  }

  /**
   * Start a new wizard session for a user
   */
  start(userId: string, platform: "discord" | "telegram"): WorkflowResult {
    const initialState = {
      workflowId: `msig_${Date.now()}`,
      userId,
      platform,
      type: this.type,
      step: 1,
      data: { signers: [] },
      isComplete: false,
    };

    return {
      message: this.getStepMessage(initialState),
      nextStep: 1,
      data: initialState.data,
    };
  }

  /**
   * Process user input in the wizard
   */
  async processInput(
    state: WorkflowState,
    input: string
  ): Promise<WorkflowResult> {
    // Process based on current step
    switch (state.step) {
      case 1:
        return this.handleStep1(state, input);
      case 2:
        return this.handleStep2(state, input);
      case 3:
        return this.handleStep3(state, input);
      case 4:
        return this.handleStep4(state, input);
      case 5:
        return this.handleStep5(state, input);
      default:
        return this.completeWizard(state);
    }
  }

  /**
   * Step 1: Ask for threshold
   */
  private handleStep1(state: WorkflowState, input: string): WorkflowResult {
    const threshold = parseInt(input);

    if (
      isNaN(threshold) ||
      threshold < this.MIN_THRESHOLD ||
      threshold > this.MAX_THRESHOLD
    ) {
      return {
        message: `⚠️ Invalid threshold. Please enter a number between ${this.MIN_THRESHOLD} and ${this.MAX_THRESHOLD}.`,
      };
    }

    state.data.threshold = threshold;
    state.step = 2;

    return {
      message: this.getStepMessage(state),
      nextStep: 2,
      data: state.data,
    };
  }

  /**
   * Step 2: Ask for number of signers
   */
  private handleStep2(state: WorkflowState, input: string): WorkflowResult {
    const numSigners = parseInt(input);

    if (isNaN(numSigners) || numSigners < 1 || numSigners > this.MAX_SIGNERS) {
      return {
        message: `⚠️ Invalid number of signers. Please enter a number between 1 and ${this.MAX_SIGNERS}.`,
      };
    }

    if (numSigners < state.data.threshold!) {
      return {
        message: `⚠️ Number of signers must be at least equal to the threshold (${state.data.threshold}).`,
      };
    }

    state.data.signers = [];
    state.step = 3;

    return {
      message: this.getStepMessage(state),
      nextStep: 3,
      data: state.data,
    };
  }

  /**
   * Step 3: Collect signer keys
   */
  private handleStep3(state: WorkflowState, input: string): WorkflowResult {
    const signers = state.data.signers as Array<{
      key: string;
      weight: number;
    }>;

    // Check if we're adding a signer or moving to next step
    if (input.toLowerCase() === "done" || input.toLowerCase() === "next") {
      if (signers.length === 0) {
        return {
          message:
            "⚠️ You need to add at least one signer. Enter a public key or type 'cancel' to abort.",
        };
      }
      state.step = 4;
      return {
        message: this.getStepMessage(state),
        nextStep: 4,
        data: state.data,
      };
    }

    // Validate Stellar public key
    if (!this.isValidPublicKey(input)) {
      return {
        message:
          "⚠️ Invalid Stellar public key. Please enter a valid public key (starts with 'G').",
      };
    }

    // Check for duplicates
    if (signers.some((s) => s.key === input)) {
      return {
        message:
          "⚠️ This signer has already been added. Please enter a different key.",
      };
    }

    // Add signer with default weight
    signers.push({
      key: input,
      weight: 1,
    });

    state.step = 3; // Stay on step 3 to collect more signers

    const message = `✅ Signer ${signers.length} added: \`${input.slice(0, 8)}...\`\n\n`;

    if (signers.length < state.data.threshold!) {
      return {
        message:
          message +
          `You need at least ${state.data.threshold} signers total. Add another key or type 'done' to continue.`,
        nextStep: 3,
        data: state.data,
      };
    } else {
      return {
        message:
          message +
          `Minimum threshold reached (${state.data.threshold}). Add more signers or type 'done' to continue.`,
        nextStep: 3,
        data: state.data,
      };
    }
  }

  /**
   * Step 4: Configure signer weights
   */
  private handleStep4(state: WorkflowState, input: string): WorkflowResult {
    const signers = state.data.signers as Array<{
      key: string;
      weight: number;
    }>;

    // Skip weight configuration if only one signer
    if (signers.length === 1) {
      signers[0].weight = 1;
      state.step = 5;
      return {
        message: this.getStepMessage(state),
        nextStep: 5,
        data: state.data,
      };
    }

    if (input.toLowerCase() === "done") {
      state.step = 5;
      return {
        message: this.getStepMessage(state),
        nextStep: 5,
        data: state.data,
      };
    }

    // Parse input: "1 2" means set signer 1's weight to 2
    const parts = input.split(" ");
    if (parts.length < 2) {
      return {
        message:
          "⚠️ Invalid format. Use: <signer_number> <weight>\nExample: 1 2 (sets signer 1's weight to 2)",
      };
    }

    const signerIndex = parseInt(parts[0]) - 1;
    const weight = parseInt(parts[1]);

    if (
      isNaN(signerIndex) ||
      signerIndex < 0 ||
      signerIndex >= signers.length
    ) {
      return {
        message: `⚠️ Invalid signer number. Please enter a number between 1 and ${signers.length}.`,
      };
    }

    if (isNaN(weight) || weight < 1 || weight > this.MAX_THRESHOLD) {
      return {
        message: `⚠️ Invalid weight. Please enter a number between 1 and ${this.MAX_THRESHOLD}.`,
      };
    }

    signers[signerIndex].weight = weight;

    // Show current weights and ask if done
    const weightList = signers
      .map(
        (s, i) => `${i + 1}. \`${s.key.slice(0, 8)}...\`: weight ${s.weight}`
      )
      .join("\n");

    return {
      message: `✅ Signer ${signerIndex + 1} weight set to ${weight}\n\nCurrent weights:\n${weightList}\n\nConfigure more weights or type 'done' to continue.`,
      nextStep: 4,
      data: state.data,
    };
  }

  /**
   * Step 5: Confirm configuration
   */
  private handleStep5(state: WorkflowState, input: string): WorkflowResult {
    const trimmedInput = input.trim().toLowerCase();

    if (
      trimmedInput === "yes" ||
      trimmedInput === "y" ||
      trimmedInput === "confirm"
    ) {
      return this.completeWizard(state);
    }

    if (trimmedInput === "no" || trimmedInput === "n") {
      return {
        message: "❌ Configuration cancelled.",
        isComplete: true,
      };
    }

    return {
      message: "⚠️ Please respond with 'yes' to confirm or 'no' to cancel.",
    };
  }

  /**
   * Complete the wizard and return the final configuration
   */
  private completeWizard(state: WorkflowState): WorkflowResult {
    const config = state.data as unknown as MultisigConfig;

    // Validate final configuration
    const totalWeight = config.signers.reduce((sum, s) => sum + s.weight, 0);
    if (totalWeight < config.threshold) {
      return {
        message: `⚠️ Configuration invalid: Total weight (${totalWeight}) is less than threshold (${config.threshold}). Please start over.`,
        isComplete: true,
      };
    }

    return {
      message: this.getSummaryMessage(config),
      isComplete: true,
      data: state.data,
    };
  }

  /**
   * Get the message for the current wizard step
   */
  public getStepMessage(state: WorkflowState): string {
    switch (state.step) {
      case 1:
        return (
          `🔐 **Multisig Setup Wizard**\n\n` +
          `Step 1/5: Set Threshold\n\n` +
          `The threshold is the minimum number of signers required to authorize transactions.\n\n` +
          `Please enter a threshold (1-20):`
        );

      case 2:
        return (
          `🔐 **Multisig Setup Wizard**\n\n` +
          `Step 2/5: Number of Signers\n\n` +
          `How many signers will this account have? (1-20)\n\n` +
          `Note: You need at least ${state.data.threshold} signers to meet the threshold.`
        );

      case 3: {
        const currentCount = state.data.signers?.length || 0;
        return (
          `🔐 **Multisig Setup Wizard**\n\n` +
          `Step 3/5: Add Signers\n\n` +
          `Signers added: ${currentCount}\n` +
          `Signers needed: at least ${state.data.threshold}\n\n` +
          `Enter a Stellar public key to add a signer, or type 'done' to continue.`
        );
      }

      case 4: {
        const signers = state.data.signers as Array<{
          key: string;
          weight: number;
        }>;
        if (signers.length === 1) {
          state.step = 5;
          return this.getStepMessage(state);
        }
        const weightList = signers
          .map(
            (s, i) =>
              `${i + 1}. \`${s.key.slice(0, 8)}...\`: weight ${s.weight}`
          )
          .join("\n");
        return (
          `🔐 **Multisig Setup Wizard**\n\n` +
          `Step 4/5: Configure Weights\n\n` +
          `Current weights:\n${weightList}\n\n` +
          `Use format: <signer_number> <weight>\n` +
          `Example: 1 2 (sets signer 1's weight to 2)\n\n` +
          `Type 'done' when finished.`
        );
      }

      case 5:
        return (
          `🔐 **Multisig Setup Wizard**\n\n` +
          `Step 5/5: Confirm Configuration\n\n` +
          `${this.getSummaryMessage(state.data as unknown as MultisigConfig)}\n\n` +
          `Type 'yes' to confirm this configuration or 'no' to cancel.`
        );

      default:
        return "⚠️ Invalid wizard state.";
    }
  }

  /**
   * Get a summary of the multisig configuration
   */
  private getSummaryMessage(config: MultisigConfig): string {
    const signersList = config.signers
      .map(
        (s, i) => `${i + 1}. \`${s.key.slice(0, 8)}...\` (weight: ${s.weight})`
      )
      .join("\n");

    const totalWeight = config.signers.reduce((sum, s) => sum + s.weight, 0);

    return (
      `**Configuration Summary:**\n\n` +
      `📊 Threshold: ${config.threshold}\n` +
      `⚖️ Total Weight: ${totalWeight}\n` +
      `👥 Signers (${config.signers.length}):\n${signersList}`
    );
  }

  /**
   * Validate a Stellar public key
   */
  private isValidPublicKey(key: string): boolean {
    // Stellar public keys start with 'G' and are 56 characters long
    const stellarPublicKeyRegex = /^G[A-Z0-9]{55}$/;
    return stellarPublicKeyRegex.test(key);
  }
}
