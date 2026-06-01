"use strict";
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
      }
    : function (o, v) {
        o["default"] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o)
            if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== "default") __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
Object.defineProperty(exports, "__esModule", { value: true });
// Mock the TypeORM DataSource so the global setup.ts does not attempt a real DB connection.
jest.mock("../../src/config/Datasource", () => ({
  __esModule: true,
  default: {
    isInitialized: true,
    initialize: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
  },
}));
// Unmock Stellar SDK - we need the real implementation for XDR tests
jest.unmock("@stellar/stellar-sdk");
jest.unmock("stellar-sdk");
const StellarSdk = __importStar(require("@stellar/stellar-sdk"));
describe("XDR Envelope Builder - Complex Multi-Operation Transactions", () => {
  let sourceKeypair;
  let destinationKeypair;
  let sourceAccount;
  const networkPassphrase = StellarSdk.Networks.TESTNET;
  beforeEach(() => {
    // Generate test keypairs
    sourceKeypair = StellarSdk.Keypair.random();
    destinationKeypair = StellarSdk.Keypair.random();
    // Create a mock account with sequence number
    sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), "100");
  });
  describe("Multi-Operation Transaction Building", () => {
    it("should build valid XDR envelope with multiple payment operations", () => {
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "100",
          })
        )
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "50",
          })
        )
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "25",
          })
        )
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      // Verify XDR envelope is generated
      const xdr = transaction.toXDR();
      expect(xdr).toBeDefined();
      expect(typeof xdr).toBe("string");
      expect(xdr.length).toBeGreaterThan(0);
      // Verify transaction can be reconstructed from XDR
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.source).toBe(sourceKeypair.publicKey());
      expect(reconstructed.operations).toHaveLength(3);
      expect(reconstructed.operations[0].type).toBe("payment");
      expect(reconstructed.operations[1].type).toBe("payment");
      expect(reconstructed.operations[2].type).toBe("payment");
    });
    it("should build valid XDR envelope with mixed operation types", () => {
      const usdcAsset = new StellarSdk.Asset(
        "USDC",
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
      );
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "100",
          })
        )
        .addOperation(
          StellarSdk.Operation.changeTrust({
            asset: usdcAsset,
            limit: "10000",
          })
        )
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: usdcAsset,
            amount: "50",
          })
        )
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      expect(xdr).toBeDefined();
      // Verify transaction structure
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.operations).toHaveLength(3);
      expect(reconstructed.operations[0].type).toBe("payment");
      expect(reconstructed.operations[1].type).toBe("changeTrust");
      expect(reconstructed.operations[2].type).toBe("payment");
    });
    it("should build valid XDR envelope with path payment operations", () => {
      const usdcAsset = new StellarSdk.Asset(
        "USDC",
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
      );
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.pathPaymentStrictSend({
            sendAsset: StellarSdk.Asset.native(),
            sendAmount: "100",
            destination: destinationKeypair.publicKey(),
            destAsset: usdcAsset,
            destMin: "95",
          })
        )
        .addOperation(
          StellarSdk.Operation.pathPaymentStrictReceive({
            sendAsset: usdcAsset,
            sendMax: "110",
            destination: sourceKeypair.publicKey(),
            destAsset: StellarSdk.Asset.native(),
            destAmount: "100",
          })
        )
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      expect(xdr).toBeDefined();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.operations).toHaveLength(2);
      expect(reconstructed.operations[0].type).toBe("pathPaymentStrictSend");
      expect(reconstructed.operations[1].type).toBe("pathPaymentStrictReceive");
    });
  });
  describe("XDR Envelope Signature Handling", () => {
    it("should build XDR envelope with single signature", () => {
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "100",
          })
        )
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.signatures).toHaveLength(1);
      expect(reconstructed.signatures[0]).toBeDefined();
    });
    it("should build XDR envelope with multiple signatures", () => {
      const signer2 = StellarSdk.Keypair.random();
      const signer3 = StellarSdk.Keypair.random();
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "100",
          })
        )
        .setTimeout(30)
        .build();
      // Sign with multiple keypairs
      transaction.sign(sourceKeypair);
      transaction.sign(signer2);
      transaction.sign(signer3);
      const xdr = transaction.toXDR();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.signatures).toHaveLength(3);
    });
  });
  describe("XDR Envelope with Memos", () => {
    it("should build XDR envelope with text memo", () => {
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "100",
          })
        )
        .addMemo(StellarSdk.Memo.text("Payment for services"))
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.memo.type).toBe("text");
      expect(reconstructed.memo.value).toBe("Payment for services");
    });
    it("should build XDR envelope with hash memo", () => {
      const hash = Buffer.alloc(32);
      hash.fill(1);
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "100",
          })
        )
        .addMemo(StellarSdk.Memo.hash(hash))
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.memo.type).toBe("hash");
      expect(reconstructed.memo.value).toEqual(hash);
    });
    it("should build XDR envelope with ID memo", () => {
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "100",
          })
        )
        .addMemo(StellarSdk.Memo.id("123456789"))
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.memo.type).toBe("id");
      expect(reconstructed.memo.value).toBe("123456789");
    });
  });
  describe("Complex Multi-Operation Scenarios", () => {
    it("should build XDR envelope for account creation with funding and trustline setup", () => {
      const newAccount = StellarSdk.Keypair.random();
      const usdcAsset = new StellarSdk.Asset(
        "USDC",
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
      );
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.createAccount({
            destination: newAccount.publicKey(),
            startingBalance: "10",
          })
        )
        .addOperation(
          StellarSdk.Operation.changeTrust({
            source: newAccount.publicKey(),
            asset: usdcAsset,
            limit: "5000",
          })
        )
        .addOperation(
          StellarSdk.Operation.payment({
            destination: newAccount.publicKey(),
            asset: usdcAsset,
            amount: "100",
          })
        )
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      transaction.sign(newAccount); // New account must sign its own operations
      const xdr = transaction.toXDR();
      expect(xdr).toBeDefined();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.operations).toHaveLength(3);
      expect(reconstructed.operations[0].type).toBe("createAccount");
      expect(reconstructed.operations[1].type).toBe("changeTrust");
      expect(reconstructed.operations[2].type).toBe("payment");
      expect(reconstructed.signatures).toHaveLength(2);
    });
    it("should build XDR envelope for atomic swap with multiple assets", () => {
      const counterparty = StellarSdk.Keypair.random();
      const usdcAsset = new StellarSdk.Asset(
        "USDC",
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
      );
      const usdtAsset = new StellarSdk.Asset(
        "USDT",
        "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V"
      );
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            source: sourceKeypair.publicKey(),
            destination: counterparty.publicKey(),
            asset: usdcAsset,
            amount: "100",
          })
        )
        .addOperation(
          StellarSdk.Operation.payment({
            source: counterparty.publicKey(),
            destination: sourceKeypair.publicKey(),
            asset: usdtAsset,
            amount: "100",
          })
        )
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      transaction.sign(counterparty);
      const xdr = transaction.toXDR();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.operations).toHaveLength(2);
      expect(reconstructed.signatures).toHaveLength(2);
    });
    it("should build XDR envelope for liquidity pool operations", () => {
      const usdcAsset = new StellarSdk.Asset(
        "USDC",
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
      );
      const liquidityPoolId = StellarSdk.getLiquidityPoolId(
        "constant_product",
        {
          assetA: StellarSdk.Asset.native(),
          assetB: usdcAsset,
          fee: 30,
        }
      );
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.changeTrust({
            asset: new StellarSdk.LiquidityPoolAsset(
              StellarSdk.Asset.native(),
              usdcAsset,
              StellarSdk.LiquidityPoolFeeV18
            ),
            limit: "1000",
          })
        )
        .addOperation(
          StellarSdk.Operation.liquidityPoolDeposit({
            liquidityPoolId: liquidityPoolId.toString("hex"),
            maxAmountA: "100",
            maxAmountB: "100",
            minPrice: { n: 1, d: 1 },
            maxPrice: { n: 1, d: 1 },
          })
        )
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      expect(xdr).toBeDefined();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.operations).toHaveLength(2);
      expect(reconstructed.operations[0].type).toBe("changeTrust");
      expect(reconstructed.operations[1].type).toBe("liquidityPoolDeposit");
    });
    it("should build XDR envelope for account management operations", () => {
      const newSigner = StellarSdk.Keypair.random();
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.setOptions({
            signer: {
              ed25519PublicKey: newSigner.publicKey(),
              weight: 1,
            },
          })
        )
        .addOperation(
          StellarSdk.Operation.setOptions({
            masterWeight: 2,
            lowThreshold: 1,
            medThreshold: 2,
            highThreshold: 2,
          })
        )
        .addOperation(
          StellarSdk.Operation.setOptions({
            homeDomain: "example.com",
          })
        )
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.operations).toHaveLength(3);
      expect(reconstructed.operations[0].type).toBe("setOptions");
      expect(reconstructed.operations[1].type).toBe("setOptions");
      expect(reconstructed.operations[2].type).toBe("setOptions");
    });
    it("should build XDR envelope for offer management operations", () => {
      const usdcAsset = new StellarSdk.Asset(
        "USDC",
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
      );
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.manageSellOffer({
            selling: StellarSdk.Asset.native(),
            buying: usdcAsset,
            amount: "100",
            price: "0.5",
            offerId: "0", // 0 means create new offer
          })
        )
        .addOperation(
          StellarSdk.Operation.manageBuyOffer({
            selling: usdcAsset,
            buying: StellarSdk.Asset.native(),
            buyAmount: "50",
            price: "2",
            offerId: "0",
          })
        )
        .addOperation(
          StellarSdk.Operation.createPassiveSellOffer({
            selling: StellarSdk.Asset.native(),
            buying: usdcAsset,
            amount: "25",
            price: "0.48",
          })
        )
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.operations).toHaveLength(3);
      expect(reconstructed.operations[0].type).toBe("manageSellOffer");
      expect(reconstructed.operations[1].type).toBe("manageBuyOffer");
      expect(reconstructed.operations[2].type).toBe("createPassiveSellOffer");
    });
  });
  describe("XDR Envelope Fee and Timeout Handling", () => {
    it("should build XDR envelope with custom fee", () => {
      const customFee = "1000";
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: customFee,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "100",
          })
        )
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.fee).toBe(customFee);
    });
    it("should build XDR envelope with custom timeout", () => {
      const timeout = 300; // 5 minutes
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "100",
          })
        )
        .setTimeout(timeout)
        .build();
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      expect(xdr).toBeDefined();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.timeBounds).toBeDefined();
    });
    it("should build XDR envelope with multiple operations and proportional fee", () => {
      const operationCount = 5;
      const baseFee = parseInt(StellarSdk.BASE_FEE);
      const expectedFee = (baseFee * operationCount).toString();
      const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      });
      // Add multiple operations
      for (let i = 0; i < operationCount; i++) {
        builder.addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "10",
          })
        );
      }
      const transaction = builder.setTimeout(30).build();
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.operations).toHaveLength(operationCount);
      expect(reconstructed.fee).toBe(expectedFee);
    });
  });
  describe("XDR Envelope Validation", () => {
    it("should validate XDR envelope can be decoded and re-encoded", () => {
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "100",
          })
        )
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      const originalXdr = transaction.toXDR();
      const reconstructed = new StellarSdk.Transaction(
        originalXdr,
        networkPassphrase
      );
      const reEncodedXdr = reconstructed.toXDR();
      expect(reEncodedXdr).toBe(originalXdr);
    });
    it("should validate transaction hash remains consistent", () => {
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "100",
          })
        )
        .setTimeout(30)
        .build();
      const originalHash = transaction.hash().toString("hex");
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      const reconstructedHash = reconstructed.hash().toString("hex");
      expect(reconstructedHash).toBe(originalHash);
    });
    it("should validate XDR envelope with maximum operations (100)", () => {
      const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      });
      // Stellar allows up to 100 operations per transaction
      for (let i = 0; i < 100; i++) {
        builder.addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "1",
          })
        );
      }
      const transaction = builder.setTimeout(30).build();
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      expect(xdr).toBeDefined();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.operations).toHaveLength(100);
    });
  });
  describe("XDR Envelope with Claimable Balances", () => {
    it("should build XDR envelope with claimable balance creation and claim", () => {
      const claimant1 = destinationKeypair.publicKey();
      const claimant2 = StellarSdk.Keypair.random().publicKey();
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.createClaimableBalance({
            asset: StellarSdk.Asset.native(),
            amount: "100",
            claimants: [
              new StellarSdk.Claimant(claimant1),
              new StellarSdk.Claimant(
                claimant2,
                StellarSdk.Claimant.predicateBeforeRelativeTime("3600")
              ),
            ],
          })
        )
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
      expect(reconstructed.operations).toHaveLength(1);
      expect(reconstructed.operations[0].type).toBe("createClaimableBalance");
    });
  });
  describe("XDR Envelope Network Compatibility", () => {
    it("should build XDR envelope for testnet", () => {
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "100",
          })
        )
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      expect(xdr).toBeDefined();
      const reconstructed = new StellarSdk.Transaction(
        xdr,
        StellarSdk.Networks.TESTNET
      );
      expect(reconstructed.networkPassphrase).toBe(StellarSdk.Networks.TESTNET);
    });
    it("should build XDR envelope for mainnet", () => {
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.PUBLIC,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "100",
          })
        )
        .setTimeout(30)
        .build();
      transaction.sign(sourceKeypair);
      const xdr = transaction.toXDR();
      expect(xdr).toBeDefined();
      const reconstructed = new StellarSdk.Transaction(
        xdr,
        StellarSdk.Networks.PUBLIC
      );
      expect(reconstructed.networkPassphrase).toBe(StellarSdk.Networks.PUBLIC);
    });
  });
});
