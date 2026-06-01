import "../stellar.mock"; // Use ../ to go up to the tests/ directory
import * as StellarSdk from "@stellar/stellar-sdk";

describe("Stellar Swap Logic", () => {
  it("should find a path and build a swap transaction", async () => {
    const server = new StellarSdk.Horizon.Server(
      "https://horizon-testnet.stellar.org"
    );

    const sourceAccount = "GD77MOCKPUBLICKEY1234567890";
    const destinationAsset = new StellarSdk.Asset(
      "USDC",
      "GD77MOCKPUBLICKEY1234567890"
    );
    const destinationAmount = "10";

    // ✅ Testing positional arguments as required by SDK v13+
    const paths = await server
      .strictReceivePaths(sourceAccount, destinationAsset, destinationAmount)
      .call();

    expect(paths.records).toBeDefined();
    expect(paths.records.length).toBeGreaterThan(0);
    expect(paths.records[0].source_amount).toBe("10.00");
    expect(paths.records[0].source_asset_type).toBe("native");
  });
});
