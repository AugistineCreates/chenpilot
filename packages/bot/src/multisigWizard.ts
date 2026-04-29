/**
 * Multisig Wizard Service
 * 
 * Provides an interactive wizard to guide users through setting up
 * a basic multi-signature configuration on their Stellar account.
 */

export interface MultisigConfig {
  threshold: number;
  signers: Array<{
    key: string;
    weight: number;
  }>;
  masterKey: string;
}

export interface WizardState {
  step: number;
  config: Partial<MultisigConfig>;
  userId: string;
  platform: 'discord' | 'telegram';
}

export interface WizardResponse {
  message: string;
  nextStep?: number;
  config?: Partial<MultisigConfig>;
  isComplete?: boolean;
}

export class MultisigWizard {
  private activeWizards: Map<string, WizardState> = new Map();
  private readonly MAX_SIGNERS = 20;
  private readonly MAX_THRESHOLD = 20;
  private readonly MIN_THRESHOLD = 1;

  /**
   * Start a new wizard session for a user
   */
  startWizard(userId: string, platform: 'discord' | 'telegram'): WizardResponse {
    const wizardId = `${platform}:${userId}`;
    
    // Check if wizard already exists
    if (this.activeWizards.has(wizardId)) {
      return {
        message: "⚠️ You already have an active multisig wizard session. Use !multisig cancel to abort it.",
      };
    }

    const state: WizardState = {
      step: 1,
      config: {
        signers: [],
      },
      userId,
      platform,
    };

    this.activeWizards.set(wizardId, state);

    return {
      message: this.getStepMessage(state),
      nextStep: 1,
    };
  }

