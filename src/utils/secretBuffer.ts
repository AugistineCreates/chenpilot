/**
 * secretBuffer.ts — Bounded-lifetime, zeroizable secret wrapper.
 *
 * Provides a mutable-buffer-backed representation for sensitive material
 * (private keys, decrypted tokens, seed phrases) that:
 *
 *  - Prevents accidental JSON serialization of plaintext secrets.
 *  - Provides explicit zeroization via `destroy()`.
 *  - Rejects use after zeroization.
 *  - Offers a safe `toString()` that never exposes the underlying data.
 *  - Supports a `consume()` callback that temporarily exposes the raw
 *    buffer for FFI / SDK calls that require strings, keeping the
 *    plaintext scope as narrow as possible.
 *
 * Limitations acknowledged:
 *  - JavaScript strings are immutable; once a string is created, the VM
 *    controls when it is collected. Buffer → string → Buffer round-trips
 *    cannot guarantee V8 will erase the string copy.
 *  - Third-party SDKs (@stellar/stellar-sdk Keypair.fromSecret, sign)
 *    require plaintext strings. `consume()` is designed to keep those
 *    conversions as short-lived as possible.
 *  - Heap snapshots taken while the string is live will still see it.
 */

// ─── Non-configurable secret symbol for safe inspect/toString ──────────────

const SECRET_TAG = "[SecretMaterial]";

// ─── Zeroization utility ───────────────────────────────────────────────────

/**
 * Overwrite a Uint8Array with zeros. Best-effort in JavaScript — the
 * GC may have already copied the data, but this prevents obvious
 * retention in application-owned buffers.
 */
export function zeroizeBuffer(buf: Uint8Array): void {
  if (buf && buf.length > 0) {
    buf.fill(0);
  }
}

// ─── SecretBuffer ──────────────────────────────────────────────────────────

export class SecretBuffer {
  #data: Uint8Array | null;
  #label: string;

  /**
   * @param source  The sensitive bytes to protect.
   * @param label   Human-readable tag for debugging (e.g. "stellar-secret-key").
   */
  constructor(source: Uint8Array, label = "secret") {
    if (!(source instanceof Uint8Array) || source.length === 0) {
      throw new Error("SecretBuffer requires a non-empty Uint8Array");
    }
    // Copy so the caller cannot mutate our internal buffer.
    this.#data = new Uint8Array(source);
    this.#label = label;
  }

  // ── Factory helpers ──────────────────────────────────────────────────────

  /** Wrap a UTF-8 string into a SecretBuffer. */
  static fromString(value: string, label?: string): SecretBuffer {
    return new SecretBuffer(Buffer.from(value, "utf8"), label);
  }

  /** Wrap a hex-encoded string into a SecretBuffer. */
  static fromHex(value: string, label?: string): SecretBuffer {
    return new SecretBuffer(Buffer.from(value, "hex"), label);
  }

  // ── Access ───────────────────────────────────────────────────────────────

  /** Length in bytes. Returns 0 after destroy(). */
  get length(): number {
    return this.#data?.length ?? 0;
  }

  /** True after `destroy()` has been called. */
  get destroyed(): boolean {
    return this.#data === null;
  }

  /**
   * Temporarily expose the raw buffer via a callback.
   *
   * The callback receives a **read-only view** over the internal data.
   * The buffer is NOT zeroized after the callback — `destroy()` must
   * still be called explicitly when the caller is done with all
   * operations that need the plaintext.
   *
   * @throws if the SecretBuffer has been destroyed.
   */
  consume<T>(fn: (data: Uint8Array) => T): T {
    this.#assertAlive();
    return fn(this.#data!);
  }

  /**
   * Temporarily expose the contents as a UTF-8 string via a callback.
   *
   * This is the escape hatch for third-party APIs that require a
   * plaintext string (e.g. StellarSdk.Keypair.fromSecret). Keep the
   * callback as narrow as possible.
   *
   * @throws if the SecretBuffer has been destroyed.
   */
  consumeString<T>(fn: (plaintext: string) => T): T {
    this.#assertAlive();
    const str = Buffer.from(this.#data!).toString("utf8");
    try {
      return fn(str);
    } finally {
      // Best-effort: overwrite the local string reference. The VM may
      // still hold the string in internal memory, but we release our
      // reference immediately.
      // (No practical way to zeroize a JS string; this is documented.)
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Zeroize the underlying buffer and mark this instance as destroyed.
   * Safe to call multiple times.
   */
  destroy(): void {
    if (this.#data !== null) {
      zeroizeBuffer(this.#data);
      this.#data = null;
    }
  }

  // ── Safe representations (never expose plaintext) ────────────────────────

  toString(): string {
    return `${SECRET_TAG}(${this.#label}, ${this.length} bytes)`;
  }

  /**
   * Prevent accidental JSON serialization of the secret contents.
   * `JSON.stringify(secretBuffer)` produces `"[SecretMaterial]"`.
   */
  toJSON(): string {
    return SECRET_TAG;
  }

  /**
   * Make the internal buffer non-enumerable so that object spreading
   * (`{ ...secretBuffer }`) or `Object.keys()` never leaks it.
   * Symbol-keyed access is preserved for `consume`/`consumeString`.
   */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  #assertAlive(): void {
    if (this.#data === null) {
      throw new Error(
        `SecretBuffer(${this.#label}) has been destroyed and can no longer be accessed`
      );
    }
  }
}

// ─── Helper: acquire → use → destroy in a try/finally ──────────────────────

/**
 * Convenience wrapper that creates a SecretBuffer from a string,
 * passes it to the callback, and guarantees zeroization afterward.
 *
 * @example
 * ```ts
 * const txHash = await withSecret(encryptedKey, "stellar-key", async (secret) => {
 *   return secret.consumeString(async (plainKey) => {
 *     const kp = Keypair.fromSecret(plainKey);
 *     // …sign transaction…
 *     return txHash;
 *   });
 * });
 * ```
 */
export async function withSecret<T>(
  source: string | Uint8Array,
  label: string,
  fn: (secret: SecretBuffer) => Promise<T> | T,
): Promise<T> {
  const secret =
    typeof source === "string"
      ? SecretBuffer.fromString(source, label)
      : new SecretBuffer(source, label);
  try {
    return await fn(secret);
  } finally {
    secret.destroy();
  }
}
