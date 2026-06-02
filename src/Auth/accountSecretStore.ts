import fs from "fs";
import path from "path";
import logger from "../config/logger";
import { decrypt } from "../utils/encryption";

export interface AccountData {
  userId: string;
  [key: string]: unknown;
}

function resolveFilePath(filePath: string): string {
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
}

function loadEncryptedAccountsPayload(): string {
  const encryptedJsonB64 = process.env.ENCRYPTED_ACCOUNTS_JSON_B64?.trim();
  const encryptedJsonPath = process.env.ENCRYPTED_ACCOUNTS_JSON_PATH?.trim();

  if (encryptedJsonB64) {
    return encryptedJsonB64;
  }

  if (encryptedJsonPath) {
    const resolvedPath = resolveFilePath(encryptedJsonPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        `Encrypted accounts file not found at path: ${resolvedPath}`
      );
    }
    return fs.readFileSync(resolvedPath, "utf8").trim();
  }

  if (process.env.ALLOW_PLAINTEXT_ACCOUNTS === "true") {
    const plaintextPath = process.env.ACCOUNTS_JSON_PATH;
    if (!plaintextPath) {
      throw new Error(
        "ALLOW_PLAINTEXT_ACCOUNTS=true is set but ACCOUNTS_JSON_PATH is missing"
      );
    }
    const resolvedPath = resolveFilePath(plaintextPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        `Plaintext accounts file not found at path: ${resolvedPath}`
      );
    }
    logger.warn(
      "Loading plaintext account data from ACCOUNTS_JSON_PATH. This is only allowed in non-production development environments."
    );
    return fs.readFileSync(resolvedPath, "utf8");
  }

  throw new Error(
    "Encrypted account secrets are not configured. Set ENCRYPTED_ACCOUNTS_JSON_PATH or ENCRYPTED_ACCOUNTS_JSON_B64."
  );
}

function parseAccountData(payload: string): AccountData[] {
  let rawJson = payload;

  try {
    rawJson = decrypt(payload);
  } catch (err) {
    if (process.env.ALLOW_PLAINTEXT_ACCOUNTS === "true") {
      logger.warn(
        "Falling back to plaintext account JSON because ALLOW_PLAINTEXT_ACCOUNTS=true"
      );
    } else {
      throw new Error(
        `Failed to decrypt account secrets payload: ${
          err instanceof Error ? err.message : "unknown error"
        }`
      );
    }
  }

  const parsed = JSON.parse(rawJson);
  if (!Array.isArray(parsed)) {
    throw new Error("Account secret payload must resolve to an array");
  }

  return parsed as AccountData[];
}

export class AccountSecretStore {
  private accountsCache?: AccountData[];

  getAccounts(): AccountData[] {
    if (!this.accountsCache) {
      const payload = loadEncryptedAccountsPayload();
      this.accountsCache = parseAccountData(payload);
    }
    return this.accountsCache;
  }

  getAccountByUserId<T extends AccountData = AccountData>(userId: string): T {
    const account = this.getAccounts().find((item) => item.userId === userId);
    if (!account) {
      throw new Error(`Account secret not found for userId: ${userId}`);
    }
    return account as T;
  }
}

export const accountSecretStore = new AccountSecretStore();
