import * as StellarSdk from "@stellar/stellar-sdk";

describe("Stellar Wallet Operations", () => {
  it("should generate a new Stellar account (Signup flow)", () => {
    // Uses the mocked Keypair.random()
    const pair = StellarSdk.Keypair.random();

    expect(pair.publicKey()).toBe("GD77MOCKPUBLICKEY1234567890");
    expect(StellarSdk.Keypair.random).toHaveBeenCalled();
  });

  it("should retrieve balances for a Stellar account", async () => {
    // Note: We use the .Horizon namespace to match the latest SDK structure
    const server = new StellarSdk.Horizon.Server(
      "https://horizon-testnet.stellar.org"
    );
    const account = await server.loadAccount("GD77MOCKPUBLICKEY1234567890");

    expect(account.balances).toContainEqual(
      expect.objectContaining({
        asset_type: "native",
        balance: "100.0000",
      })
    );
    expect(server.loadAccount).toHaveBeenCalledWith(
      "GD77MOCKPUBLICKEY1234567890"
    );
  });
});
