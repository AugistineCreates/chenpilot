// @ts-ignore: dependency is provided at the workspace root
import { Server, Asset, Operation } from "stellar-sdk";

export interface TrustlineCheckResult {
  exists: boolean;
  authorized: boolean;
  details?: Record<string, unknown>;
}

/**
 * Resolves an asset issuer's address from a home domain using SEP-1.
 * 
 * @param domain The home domain to resolve (e.g., "circle.com")
 * @param assetCode The asset code to find in the stellar.toml
 * @param timeout Optional request timeout in milliseconds
 * @returns The issuer's public key or undefined
 */
export async function resolveIssuerFromDomain(
  domain: string,
  assetCode: string,
  timeout?: number
): Promise<string | undefined> {
  try {
    const url = `https://${domain}/.well-known/stellar.toml`;
    const signal = timeout ? AbortSignal.timeout(timeout) : undefined;
    const response = await fetch(url, { signal });
    if (!response.ok) return undefined;
    
    const text = await response.text();
    // Simple TOML parser for CURRENCIES section
    const currenciesMatch = text.match(/\[\[CURRENCIES\]\]([\s\S]*?)(?=\[\[|$)/g);
    if (!currenciesMatch) return undefined;

    for (const currencyBlock of currenciesMatch) {
      const codeMatch = currencyBlock.match(/code\s*=\s*["'](.+?)["']/);
      const issuerMatch = currencyBlock.match(/issuer\s*=\s*["'](.+?)["']/);
      
      if (codeMatch && codeMatch[1].toUpperCase() === assetCode.toUpperCase() && issuerMatch) {
        return issuerMatch[1];
      }
    }
    return undefined;
  } catch (error) {
    console.error(`Error resolving issuer from domain ${domain}:`, error);
    return undefined;
  }
}

/**
 * Checks whether an account has a valid, non-frozen trustline for an asset.
 * - For native XLM the function returns exists=true, authorized=true.
 * - For other assets it fetches the account from Horizon and inspects balances.
 *
 * @param horizonUrl Horizon server URL (defaults to public Horizon)
 * @param accountId Stellar account id to check
 * @param assetCode Asset code (string; "XLM" for native)
 * @param assetIssuer Asset issuer public key (optional for native/XLM)
 */
export async function hasValidStellarTrustline(
  horizonUrl: string | undefined,
  accountId: string,
  assetCode: string,
  assetIssuer?: string
): Promise<TrustlineCheckResult> {
  const server = new Server(horizonUrl || "https://horizon.stellar.org");

  // Native XLM does not require a trustline
  if (!assetCode || assetCode.toUpperCase() === "XLM") {
    return { exists: true, authorized: true };
  }

  let account: any;
  try {
    account = await server.accounts().accountId(accountId).call();
  } catch (err) {
    return {
      exists: false,
      authorized: false,
      details: { error: String(err) },
    };
  }

  const balances: any[] = account.balances || [];
  const match = balances.find((b) => {
    return (
      b.asset_code === assetCode &&
      (assetIssuer ? b.asset_issuer === assetIssuer : true)
    );
  });

  if (!match) {
    return { exists: false, authorized: false };
  }

  // Horizon may include authorization properties on the trustline/balance object
  const authorized =
    // common property name
    (match.is_authorized as boolean) ??
    (match.authorized as boolean) ??
    // if issuer uses 'authorized_to_maintain_liabilities' treat as authorized
    (match.authorized_to_maintain_liabilities as boolean) ?? true;

  return { exists: true, authorized, details: { balance: match } };
}

export interface TrustlineInfo {
  assetCode: string;
  assetIssuer: string;
  balance: string;
}

/**
 * Inspect an account for non-native trustlines whose balance is zero.
 * Returns a list that can later be used to build changeTrust operations with
 * limit 0 (i.e. remove the trustline).
 *
 * @param horizonUrl optional horizon server URL
 * @param accountId account to inspect
 */
export async function findZeroBalanceTrustlines(
  horizonUrl: string | undefined,
  accountId: string
): Promise<TrustlineInfo[]> {
  const server = new Server(horizonUrl || "https://horizon.stellar.org");
  const account = await server.accounts().accountId(accountId).call();
  const balances: any[] = account.balances || [];

  return balances
    .filter((b) => b.asset_type !== "native" && parseFloat(b.balance) === 0)
    .map((b) => ({
      assetCode: b.asset_code,
      assetIssuer: b.asset_issuer,
      balance: b.balance,
    }));
}

/**
 * Build a collection of changeTrust operations that remove the provided
 * trustlines (setting limit to "0").  The returned operations can be added
 * to a transaction builder.
 */
export function buildTrustlineRemovalOps(
  trustlines: TrustlineInfo[]
): Operation[] {
  return trustlines.map((t) =>
    Operation.changeTrust({
      asset: new Asset(t.assetCode, t.assetIssuer),
      limit: "0",
    })
  );
}

/**
 * Creates a ChangeTrust operation for a given asset.
 * 
 * @param assetCode Asset code (e.g., "USDC")
 * @param assetIssuer Asset issuer public key or domain
 * @param limit Optional trust limit
 * @param timeout Optional request timeout in milliseconds (used when resolving domain)
 * @returns An Operation object
 */
export async function createTrustlineOperation(
  assetCode: string,
  assetIssuer: string,
  limit?: string,
  timeout?: number
): Promise<any> {
  let issuer = assetIssuer;

  // If issuer looks like a domain, resolve it
  if (assetIssuer.includes(".") && !assetIssuer.startsWith("G")) {
    const resolvedIssuer = await resolveIssuerFromDomain(assetIssuer, assetCode, timeout);
    if (!resolvedIssuer) {
      throw new Error(`Could not resolve issuer for ${assetCode} from domain ${assetIssuer}`);
    }
    issuer = resolvedIssuer;
  }

  const asset = new Asset(assetCode, issuer);
  return Operation.changeTrust({
    asset,
    limit,
  });
}

export default hasValidStellarTrustline;
