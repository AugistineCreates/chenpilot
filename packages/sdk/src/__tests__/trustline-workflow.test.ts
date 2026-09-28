import { Asset, Operation, Keypair, Account, Networks } from "stellar-sdk";
import {
  TrustlineWorkflowBuilder,
  TrustlineWorkflowStep,
  AssetToTrust,
} from "../trustline";

jest.mock("stellar-sdk", () => {
  const original = jest.requireActual("stellar-sdk");
  return {
    ...original,
    Server: jest.fn().mockImplementation(() => ({
      accounts: () => ({
        accountId: (id: string) => ({
          call: jest.fn().mockResolvedValue({
            balances: [
              { asset_type: "native", balance: "100" },
              { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "GSPONSOR", balance: "10" },
            ],
          }),
        }),
      }),
    })),
    Horizon: {
      Server: jest.fn().mockImplementation(() => ({
        accounts: () => ({
          accountId: (id: string) => ({
            call: jest.fn().mockResolvedValue({
              balances: [
                { asset_type: "native", balance: "100" },
                { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "GSPONSOR", balance: "10" },
              ],
            }),
          }),
        }),
      })),
    },
    TransactionBuilder: original.TransactionBuilder,
    Account: original.Account,
    Networks: original.Networks,
    BASE_FEE: "100",
  };
});

