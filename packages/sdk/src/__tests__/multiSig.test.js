"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const multiSig_1 = require("../multiSig");
const types_1 = require("../types");
describe("MultiSigBuilder", () => {
  const masterAccount = "GMASTER123456789";
  const signer1 = "GSIGNER1ABCDEFGH";
  const signer2 = "GSIGNER2IJKLMNOP";
  const signer3 = "GSIGNER3QRSTUVWX";
  describe("constructor", () => {
    it("should create a builder with master account", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      const config = builder.getConfig();
      expect(config.masterAccount).toBe(masterAccount);
      expect(config.signers).toEqual([]);
      expect(config.thresholds).toEqual({ low: 0, medium: 0, high: 0 });
    });
    it("should accept custom options", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount, {
        autoValidate: false,
        allowDuplicates: true,
        maxSigners: 10,
      });
      expect(builder).toBeDefined();
    });
  });
  describe("addSigner", () => {
    it("should add a signer with valid weight", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.addSigner(signer1, 10);
      const config = builder.getConfig();
      expect(config.signers).toHaveLength(1);
      expect(config.signers[0]).toEqual({ address: signer1, weight: 10 });
    });
    it("should throw error for weight < 0", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      expect(() => builder.addSigner(signer1, -1)).toThrow(
        "Signer weight must be between 0 and 255"
      );
    });
    it("should throw error for weight > 255", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      expect(() => builder.addSigner(signer1, 256)).toThrow(
        "Signer weight must be between 0 and 255"
      );
    });
    it("should throw error for duplicate signer by default", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.addSigner(signer1, 10);
      expect(() => builder.addSigner(signer1, 20)).toThrow(
        `Signer ${signer1} already exists`
      );
    });
    it("should allow duplicate signers when configured", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount, {
        allowDuplicates: true,
      });
      builder.addSigner(signer1, 10);
      builder.addSigner(signer1, 20);
      const config = builder.getConfig();
      expect(config.signers).toHaveLength(2);
    });
    it("should support method chaining", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      const result = builder.addSigner(signer1, 10);
      expect(result).toBe(builder);
    });
  });
  describe("addSigners", () => {
    it("should add multiple signers at once", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.addSigners([
        { address: signer1, weight: 10 },
        { address: signer2, weight: 20 },
        { address: signer3, weight: 30 },
      ]);
      const config = builder.getConfig();
      expect(config.signers).toHaveLength(3);
    });
  });
  describe("removeSigner", () => {
    it("should remove an existing signer", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.addSigner(signer1, 10);
      builder.addSigner(signer2, 20);
      builder.removeSigner(signer1);
      const config = builder.getConfig();
      expect(config.signers).toHaveLength(1);
      expect(config.signers[0].address).toBe(signer2);
    });
    it("should handle removing non-existent signer", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.addSigner(signer1, 10);
      builder.removeSigner(signer2);
      const config = builder.getConfig();
      expect(config.signers).toHaveLength(1);
    });
  });
  describe("updateSignerWeight", () => {
    it("should update weight of existing signer", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.addSigner(signer1, 10);
      builder.updateSignerWeight(signer1, 25);
      const config = builder.getConfig();
      expect(config.signers[0].weight).toBe(25);
    });
    it("should throw error for non-existent signer", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      expect(() => builder.updateSignerWeight(signer1, 10)).toThrow(
        `Signer ${signer1} not found`
      );
    });
    it("should throw error for invalid weight", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.addSigner(signer1, 10);
      expect(() => builder.updateSignerWeight(signer1, 300)).toThrow(
        "Signer weight must be between 0 and 255"
      );
    });
  });
  describe("setThreshold", () => {
    it("should set threshold for a category", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.setThreshold(types_1.ThresholdCategory.MEDIUM, 15);
      const config = builder.getConfig();
      expect(config.thresholds.medium).toBe(15);
    });
    it("should throw error for threshold < 0", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      expect(() =>
        builder.setThreshold(types_1.ThresholdCategory.LOW, -1)
      ).toThrow("Threshold must be between 0 and 255");
    });
    it("should throw error for threshold > 255", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      expect(() =>
        builder.setThreshold(types_1.ThresholdCategory.HIGH, 256)
      ).toThrow("Threshold must be between 0 and 255");
    });
  });
  describe("setThresholds", () => {
    it("should set multiple thresholds at once", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.setThresholds({ low: 5, medium: 10, high: 15 });
      const config = builder.getConfig();
      expect(config.thresholds).toEqual({ low: 5, medium: 10, high: 15 });
    });
    it("should set partial thresholds", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.setThresholds({ medium: 10 });
      const config = builder.getConfig();
      expect(config.thresholds).toEqual({ low: 0, medium: 10, high: 0 });
    });
  });
  describe("validate", () => {
    it("should validate a correct configuration", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.addSigner(signer1, 10);
      builder.addSigner(signer2, 20);
      builder.setThresholds({ low: 5, medium: 15, high: 25 });
      const result = builder.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    it("should detect missing master account", () => {
      const builder = new multiSig_1.MultiSigBuilder("");
      const result = builder.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Master account address is required");
    });
    it("should warn about no signers", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      const result = builder.validate();
      expect(result.warnings).toContain("No signers configured");
    });
    it("should detect threshold exceeding total weight", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.addSigner(signer1, 10);
      builder.setThreshold(types_1.ThresholdCategory.MEDIUM, 20);
      const result = builder.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Medium threshold (20) exceeds total weight (10)"
      );
    });
    it("should warn about threshold ordering", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.addSigner(signer1, 50);
      builder.setThresholds({ low: 20, medium: 10, high: 30 });
      const result = builder.validate();
      expect(result.warnings).toContain(
        "Medium threshold is lower than low threshold"
      );
    });
    it("should warn about zero-weight signers", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.addSigner(signer1, 0);
      builder.addSigner(signer2, 10);
      const result = builder.validate();
      expect(result.warnings).toContain("1 signer(s) have zero weight");
    });
    it("should detect too many signers", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount, {
        maxSigners: 2,
      });
      builder.addSigner(signer1, 10);
      builder.addSigner(signer2, 10);
      builder.addSigner(signer3, 10);
      const result = builder.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Too many signers: 3 (max: 2)");
    });
  });
  describe("build", () => {
    it("should build a valid configuration", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.addSigner(signer1, 10);
      builder.addSigner(signer2, 20);
      builder.setThresholds({ low: 5, medium: 15, high: 25 });
      const result = builder.build();
      expect(result.config.masterAccount).toBe(masterAccount);
      expect(result.config.signers).toHaveLength(2);
      expect(result.validation.valid).toBe(true);
      expect(result.estimatedFee).toBeGreaterThan(0);
    });
    it("should throw error for invalid config when autoValidate is true", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.addSigner(signer1, 10);
      builder.setThreshold(types_1.ThresholdCategory.HIGH, 50);
      expect(() => builder.build()).toThrow("Invalid multi-sig configuration");
    });
    it("should not throw error when autoValidate is false", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount, {
        autoValidate: false,
      });
      builder.addSigner(signer1, 10);
      builder.setThreshold(types_1.ThresholdCategory.HIGH, 50);
      const result = builder.build();
      expect(result.validation.valid).toBe(false);
    });
    it("should estimate fee based on number of operations", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.addSigner(signer1, 10);
      builder.addSigner(signer2, 20);
      const result = builder.build();
      // 1 threshold operation + 2 signer operations = 3 * 100 = 300 stroops
      expect(result.estimatedFee).toBe(300);
    });
  });
  describe("reset", () => {
    it("should reset builder to initial state", () => {
      const builder = new multiSig_1.MultiSigBuilder(masterAccount);
      builder.addSigner(signer1, 10);
      builder.setThreshold(types_1.ThresholdCategory.MEDIUM, 5);
      builder.reset();
      const config = builder.getConfig();
      expect(config.signers).toHaveLength(0);
      expect(config.thresholds).toEqual({ low: 0, medium: 0, high: 0 });
      expect(config.masterAccount).toBe(masterAccount);
    });
  });
  describe("createPreset", () => {
    it("should create 2-of-3 preset", () => {
      const builder = multiSig_1.MultiSigBuilder.createPreset(
        "2-of-3",
        masterAccount,
        [signer1, signer2, signer3]
      );
      const config = builder.getConfig();
      expect(config.signers).toHaveLength(3);
      expect(config.thresholds.medium).toBe(2);
    });
    it("should create 3-of-5 preset", () => {
      const signers = [signer1, signer2, signer3, "SIGNER4", "SIGNER5"];
      const builder = multiSig_1.MultiSigBuilder.createPreset(
        "3-of-5",
        masterAccount,
        signers
      );
      const config = builder.getConfig();
      expect(config.signers).toHaveLength(5);
      expect(config.thresholds.medium).toBe(3);
    });
    it("should create majority preset", () => {
      const builder = multiSig_1.MultiSigBuilder.createPreset(
        "majority",
        masterAccount,
        [signer1, signer2, signer3]
      );
      const config = builder.getConfig();
      expect(config.signers).toHaveLength(3);
      expect(config.thresholds.medium).toBe(2); // ceil(3/2)
    });
    it("should create unanimous preset", () => {
      const builder = multiSig_1.MultiSigBuilder.createPreset(
        "unanimous",
        masterAccount,
        [signer1, signer2, signer3]
      );
      const config = builder.getConfig();
      expect(config.signers).toHaveLength(3);
      expect(config.thresholds.medium).toBe(3);
      expect(config.thresholds.high).toBe(3);
    });
    it("should throw error for 2-of-3 with wrong number of signers", () => {
      expect(() =>
        multiSig_1.MultiSigBuilder.createPreset("2-of-3", masterAccount, [
          signer1,
          signer2,
        ])
      ).toThrow("2-of-3 preset requires exactly 3 signers");
    });
  });
});
describe("validateMultiSigConfig", () => {
  it("should validate a configuration object", () => {
    const config = {
      masterAccount: "GMASTER123",
      signers: [
        { address: "GSIGNER1", weight: 10 },
        { address: "GSIGNER2", weight: 20 },
      ],
      thresholds: { low: 5, medium: 15, high: 25 },
    };
    const result = (0, multiSig_1.validateMultiSigConfig)(config);
    expect(result.valid).toBe(true);
  });
  it("should detect invalid configuration", () => {
    const config = {
      masterAccount: "GMASTER123",
      signers: [{ address: "GSIGNER1", weight: 10 }],
      thresholds: { low: 5, medium: 15, high: 50 },
    };
    const result = (0, multiSig_1.validateMultiSigConfig)(config);
    expect(result.valid).toBe(false);
  });
});
describe("calculateTotalWeight", () => {
  it("should calculate total weight of all signers", () => {
    const config = {
      masterAccount: "GMASTER123",
      signers: [
        { address: "GSIGNER1", weight: 10 },
        { address: "GSIGNER2", weight: 20 },
        { address: "GSIGNER3", weight: 15 },
      ],
      thresholds: { low: 0, medium: 0, high: 0 },
    };
    const total = (0, multiSig_1.calculateTotalWeight)(config);
    expect(total).toBe(45);
  });
  it("should return 0 for no signers", () => {
    const config = {
      masterAccount: "GMASTER123",
      signers: [],
      thresholds: { low: 0, medium: 0, high: 0 },
    };
    const total = (0, multiSig_1.calculateTotalWeight)(config);
    expect(total).toBe(0);
  });
});
describe("canMeetThreshold", () => {
  const config = {
    masterAccount: "GMASTER123",
    signers: [
      { address: "GSIGNER1", weight: 10 },
      { address: "GSIGNER2", weight: 20 },
      { address: "GSIGNER3", weight: 15 },
    ],
    thresholds: { low: 5, medium: 25, high: 40 },
  };
  it("should return true when signers can meet threshold", () => {
    const result = (0, multiSig_1.canMeetThreshold)(
      ["GSIGNER1", "GSIGNER2"],
      config,
      25
    );
    expect(result).toBe(true);
  });
  it("should return false when signers cannot meet threshold", () => {
    const result = (0, multiSig_1.canMeetThreshold)(["GSIGNER1"], config, 25);
    expect(result).toBe(false);
  });
  it("should handle non-existent signers", () => {
    const result = (0, multiSig_1.canMeetThreshold)(
      ["GSIGNER1", "NONEXISTENT"],
      config,
      25
    );
    expect(result).toBe(false);
  });
  it("should return true for zero threshold", () => {
    const result = (0, multiSig_1.canMeetThreshold)([], config, 0);
    expect(result).toBe(true);
  });
});
