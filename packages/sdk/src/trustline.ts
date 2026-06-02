/// @ts-ignore: dependency is provided at the workspace root
import { Server, Asset, Operation } from "stellar-sdk";

export interface TrustlineCheckResult {
  exists: boolean;
  authorized: boolean;
  details?: Record<string, unknown>;
}

/**
 * Resolves an asset issuer's address from a home domain using SEP-1.
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
    const currenciesMatch = text.match(/\[\[CURRENCIES\]\]([\s\S]*?)(?=\[\[|$)/g);
    if (!currenciesMatch) return undefined;

    for (const currencyBlock of currenciesMatch) {
      const codeMatch = currencyBlock.match(/code\s*=\s*["'](.+?)["']/);
      const issuerMatch = currencyBlock.match(/issuer\s*=\s*["'](.+?)["']/);

      if (
        codeMatch &&
        codeMatch[1].toUpperCase() === assetCode.toUpperCase() &&
        issuerMatch
      ) {
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
 */
export async function hasValidStellarTrustline(
  horizonUrl: string | undefined,
  accountId: string,
  assetCode: string,
  assetIssuer?: string
): Promise<TrustlineCheckResult> {
  const server = new Server(horizonUrl || "https://horizon.stellar.org");

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

  const authorized =
    (match.is_authorized as boolean) ??
    (match.authorized as boolean) ??
    (match.authorized_to_maintain_liabilities as boolean) ??
    true;

  return { exists: true, authorized, details: { balance: match } };
}

export interface TrustlineInfo {
  assetCode: string;
  assetIssuer: string;
  balance: string;
}

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
 */
export async function createTrustlineOperation(
  assetCode: string,
  assetIssuer: string,
  limit?: string,
  timeout?: number
): Promise<any> {
  let issuer = assetIssuer;

  if (assetIssuer.includes(".") && !assetIssuer.startsWith("G")) {
    const resolvedIssuer = await resolveIssuerFromDomain(
      assetIssuer,
      assetCode,
      timeout
    );
    if (!resolvedIssuer) {
      throw new Error(
        `Could not resolve issuer for ${assetCode} from domain ${assetIssuer}`
      );
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