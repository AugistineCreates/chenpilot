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
});
