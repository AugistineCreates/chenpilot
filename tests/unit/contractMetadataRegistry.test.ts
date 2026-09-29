import { ContractMetadataRegistry } from "../../src/services/contracts";

describe("ContractMetadataRegistry", () => {
  const previousEnv = process.env.CORE_VAULT_CONTRACT_ID;

  afterEach(() => {
    if (previousEnv === undefined) {
      delete process.env.CORE_VAULT_CONTRACT_ID;
    } else {
      process.env.CORE_VAULT_CONTRACT_ID = previousEnv;
    }
  });

  it("discovers contracts and capabilities without hardcoded consumers", () => {
    const registry = new ContractMetadataRegistry();

    const swapContracts = registry.findByCapability("swap.routing", "testnet");

    expect(swapContracts).toHaveLength(1);
    expect(swapContracts[0].key).toBe("multi_hop_swap");
    expect(swapContracts[0].capabilities[0].methods).toContain("swap");
  });

  it("resolves environment bindings from configured contract ids", () => {
    process.env.CORE_VAULT_CONTRACT_ID = "CCOREVAULT";
    const registry = new ContractMetadataRegistry();

    const binding = registry.getBinding("core_vault", "testnet");

    expect(binding).toEqual(
      expect.objectContaining({
        environment: "testnet",
        address: "CCOREVAULT",
        enabled: true,
      })
    );
  });

  it("marks bindings disabled when an environment has no address", () => {
    delete process.env.CORE_VAULT_CONTRACT_ID;
    const registry = new ContractMetadataRegistry();

    const binding = registry.getBinding("core_vault", "testnet");

    expect(binding?.enabled).toBe(false);
    expect(binding?.address).toBeUndefined();
  });

  describe("validateSpecFreshness", () => {
    it("rejects stale specification hash", () => {
      const registry = new ContractMetadataRegistry([
        {
          key: "test_contract",
          displayName: "Test Contract",
          version: "1.0.0",
          sourcePath: "contracts/test",
          envAddressKey: "TEST_CONTRACT_ID",
          capabilities: [],
          specHash: "abc123correcthash",
        } as any,
      ]);

      const result = registry.validateSpecFreshness(
        "test_contract",
        "xyz789wronghash"
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Stale interface specification");
      expect(result.error).toContain("abc123correcthash");
      expect(result.error).toContain("xyz789wronghash");
    });

    it("accepts matching specification hash", () => {
      const registry = new ContractMetadataRegistry([
        {
          key: "test_contract",
          displayName: "Test Contract",
          version: "1.0.0",
          sourcePath: "contracts/test",
          envAddressKey: "TEST_CONTRACT_ID",
          capabilities: [],
          specHash: "abc123correcthash",
        } as any,
      ]);

      const result = registry.validateSpecFreshness(
        "test_contract",
        "abc123correcthash"
      );

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("rejects unknown contract key", () => {
      const registry = new ContractMetadataRegistry();

      const result = registry.validateSpecFreshness(
        "nonexistent_contract",
        "anyhash"
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("not found in registry");
    });

    it("rejects contract with no registered spec hash", () => {
      const registry = new ContractMetadataRegistry([
        {
          key: "test_contract",
          displayName: "Test Contract",
          version: "1.0.0",
          sourcePath: "contracts/test",
          envAddressKey: "TEST_CONTRACT_ID",
          capabilities: [],
        } as any,
      ]);

      const result = registry.validateSpecFreshness("test_contract", "anyhash");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("no registered specification hash");
    });
  });
});