describe("checkAccountMergeBlockers", () => {
  const mockCall = jest.fn();
  const mockOffers = jest.fn();
  const mockServerInstance: any = {
    accounts: () => ({ accountId: () => ({ call: mockCall }) }),
    offers: () => ({
      forAccount: () => ({
        limit: () => ({
          call: mockOffers,
        }),
      }),
    }),
  };

  beforeAll(() => {
    (require("stellar-sdk").Server as jest.Mock).mockImplementation(
      () => mockServerInstance
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reports no blockers when account is merge-ready", async () => {
    const { checkAccountMergeBlockers } = await import("../trustline");
    mockCall.mockResolvedValueOnce({
      id: "GTEST",
      balances: [{ asset_type: "native", balance: "100" }],
      data: {},
      signers: [{ key: "GTEST", weight: 1 }],
    });
    mockOffers.mockResolvedValueOnce({ records: [] });

    const result = await checkAccountMergeBlockers(undefined, "GTEST");

    expect(result.canMerge).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("reports non-zero trustline blockers with cleanup instructions", async () => {
    const { checkAccountMergeBlockers } = await import("../trustline");
    mockCall.mockResolvedValueOnce({
      balances: [
        { asset_type: "native", balance: "100" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GISSUER",
          balance: "50.5",
        },
      ],
      data: {},
      signers: [{ key: "GTEST", weight: 1 }],
    });
    mockOffers.mockResolvedValueOnce({ records: [] });

    const result = await checkAccountMergeBlockers(undefined, "GTEST");

    expect(result.canMerge).toBe(false);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].type).toBe("trustline");
    expect(result.blockers[0].description).toContain("non-zero balance");
    expect(result.blockers[0].cleanupInstructions).toContain(
      "Send all asset balances"
    );
    expect(result.blockers[0].affectedItems).toContain("USDC:GISSUER");
  });

  it("reports zero-balance trustline blockers with removal instructions", async () => {
    const { checkAccountMergeBlockers } = await import("../trustline");
    mockCall.mockResolvedValueOnce({
      balances: [
        { asset_type: "native", balance: "100" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "EMPTY",
          asset_issuer: "GISSUER",
          balance: "0",
        },
      ],
      data: {},
      signers: [{ key: "GTEST", weight: 1 }],
    });
    mockOffers.mockResolvedValueOnce({ records: [] });

    const result = await checkAccountMergeBlockers(undefined, "GTEST");

    expect(result.canMerge).toBe(false);
    expect(result.blockers[0].type).toBe("trustline");
    expect(result.blockers[0].cleanupInstructions).toContain("changeTrust");
    expect(result.blockers[0].affectedItems).toContain("EMPTY:GISSUER");
  });

  it("reports data entry blockers", async () => {
    const { checkAccountMergeBlockers } = await import("../trustline");
    mockCall.mockResolvedValueOnce({
      balances: [{ asset_type: "native", balance: "100" }],
      data: { config: "base64data", metadata: "base64data" },
      signers: [{ key: "GTEST", weight: 1 }],
    });
    mockOffers.mockResolvedValueOnce({ records: [] });

    const result = await checkAccountMergeBlockers(undefined, "GTEST");

    expect(result.canMerge).toBe(false);
    const dataBlocker = result.blockers.find((b) => b.type === "data_entry");
    expect(dataBlocker).toBeDefined();
    expect(dataBlocker!.cleanupInstructions).toContain("manageData");
    expect(dataBlocker!.affectedItems).toContain("config");
  });

  it("reports open offer blockers", async () => {
    const { checkAccountMergeBlockers } = await import("../trustline");
    mockCall.mockResolvedValueOnce({
      balances: [{ asset_type: "native", balance: "100" }],
      data: {},
      signers: [{ key: "GTEST", weight: 1 }],
    });
    mockOffers.mockResolvedValueOnce({
      records: [{ id: "12345" }, { id: "67890" }],
    });

    const result = await checkAccountMergeBlockers(undefined, "GTEST");

    expect(result.canMerge).toBe(false);
    const offerBlocker = result.blockers.find((b) => b.type === "offers");
    expect(offerBlocker).toBeDefined();
    expect(offerBlocker!.cleanupInstructions).toContain("manageSellOffer");
    expect(offerBlocker!.affectedItems).toHaveLength(2);
  });

  it("reports additional signer blockers", async () => {
    const { checkAccountMergeBlockers } = await import("../trustline");
    mockCall.mockResolvedValueOnce({
      id: "GTEST",
      balances: [{ asset_type: "native", balance: "100" }],
      data: {},
      signers: [
        { key: "GTEST", weight: 1 },
        { key: "GSIGNER2", weight: 1 },
      ],
    });
    mockOffers.mockResolvedValueOnce({ records: [] });

    const result = await checkAccountMergeBlockers(undefined, "GTEST");

    expect(result.canMerge).toBe(false);
    const signerBlocker = result.blockers.find((b) => b.type === "signers");
    expect(signerBlocker).toBeDefined();
    expect(signerBlocker!.cleanupInstructions).toContain("setOptions");
    expect(signerBlocker!.affectedItems).toContain("GSIGNER2");
  });

  it("reports multiple blocker types simultaneously", async () => {
    const { checkAccountMergeBlockers } = await import("../trustline");
    mockCall.mockResolvedValueOnce({
      id: "GTEST",
      balances: [
        { asset_type: "native", balance: "100" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GISSUER",
          balance: "0",
        },
      ],
      data: { key1: "value1" },
      signers: [
        { key: "GTEST", weight: 1 },
        { key: "GSIGNER2", weight: 1 },
      ],
    });
    mockOffers.mockResolvedValueOnce({ records: [{ id: "12345" }] });

    const result = await checkAccountMergeBlockers(undefined, "GTEST");

    expect(result.canMerge).toBe(false);
    expect(result.blockers.length).toBeGreaterThanOrEqual(3);
  });
});

describe("TrustlineWorkflowBuilder", () => {
  describe("constructor", () => {
    it("should initialize with default values", () => {
      const builder = new TrustlineWorkflowBuilder();
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.IDLE);
    });

    it("should initialize with custom config", () => {
      const builder = new TrustlineWorkflowBuilder({
        source: "GTEST",
        networkPassphrase: Networks.TESTNET,
      });
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.IDLE);
    });
  });

  describe("addTrustline", () => {
    it("should add a single trustline and update step", () => {
      const builder = new TrustlineWorkflowBuilder();
      builder.addTrustline("USDC", "GAIssuer");
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.BUILDING);
    });

    it("should add multiple trustlines", () => {
      const builder = new TrustlineWorkflowBuilder();
      builder.addTrustline("USDC", "GAIssuer1");
      builder.addTrustline("EURT", "GAIssuer2");
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.BUILDING);
    });
  });

  describe("addTrustlines", () => {
    it("should add multiple trustlines at once", () => {
      const builder = new TrustlineWorkflowBuilder();
      const assets: AssetToTrust[] = [
        { assetCode: "USDC", assetIssuer: "GAIssuer1" },
        { assetCode: "EURT", assetIssuer: "GAIssuer2", limit: "1000" },
      ];
      builder.addTrustlines(assets);
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.BUILDING);
    });
  });

  describe("addTrustlineRemoval", () => {
    it("should add a trustline removal and update step", () => {
      const builder = new TrustlineWorkflowBuilder();
      builder.addTrustlineRemoval("USDC", "GAIssuer");
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.BUILDING);
    });
  });

  describe("preview", () => {
    it("should generate preview with operations", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: "GSOURCE" });
      builder.addTrustline("USDC", "GAIssuer");
      const preview = await builder.preview();

      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.PREVIEWING);
      expect(preview.operations).toHaveLength(1);
      expect(preview.sourceAccount).toBe("GSOURCE");
    });

    it("should include trustline removals in preview", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: "GSOURCE" });
      builder.addTrustline("USDC", "GAIssuer");
      builder.addTrustlineRemoval("EURT", "GIssuer2");
      const preview = await builder.preview();

      expect(preview.operations).toHaveLength(2);
    });
  });

  describe("validate", () => {
    it("should validate successfully with source account provided", async () => {
      const builder = new TrustlineWorkflowBuilder({
        source: "GSOURCE",
        horizonUrl: "https://horizon.stellar.org",
      });
      builder.addTrustline("USDC", "GAIssuer");
      const validation = await builder.validate();

      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.VALIDATING);
      expect(validation.valid).toBe(true);
      expect(validation.accountExists).toBe(true);
    });

    it("should return errors when source account is missing", async () => {
      const builder = new TrustlineWorkflowBuilder();
      builder.addTrustline("USDC", "GAIssuer");
      const validation = await builder.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Source account is required for validation");
    });

    it("should warn about existing trustlines", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: "GSOURCE" });
      builder.addTrustline("USDC", "GSPONSOR");
      const validation = await builder.validate();

      expect(validation.warnings.length).toBeGreaterThan(0);
    });

    it("should warn about invalid issuer format", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: "GSOURCE" });
      builder.addTrustline("USDC", "not-an-issuer");
      const validation = await builder.validate();

      expect(validation.warnings.some((w) => w.includes("issuer"))).toBe(true);
    });
  });

  describe("estimate", () => {
    it("should estimate resource costs", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: "GSOURCE" });
      builder.addTrustline("USDC", "GAIssuer");
      builder.addTrustline("EURT", "GIssuer2");
      builder.addTrustlineRemoval("OLD", "GOLDIssuer");

      const preview = await builder.preview();
      const estimate = builder.estimate(preview);

      expect(estimate.operationCount).toBe(3);
      expect(estimate.trustlinesCreated).toBe(2);
      expect(estimate.trustlinesRemoved).toBe(1);
    });
  });

  describe("build", () => {
    it("should build workflow result", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: "GSOURCE" });
      builder.addTrustline("USDC", "GAIssuer");
      const result = await builder.build();

      expect(result.transactionXdr).toBeDefined();
      expect(result.operations).toHaveLength(1);
      expect(result.resourceEstimate).toBeDefined();
    });
  });
});