import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import logger from "../../config/logger";

/**
 * SEP-1 Stellar.toml metadata structure
 */
export interface StellarTomlAsset {
  code: string;
  issuer: string;
  status?: string;
  display_name?: string;
  name?: string;
  description?: string;
  conditions?: string;
  stamp?: string;
  fixed_addresses?: string[];
  managed_by?: string;
  owning_account?: string;
}

export interface StellarTomlCurrency {
  code: string;
  issuer?: string;
  status?: string;
  display_name?: string;
  name?: string;
  desc?: string;
  conditions?: string;
  image?: string;
  fixed_addresses?: string[];
  managed_by?: string;
  anchoring_asset?: string;
  redemption?: string;
  collateral?: string[];
}

export interface StellarTomlDoc {
  [key: string]: unknown;
}

export interface StellarToml {
  version?: string;
  accouns?: StellarTomlDoc;
  currencies?: StellarTomlCurrency[];
  validators?: StellarTomlDoc[];
  uri?: string;
  client?: {
    version?: string;
    currentProtocolVersion?: string;
    requiredProtocolVersion?: string;
  };
  issuer?: {
    distribute?: boolean;
    allow_addl_issuance?: boolean;
    seed?: string;
    signature?: string;
  };
  signingKey?: string;
  homeDomain?: string;
}

interface AssetMetadataPayload extends Record<string, unknown> {
  operation: "get_asset_metadata" | "get_domain_metadata" | "list_assets";
  asset?: string;
  domain?: string;
}

export class Sep1Tool extends BaseTool<AssetMetadataPayload> {
  private fetch: typeof globalThis.fetch;

  metadata: ToolMetadata = {
    name: "sep1_tool",
    description:
      "Retrieve and parse stellar.toml metadata to provide token information (SEP-1)",
    parameters: {
      operation: {
        type: "string",
        description: "The SEP-1 operation to perform",
        required: true,
        enum: ["get_asset_metadata", "get_domain_metadata", "list_assets"],
      },
      asset: {
        type: "string",
        description:
          "Asset code:issuer (e.g., USDC:GA...Z46) or code only for XLM",
        required: false,
      },
      domain: {
        type: "string",
        description: "Domain to fetch stellar.toml from (e.g., example.com)",
        required: false,
      },
    },
    examples: [
      "Get metadata for USDC asset",
      "Get stellar.toml from example.com",
      "List all assets from stellar.org",
      "What is the metadata for TEST asset from test.com?",
    ],
    category: "metadata",
    version: "1.0.0",
  };

  constructor() {
    super();
    this.fetch = globalThis.fetch.bind(globalThis);
  }

