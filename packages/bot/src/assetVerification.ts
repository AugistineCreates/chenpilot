import * as StellarSdk from "stellar-sdk";

export interface VerificationResult {
  isSafe: boolean;
  domain?: string;
  status: "VERIFIED" | "UNVERIFIED" | "MALICIOUS";
  details?: string;
}

/**
 * #148: Verifies a Stellar asset against its issuer's home_domain and TOML (SEP-1).
 */
export class AssetVerificationService {
  private horizonServer: StellarSdk.Horizon.Server;

  constructor(horizonUrl: string) {
    this.horizonServer = new StellarSdk.Horizon.Server(horizonUrl);
  }

  async verifyAsset(
    assetCode: string,
    issuerAddress: string
  ): Promise<VerificationResult> {
    try {
      const issuerAccount = await this.horizonServer.loadAccount(issuerAddress);
      const homeDomain = issuerAccount.home_domain;

      if (!homeDomain) {
        return {
          isSafe: false,
          status: "UNVERIFIED",
          details: "No home_domain set on issuer account.",
        };
      }

      const toml = await StellarSdk.StellarToml.Resolver.resolve(homeDomain);
      const currencies: Record<string, unknown>[] = toml.CURRENCIES || [];
      const isListed = currencies.some(
        (c) => c["code"] === assetCode && c["issuer"] === issuerAddress
      );

      if (isListed) {
        return { isSafe: true, domain: homeDomain, status: "VERIFIED" };
      }

      return {
        isSafe: false,
        domain: homeDomain,
        status: "MALICIOUS",
        details:
          "Asset issuer claims domain but asset is not listed in TOML file.",
      };
    } catch {
      return {
        isSafe: false,
        status: "UNVERIFIED",
        details: "Verification failed due to network or TOML resolution error.",
      };
    }
  }
}
