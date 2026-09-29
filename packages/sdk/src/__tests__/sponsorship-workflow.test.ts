import { Keypair, Networks, Asset } from "stellar-sdk";
import {
  SponsorshipWorkflowBuilder,
  SponsorshipWorkflowStep,
} from "../sponsorship";

jest.mock("stellar-sdk", () => {
  const original = jest.requireActual("stellar-sdk");
  return {
    ...original,
    Horizon: {
      Server: jest.fn().mockImplementation(() => ({
        accounts: () => ({
          accountId: (id: string) => ({
            call: jest.fn().mockImplementation((accountId: string) => {
              if (accountId === "GSPONSOR") {
                return Promise.resolve({ balances: [] });
              }
              return Promise.reject(new Error("Not found"));
            }),
          }),
        }),
      })),
    },
    TransactionBuilder: original.TransactionBuilder,
    Account: original.Account,
    Networks: original.Networks,
    BASE_FEE: "100",
    Asset: original.Asset,
    Operation: original.Operation,
    Memo: original.Memo,
  };
});

describe("SponsorshipWorkflowBuilder", () => {
  describe("constructor", () => {
    it("should initialize with default values", () => {
      const builder = new SponsorshipWorkflowBuilder();
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.IDLE);
    });

    it("should initialize with custom config", () => {
      const builder = new SponsorshipWorkflowBuilder({
        sponsor: "GSPONSOR",
        sponsoredAccount: "GSPONSORED",
      });
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.IDLE);
    });
  });

  describe("setSponsoredAccount", () => {
    it("should set sponsored account and update step", () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.setSponsoredAccount("GSPONSORED");
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.BUILDING);
    });
  });

  describe("addTrustline", () => {
    it("should add trustline for sponsored account", () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.setSponsoredAccount("GSPONSORED");
      builder.addTrustline("USDC", "GAIssuer");
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.BUILDING);
    });

    it("should add multiple trustlines via addTrustlines", () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.setSponsoredAccount("GSPONSORED");
      builder.addTrustlines([
        { assetCode: "USDC", assetIssuer: "GAIssuer1" },
        { assetCode: "EURT", assetIssuer: "GAIssuer2" },
      ]);
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.BUILDING);
    });
  });

  describe("addCreateAccount", () => {
    it("should set account creation flag", () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.addCreateAccount("GNEWACCOUNT");
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.BUILDING);
    });
  });

  describe("addManageData", () => {
    it("should add managed data entry", () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.setSponsoredAccount("GSPONSORED");
      builder.addManageData("key", "value");
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.BUILDING);
    });

    it("should allow null value for data removal", () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.setSponsoredAccount("GSPONSORED");
      builder.addManageData("key", null);
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.BUILDING);
    });
  });

  describe("addPayment", () => {
    it("should add payment operation", () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.setSponsoredAccount("GSPONSORED");
      builder.addPayment("GDEST", "100");
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.BUILDING);
    });

    it("should add payment with custom asset", () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.setSponsoredAccount("GSPONSORED");
      builder.addPayment("GDEST", "100", new Asset("USDC", "GAIssuer"));
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.BUILDING);
    });
  });

  describe("preview", () => {
    it("should generate empty preview without accounts", async () => {
      const builder = new SponsorshipWorkflowBuilder();
      const preview = await builder.preview();

      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.PREVIEWING);
      expect(preview.operations).toHaveLength(0);
    });

    it("should generate preview with trustline operations", async () => {
      const builder = new SponsorshipWorkflowBuilder({
        sponsor: "GSPONSOR",
        sponsoredAccount: "GSPONSORED",
      });
      builder.addTrustline("USDC", "GAIssuer");
      const preview = await builder.preview();

      expect(preview.operations.length).toBe(3); // begin, trustline, end
    });

    it("should include create account in preview", async () => {
      const builder = new SponsorshipWorkflowBuilder({ sponsor: "GSPONSOR" });
      builder.addCreateAccount("GNEW");
      const preview = await builder.preview();

      expect(preview.operations.length).toBe(2); // begin, create account
    });

    it("should include manage data in preview", async () => {
      const builder = new SponsorshipWorkflowBuilder({
        sponsor: "GSPONSOR",
        sponsoredAccount: "GSPONSORED",
      });
      builder.addManageData("key", "value");
      const preview = await builder.preview();

      expect(preview.operations.some((op) => op.type === "manageData")).toBe(true);
    });

    it("should include payment in preview", async () => {
      const builder = new SponsorshipWorkflowBuilder({
        sponsor: "GSPONSOR",
        sponsoredAccount: "GSPONSORED",
      });
      builder.addPayment("GDEST", "100");
      const preview = await builder.preview();

      expect(preview.operations.some((op) => op.type === "payment")).toBe(true);
    });
  });

  describe("validate", () => {
    it("should validate successfully with valid sponsor", async () => {
      const builder = new SponsorshipWorkflowBuilder({ sponsor: "GSPONSOR" });
      builder.setSponsoredAccount("GSPONSORED");
      builder.addTrustline("USDC", "GAIssuer");
      const validation = await builder.validate();

      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.VALIDATING);
      expect(validation.sponsorExists).toBe(true);
      expect(validation.valid).toBe(true);
    });

    it("should return errors when sponsor is missing", async () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.setSponsoredAccount("GSPONSORED");
      const validation = await builder.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Sponsor account is required");
    });

    it("should return errors when sponsored account is missing", async () => {
      const builder = new SponsorshipWorkflowBuilder({ sponsor: "GSPONSOR" });
      const validation = await builder.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Sponsored account is required");
    });

    it("should warn about invalid issuer format", async () => {
      const builder = new SponsorshipWorkflowBuilder({ sponsor: "GSPONSOR" });
      builder.setSponsoredAccount("GSPONSORED");
      builder.addTrustline("USDC", "not-an-issuer");
      const validation = await builder.validate();

      expect(validation.warnings.some((w) => w.includes("issuer"))).toBe(true);
    });
  });

  describe("estimate", () => {
    it("should estimate resource costs", async () => {
      const builder = new SponsorshipWorkflowBuilder({
        sponsor: "GSPONSOR",
        sponsoredAccount: "GSPONSORED",
      });
      builder.addTrustline("USDC", "GAIssuer");
      builder.addTrustline("EURT", "GIssuer2");
      builder.addManageData("key", "value");

      const preview = await builder.preview();
      const estimate = builder.estimate(preview);

      expect(estimate.operationCount).toBeGreaterThan(0);
      expect(estimate.reservesToSponsor).toBeGreaterThan(0);
    });

    it("should count createAccount toward reserves", async () => {
      const builder = new SponsorshipWorkflowBuilder({ sponsor: "GSPONSOR" });
      builder.addCreateAccount("GNEW");
      const preview = await builder.preview();
      const estimate = builder.estimate(preview);

      expect(estimate.reservesToSponsor).toBeGreaterThanOrEqual(1);
    });
  });

  describe("build", () => {
    it("should build workflow result", async () => {
      const builder = new SponsorshipWorkflowBuilder({
        sponsor: "GSPONSOR",
        sponsoredAccount: "GSPONSORED",
      });
      builder.addTrustline("USDC", "GAIssuer");
      const result = await builder.build();

      expect(result.transactionXdr).toBeDefined();
      expect(result.operations).toBeDefined();
      expect(result.resourceEstimate).toBeDefined();
    });
  });
});