  async execute(payload: AssetMetadataPayload): Promise<ToolResult> {
    try {
      switch (payload.operation) {
        case "get_asset_metadata":
          return await this.getAssetMetadata(payload);
        case "get_domain_metadata":
          return await this.getDomainMetadata(payload);
        case "list_assets":
          return await this.listAssets(payload);
        default:
          return {
            action: "sep1",
            status: "error",
            error: `Unknown operation: ${payload.operation}`,
          };
      }
    } catch (error) {
      logger.error("SEP-1 tool error:", error);
      return {
        action: "sep1",
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get asset metadata by resolving the issuing domain from the asset issuer
   */
  private async getAssetMetadata(
    payload: AssetMetadataPayload
  ): Promise<ToolResult> {
    if (!payload.asset) {
      return {
        action: "sep1",
        status: "error",
        error: "Asset code:issuer is required for get_asset_metadata",
      };
    }

    const asset = payload.asset.toUpperCase();

    // Handle XLM specially
    if (asset === "XLM" || asset === "XLM:NATIVE") {
      return {
        action: "sep1",
        status: "success",
        data: {
          asset: "XLM",
          type: "native",
          display_name: "Stellar Lumen",
          name: "Stellar Lumen",
          description: "The native asset of the Stellar network",
          issuer: "NATIVE",
        },
        message: "XLM is the native currency of the Stellar network",
      };
    }

    // Parse asset code:issuer
    let assetCode: string;
    let assetIssuer: string;

    if (asset.includes(":")) {
      [assetCode, assetIssuer] = asset.split(":");
    } else {
      return {
        action: "sep1",
        status: "error",
        error: "Asset must be in format CODE:ISSUER (e.g., USDC:GA5...Z46)",
      };
    }

    // Try to get domain from Horizon using getKeyValue
    // This is a simplified approach - in production, we'd need to look up the issuing account
    // For now, we'll try common domains based on the issuer
    const domain = await this.resolveIssuerDomain(assetIssuer);

    if (!domain) {
      return {
        action: "sep1",
        status: "error",
        error: `Could not resolve domain for issuer ${assetIssuer}`,
      };
    }

    // Fetch and parse stellar.toml
    const toml = await this.fetchStellarToml(domain);

    if (!toml) {
      return {
        action: "sep1",
        status: "error",
        error: `Could not fetch stellar.toml from ${domain}`,
      };
    }

    // Find the asset in currencies
    const currency = toml.currencies?.find(
      (c) => c.code.toUpperCase() === assetCode
    );

    if (!currency) {
      return {
        action: "sep1",
        status: "success",
        data: {
          asset: assetCode,
          issuer: assetIssuer,
          domain,
          found: false,
          message: "Asset found in stellar.toml but currency not defined",
        },
        message: `Asset ${assetCode} found but no metadata defined in stellar.toml`,
      };
    }

    return {
      action: "sep1",
      status: "success",
      data: {
        asset: assetCode,
        issuer: assetIssuer,
        domain,
        ...currency,
      },
      message: `Retrieved metadata for ${assetCode} from ${domain}`,
    };
  }

  /**
   * Get all metadata from a domain's stellar.toml
   */
  private async getDomainMetadata(
    payload: AssetMetadataPayload
  ): Promise<ToolResult> {
    if (!payload.domain) {
      return {
        action: "sep1",
        status: "error",
        error: "Domain is required for get_domain_metadata",
      };
    }

    const domain = payload.domain.toLowerCase();
    const toml = await this.fetchStellarToml(domain);

    if (!toml) {
      return {
        action: "sep1",
        status: "error",
        error: `Could not fetch stellar.toml from ${domain}`,
      };
    }

    return {
      action: "sep1",
      status: "success",
      data: {
        domain,
        version: toml.version,
        signingKey: toml.signingKey,
        homeDomain: toml.homeDomain,
        currencies: toml.currencies?.map((c) => ({
          code: c.code,
          issuer: c.issuer,
          display_name: c.display_name,
          desc: c.desc,
          conditions: c.conditions,
          image: c.image,
        })),
        client: toml.client,
      },
      message: `Retrieved stellar.toml from ${domain}`,
    };
  }

  /**
   * List all assets from a domain's stellar.toml
   */
  private async listAssets(payload: AssetMetadataPayload): Promise<ToolResult> {
    const domain = (payload.domain || "stellar.org").toLowerCase();
    const toml = await this.fetchStellarToml(domain);

    if (!toml) {
      return {
        action: "sep1",
        status: "error",
        error: `Could not fetch stellar.toml from ${domain}`,
      };
    }

    const assets =
      toml.currencies?.map((c) => ({
        code: c.code,
        issuer: c.issuer,
        display_name: c.display_name,
        status: c.status,
      })) || [];

    return {
      action: "sep1",
      status: "success",
      data: {
        domain,
        total: assets.length,
        assets,
      },
      message: `Found ${assets.length} assets on ${domain}`,
    };
  }

  /**
   * Fetch and parse stellar.toml from a domain
   */
  private async fetchStellarToml(domain: string): Promise<StellarToml | null> {
    try {
      // Handle potential .well-known path
      const url = domain.includes(".well-known")
        ? `https://${domain}/stellar.toml`
        : `https://${domain}/.well-known/stellar.toml`;

      const response = await this.fetch(url, {
        headers: {
          Accept: "text/plain",
        },
      });

      if (!response.ok) {
        // Try alternative path
        const altUrl = `https://${domain}/stellar.toml`;
        const altResponse = await this.fetch(altUrl, {
          headers: {
            Accept: "text/plain",
          },
        });

        if (!altResponse.ok) {
          logger.warn(
            `Failed to fetch stellar.toml from ${domain}: ${response.status}`
          );
          return null;
        }

        const text = await altResponse.text();
        return this.parseToml(text);
      }

      const text = await response.text();
      return this.parseToml(text);
    } catch (error) {
      logger.error(`Error fetching stellar.toml from ${domain}:`, error);
      return null;
    }
  }

  /**
   * Parse TOML content into an object (simple parser for stellar.toml)
   */
  private parseToml(content: string): StellarToml {
    const result: StellarToml = {
      currencies: [],
    };

    const lines = content.split("\n");
    let currentSection = "";
    let currentCurrency: StellarTomlCurrency | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      // Check for section headers
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        // Save previous currency if any
        if (currentCurrency && result.currencies) {
          result.currencies.push(currentCurrency);
          currentCurrency = null;
        }

        currentSection = trimmed.slice(1, -1);
        continue;
      }

      // Parse key-value pairs
      const equalIndex = trimmed.indexOf("=");
      if (equalIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, equalIndex).trim();
      let value = trimmed.slice(equalIndex + 1).trim();

      // Remove quotes from value
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      switch (currentSection) {
        case "version":
          result.version = value;
          break;
        case "account":
        case "accounts":
          if (!result.accouns) result.accouns = {};
          result.accouns[key] = value;
          break;
        case "currency":
        case "currencies":
          if (!currentCurrency) {
            currentCurrency = {
              code: key, // This is simplified - code should be the value
            };
          }
          // Handle special cases
          if (key === "code") {
            currentCurrency.code = value;
          } else if (key === "issuer") {
            currentCurrency.issuer = value;
          } else if (key === "status") {
            currentCurrency.status = value;
          } else if (key === "display_name") {
            currentCurrency.display_name = value;
          } else if (key === "name") {
            currentCurrency.name = value;
          } else if (key === "desc" || key === "description") {
            currentCurrency.desc = value;
          } else if (key === "conditions") {
            currentCurrency.conditions = value;
          } else if (key === "image") {
            currentCurrency.image = value;
          } else if (key === "fixed_addresses") {
            currentCurrency.fixed_addresses = value
              .split(",")
              .map((a) => a.trim());
          } else if (key === "anchoring_asset") {
            currentCurrency.anchoring_asset = value;
          } else if (key === "redemption") {
            currentCurrency.redemption = value;
          } else if (key === "collateral") {
            currentCurrency.collateral = value.split(",").map((a) => a.trim());
          }
          break;
        case "client":
          if (!result.client) result.client = {};
          if (key === "version") result.client.version = value;
          if (key === "current_protocol_version")
            result.client.currentProtocolVersion = value;
          if (key === "required_protocol_version")
            result.client.requiredProtocolVersion = value;
          break;
        case "issuer":
          if (!result.issuer) result.issuer = {};
          if (key === "distribute") result.issuer.distribute = value === "true";
          if (key === "allow_addl_issuance")
            result.issuer.allow_addl_issuance = value === "true";
          if (key === "seed") result.issuer.seed = value;
          if (key === "signature") result.issuer.signature = value;
          break;
        default:
          if (!currentSection) {
            if (key === "SIGNING_KEY") result.signingKey = value;
            if (key === "HOME_DOMAIN") result.homeDomain = value;
          }
      }
    }

    // Save last currency if any
    if (currentCurrency && result.currencies) {
      result.currencies.push(currentCurrency);
    }

    return result;
  }

  /**
   * Try to resolve issuer domain from Horizon (simplified - in production use getKeyValue)
   * This is a placeholder - actual implementation would need Horizon API integration
   */
  private async resolveIssuerDomain(issuer: string): Promise<string | null> {
    // Common domain mappings for known issuers
    const knownIssuers: Record<string, string> = {
      GA5ZSEJYJ37T4D2R2F4VRTQ4M2H7DYN9VLQOXRK7GZ3S3L3L3L3L3L3: "stellar.org",
      GA7JTBKKR5EVW3DBL4P3D4S3V3K5J2P3D4S3V3K5J2P3D4S3V3K5J: "stellar.org",
      GBGDUZBKVXY23P3IL4YBPMD5M5JWH3M4HRU42BC4JUL5V6A6Q6Q6Q: "bitstamp.com",
    };

    // For now, return a placeholder domain
    // In production, this would query Horizon API or a different service
    return knownIssuers[issuer] || null;
  }
}

export const sep1Tool = new Sep1Tool();
