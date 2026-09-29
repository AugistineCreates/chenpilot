/**
 * Multisig Workflow
 * Multi-step workflow for setting up a multisig wallet
 */

import { Workflow } from '../../types.js';

export interface MultisigState {
  signerCount?: number;
  signers: string[];
  threshold?: number;
  masterKey?: string;
  network?: string;
}

export const multisigWorkflow: Workflow<MultisigState> = {
  id: 'multisig_setup',
  name: 'Multisig Wallet Setup',
  initialState: 'init',
  states: {
    init: {
      name: 'Initialize',
      handler: async (state, input) => {
        return {
          nextState: 'collect_signer_count',
          output: { message: 'How many signers do you need for your multisig wallet?' },
        };
      },
      timeout: 300000, // 5 minutes
    },
    collect_signer_count: {
      name: 'Collect Signer Count',
      handler: async (state, input) => {
        const count = input.count;
        if (!count || count < 2 || count > 20) {
          return {
            nextState: 'collect_signer_count',
            output: { message: 'Please enter a number between 2 and 20' },
          };
        }
        
        state.signerCount = count;
        return {
          nextState: 'collect_signers',
          output: { message: `Please enter ${count} signer addresses (one per line)` },
          state,
        };
      },
      timeout: 300000,
    },
    collect_signers: {
      name: 'Collect Signers',
      handler: async (state, input) => {
        const signers = input.signers;
        if (!signers || signers.length !== state.signerCount) {
          return {
            nextState: 'collect_signers',
            output: { message: `Please enter exactly ${state.signerCount} signer addresses` },
          };
        }

        state.signers = signers;
        return {
          nextState: 'collect_threshold',
          output: { message: 'What is the signature threshold?' },
          state,
        };
      },
      timeout: 300000,
    },
    collect_threshold: {
      name: 'Collect Threshold',
      handler: async (state, input) => {
        const threshold = input.threshold;
        if (!threshold || threshold < 1 || threshold > (state.signerCount || 2)) {
          return {
            nextState: 'collect_threshold',
            output: { message: `Threshold must be between 1 and ${state.signerCount || 2}` },
          };
        }

        state.threshold = threshold;
        return {
          nextState: 'confirm',
          output: { 
            message: `Please confirm:\nSigners: ${state.signers.join(', ')}\nThreshold: ${threshold}\n\nReply 'yes' to confirm or 'no' to cancel` 
          },
          state,
        };
      },
      timeout: 300000,
    },
    confirm: {
      name: 'Confirm',
      handler: async (state, input) => {
        const confirmed = input.confirmed;
        
        if (!confirmed) {
          return {
            nextState: null,
            output: { message: 'Multisig setup cancelled' },
          };
        }

        // TODO: Call backend to create multisig wallet
        return {
          nextState: 'complete',
          output: { message: 'Multisig wallet created successfully!' },
          state,
        };
      },
      timeout: 60000,
    },
    complete: {
      name: 'Complete',
      handler: async (state, input) => {
        return {
          nextState: null,
          output: { message: 'Workflow complete' },
        };
      },
    },
  },
  transitions: {
    init_to_collect: { from: 'init', to: 'collect_signer_count' },
    collect_count_to_signers: { from: 'collect_signer_count', to: 'collect_signers' },
    signers_to_threshold: { from: 'collect_signers', to: 'collect_threshold' },
    threshold_to_confirm: { from: 'collect_threshold', to: 'confirm' },
    confirm_to_complete: { from: 'confirm', to: 'complete' },
  },
  onCompletion: async (state) => {
    // TODO: Send confirmation to backend
    console.log('Multisig workflow completed:', state);
  },
  onError: async (error, state) => {
    console.error('Multisig workflow error:', error, state);
  },
};
