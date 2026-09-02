/**
 * errors.ts — typed error hierarchy for the ContractIdentity subsystem (#676).
 */

/** Base error for all deployment-manifest / identity failures. */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

/**
 * Thrown when an active contract's on-chain code identity does not match the
 * signed deployment manifest. Mutating traffic to such a contract MUST be
 * blocked (Issue #676).
 */
export class CodeIdentityMismatchError extends ManifestError {
  constructor(
    public readonly contractName: string,
    public readonly expectedWasmHash: string,
    public readonly observedWasmHash?: string
  ) {
    super(
      `Code identity mismatch for contract "${contractName}": expected ` +
        `wasm ${expectedWasmHash}` +
        (observedWasmHash
          ? ` but chain reports ${observedWasmHash}`
          : " but chain identity could not be established")
    );
    this.name = "CodeIdentityMismatchError";
  }
}

/**
 * Thrown when a manifest is bound to a different network than the one the
 * backend is currently operating on (testnet vs mainnet separation).
 */
export class NetworkIdentityMismatchError extends ManifestError {
  constructor(
    public readonly contractName: string,
    public readonly manifestNetwork: string,
    public readonly activeNetwork: string
  ) {
    super(
      `Network identity mismatch for contract "${contractName}": manifest is ` +
        `bound to "${manifestNetwork}" but backend is operating on "${activeNetwork}". ` +
        `Testnet and mainnet identities must never be confused.`
    );
    this.name = "NetworkIdentityMismatchError";
  }
}

/**
 * Thrown when no verified manifest exists for a contract that needs to perform
 * a mutating operation, or during startup verification when a manifest is
 * missing for a configured active contract.
 */
export class MissingManifestError extends ManifestError {
  constructor(
    public readonly contractName: string,
    reason?: string
  ) {
    super(
      `No verified deployment manifest for contract "${contractName}"` +
        (reason ? `: ${reason}` : "")
    );
    this.name = "MissingManifestError";
  }
}

/**
 * Thrown when the runtime identity gate is tripped (mutating traffic blocked).
 */
export class IdentityGateBlockedError extends ManifestError {
  constructor(
    reason: string,
    public readonly contractName?: string
  ) {
    super(
      `Mutating traffic blocked: ${reason}` +
        (contractName ? ` (contract "${contractName}")` : "")
    );
    this.name = "IdentityGateBlockedError";
  }
}