  /**
   * Process user input in the wizard
   */
  processInput(userId: string, platform: 'discord' | 'telegram', input: string): WizardResponse {
    const wizardId = `${platform}:${userId}`;
    const state = this.activeWizards.get(wizardId);

    if (!state) {
      return {
        message: "⚠️ No active wizard session. Use !multisig to start a new one.",
      };
    }

    const trimmedInput = input.trim().toLowerCase();

    // Handle cancel command
    if (trimmedInput === 'cancel' || trimmedInput === 'abort' || trimmedInput === 'exit') {
      this.activeWizards.delete(wizardId);
      return {
        message: "❌ Multisig wizard cancelled. No changes were made.",
      };
    }

    // Handle reset command
    if (trimmedInput === 'reset' || trimmedInput === 'restart') {
      state.step = 1;
      state.config = { signers: [] };
      return {
        message: "🔄 Wizard reset. Let's start over!\n\n" + this.getStepMessage(state),
        nextStep: 1,
      };
    }

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
  private handleStep1(state: WizardState, input: string): WizardResponse {
    const threshold = parseInt(input);

    if (isNaN(threshold) || threshold < this.MIN_THRESHOLD || threshold > this.MAX_THRESHOLD) {
      return {
        message: `⚠️ Invalid threshold. Please enter a number between ${this.MIN_THRESHOLD} and ${this.MAX_THRESHOLD}.`,
      };
    }

    state.config.threshold = threshold;
    state.step = 2;

    return {
      message: this.getStepMessage(state),
      nextStep: 2,
      config: state.config,
    };
  }

  /**
   * Step 2: Ask for number of signers
   */
  private handleStep2(state: WizardState, input: string): WizardResponse {
    const numSigners = parseInt(input);

    if (isNaN(numSigners) || numSigners < 1 || numSigners > this.MAX_SIGNERS) {
      return {
        message: `⚠️ Invalid number of signers. Please enter a number between 1 and ${this.MAX_SIGNERS}.`,
      };
    }

    if (numSigners < state.config.threshold!) {
      return {
        message: `⚠️ Number of signers must be at least equal to the threshold (${state.config.threshold}).`,
      };
    }

    state.config.signers = [];
    state.step = 3;

    return {
      message: this.getStepMessage(state, numSigners),
      nextStep: 3,
      config: state.config,
    };
  }

  /**
   * Step 3: Collect signer keys
   */
  private handleStep3(state: WizardState, input: string): WizardResponse {
    const signers = state.config.signers!;
    const targetSigners = parseInt(input.split(' ')[0]) || signers.length + 1;

    // Check if we're adding a signer or moving to next step
    if (input.toLowerCase() === 'done' || input.toLowerCase() === 'next') {
      if (signers.length === 0) {
        return {
          message: "⚠️ You need to add at least one signer. Enter a public key or type 'cancel' to abort.",
        };
      }
      state.step = 4;
      return {
        message: this.getStepMessage(state),
        nextStep: 4,
        config: state.config,
      };
    }

    // Validate Stellar public key
    if (!this.isValidPublicKey(input)) {
      return {
        message: "⚠️ Invalid Stellar public key. Please enter a valid public key (starts with 'G').",
      };
    }

    // Check for duplicates
    if (signers.some(s => s.key === input)) {
      return {
        message: "⚠️ This signer has already been added. Please enter a different key.",
      };
    }

    // Add signer with default weight
    signers.push({
      key: input,
      weight: 1,
    });

    state.step = 3; // Stay on step 3 to collect more signers

    const remaining = (state.config.threshold! - signers.length);
    const message = `✅ Signer ${signers.length} added: \`${input.slice(0, 8)}...\`\n\n`;
    
    if (signers.length < state.config.threshold!) {
      return {
        message: message + `You need at least ${state.config.threshold} signers total. Add another key or type 'done' to continue.`,
        nextStep: 3,
        config: state.config,
      };
    } else {
      return {
        message: message + `Minimum threshold reached (${state.config.threshold}). Add more signers or type 'done' to continue.`,
        nextStep: 3,
        config: state.config,
      };
    }
  }

  /**
   * Step 4: Configure signer weights
   */
  private handleStep4(state: WizardState, input: string): WizardResponse {
    const signers = state.config.signers!;
    
    // Skip weight configuration if only one signer
    if (signers.length === 1) {
      signers[0].weight = 1;
      state.step = 5;
      return {
        message: this.getStepMessage(state),
        nextStep: 5,
        config: state.config,
      };
    }

    // Parse input: "1 2" means set signer 1's weight to 2
    const parts = input.split(' ');
    if (parts.length < 2) {
      return {
        message: "⚠️ Invalid format. Use: <signer_number> <weight>\nExample: 1 2 (sets signer 1's weight to 2)",
      };
    }

    const signerIndex = parseInt(parts[0]) - 1;
    const weight = parseInt(parts[1]);

    if (isNaN(signerIndex) || signerIndex < 0 || signerIndex >= signers.length) {
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

    // Check if threshold can be met
    const totalWeight = signers.reduce((sum, s) => sum + s.weight, 0);
    if (totalWeight < state.config.threshold!) {
      return {
        message: `⚠️ Total weight (${totalWeight}) is less than threshold (${state.config.threshold}). Increase some weights.`,
      };
    }

    // Show current weights and ask if done
    let weightList = signers.map((s, i) => `${i + 1}. \`${s.key.slice(0, 8)}...\`: weight ${s.weight}`).join('\n');
    
    return {
      message: `✅ Signer ${signerIndex + 1} weight set to ${weight}\n\nCurrent weights:\n${weightList}\n\nConfigure more weights or type 'done' to continue.`,
      nextStep: 4,
      config: state.config,
    };
  }

  /**
   * Step 5: Confirm configuration
   */
  private handleStep5(state: WizardState, input: string): WizardResponse {
    const trimmedInput = input.trim().toLowerCase();

    if (trimmedInput === 'yes' || trimmedInput === 'y' || trimmedInput === 'confirm') {
      return this.completeWizard(state);
    }

    if (trimmedInput === 'no' || trimmedInput === 'n') {
      return {
        message: "❌ Configuration cancelled. Use !multisig to start over.",
      };
    }

    return {
      message: "⚠️ Please respond with 'yes' to confirm or 'no' to cancel.",
    };
  }

  /**
   * Complete the wizard and return the final configuration
   */
  private completeWizard(state: WizardState): WizardResponse {
    const wizardId = `${state.platform}:${state.userId}`;
    this.activeWizards.delete(wizardId);

    const config = state.config as MultisigConfig;
    
    // Validate final configuration
    const totalWeight = config.signers.reduce((sum, s) => sum + s.weight, 0);
    if (totalWeight < config.threshold) {
      return {
        message: `⚠️ Configuration invalid: Total weight (${totalWeight}) is less than threshold (${config.threshold}). Please start over.`,
      };
    }

    return {
      message: this.getSummaryMessage(config),
      isComplete: true,
      config,
    };
  }

  /**
   * Get the message for the current wizard step
   */
  private getStepMessage(state: WizardState, additionalInfo?: number): string {
    switch (state.step) {
      case 1:
        return `🔐 **Multisig Setup Wizard**\n\n` +
               `Step 1/5: Set Threshold\n\n` +
               `The threshold is the minimum number of signers required to authorize transactions.\n\n` +
               `Please enter a threshold (1-20):`;

      case 2:
        return `🔐 **Multisig Setup Wizard**\n\n` +
               `Step 2/5: Number of Signers\n\n` +
               `How many signers will this account have? (1-20)\n\n` +
               `Note: You need at least ${state.config.threshold} signers to meet the threshold.`;

      case 3:
        const currentCount = state.config.signers?.length || 0;
        return `🔐 **Multisig Setup Wizard**\n\n` +
               `Step 3/5: Add Signers\n\n` +
               `Signers added: ${currentCount}\n` +
               `Signers needed: at least ${state.config.threshold}\n\n` +
               `Enter a Stellar public key to add a signer, or type 'done' to continue.`;

      case 4:
        const signers = state.config.signers!;
        if (signers.length === 1) {
          state.step = 5;
          return this.getStepMessage(state);
        }
        let weightList = signers.map((s, i) => `${i + 1}. \`${s.key.slice(0, 8)}...\`: weight ${s.weight}`).join('\n');
        return `🔐 **Multisig Setup Wizard**\n\n` +
               `Step 4/5: Configure Weights\n\n` +
               `Current weights:\n${weightList}\n\n` +
               `Use format: <signer_number> <weight>\n` +
               `Example: 1 2 (sets signer 1's weight to 2)\n\n` +
               `Type 'done' when finished.`;

      case 5:
        return `🔐 **Multisig Setup Wizard**\n\n` +
               `Step 5/5: Confirm Configuration\n\n` +
               `${this.getSummaryMessage(state.config as MultisigConfig)}\n\n` +
               `Type 'yes' to confirm this configuration or 'no' to cancel.`;

      default:
        return "⚠️ Invalid wizard state.";
    }
  }

  /**
   * Get a summary of the multisig configuration
   */
  private getSummaryMessage(config: MultisigConfig): string {
    const signersList = config.signers.map((s, i) => 
      `${i + 1}. \`${s.key.slice(0, 8)}...\` (weight: ${s.weight})`
    ).join('\n');

    const totalWeight = config.signers.reduce((sum, s) => sum + s.weight, 0);

    return `**Configuration Summary:**\n\n` +
           `📊 Threshold: ${config.threshold}\n` +
           `⚖️ Total Weight: ${totalWeight}\n` +
           `👥 Signers (${config.signers.length}):\n${signersList}`;
  }

  /**
   * Validate a Stellar public key
   */
  private isValidPublicKey(key: string): boolean {
    // Stellar public keys start with 'G' and are 56 characters long
    const stellarPublicKeyRegex = /^G[A-Z0-9]{55}$/;
    return stellarPublicKeyRegex.test(key);
  }

  /**
   * Get the current state of a user's wizard
   */
  getWizardState(userId: string, platform: 'discord' | 'telegram'): WizardState | undefined {
    return this.activeWizards.get(`${platform}:${userId}`);
  }

  /**
   * Cancel a user's wizard session
   */
  cancelWizard(userId: string, platform: 'discord' | 'telegram'): boolean {
    const wizardId = `${platform}:${userId}`;
    return this.activeWizards.delete(wizardId);
  }

  /**
   * Get the number of active wizards
   */
  getActiveWizardCount(): number {
    return this.activeWizards.size;
  }
}
