import * as StellarSdk from "@stellar/stellar-sdk";
import {
  prepareSignedTransaction,
  requiresSigning,
} from "../../src/services/soroban/signingPrep";
import { performanceTestRunner } from "./utils/PerformanceTestRunner";
import { PERFORMANCE_BASELINES } from "./config/performanceBaselines";
import {
  TRANSACTION_DATASETS,
  SIMULATION_DATASETS,
} from "./fixtures/benchmarkDatasets";
import { trendRecorder } from "./utils/TrendRecorder";
import { SimulationSuccess } from "../../src/services/soroban/sdkAdapter";

describe("Transaction Construction Flow Benchmarks & Regression Budgets", () => {
  beforeAll(() => {
    performanceTestRunner.clear();
  });

  afterAll(() => {
    const report = performanceTestRunner.generateReport();
    console.log("\n" + report);
    trendRecorder.saveReport(performanceTestRunner.getResults());
  });

  describe("Soroban Transaction Building", () => {
    it("should construct unsigned Soroban invoke transaction within budget", async () => {
      const { sourcePublicKey, networkPassphrase, invokeContractParams } =
        TRANSACTION_DATASETS;

      const account = new StellarSdk.Account(sourcePublicKey, "1000");
      const contract = new StellarSdk.Contract(invokeContractParams.contractId);

      const result = await performanceTestRunner.runTest(
        "Tx Construction: Soroban Unsigned Invoke Transaction",
        () => {
          const op = (
            contract as unknown as {
              call(method: string, ...args: unknown[]): unknown;
            }
          ).call(invokeContractParams.method, ...invokeContractParams.args);

          new StellarSdk.TransactionBuilder(account, {
            fee: StellarSdk.BASE_FEE,
            networkPassphrase,
          })
            .addOperation(op as never)
            .setTimeout(30)
            .build();
        },
        {
          iterations: 30,
          warmupIterations: 5,
          threshold:
            PERFORMANCE_BASELINES.transactionConstruction.sorobanUnsignedTx,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.transactionConstruction.sorobanUnsignedTx.p95!
      );
    });

    it("should assemble and sign transaction with footprint within budget", async () => {
      const {
        sourcePublicKey,
        sourceSecret,
        networkPassphrase,
        invokeContractParams,
      } = TRANSACTION_DATASETS;

      const account = new StellarSdk.Account(sourcePublicKey, "1000");
      const contract = new StellarSdk.Contract(invokeContractParams.contractId);

      const op = (
        contract as unknown as {
          call(method: string, ...args: unknown[]): unknown;
        }
      ).call(invokeContractParams.method, ...invokeContractParams.args);

      const unsignedTx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(op as never)
        .setTimeout(30)
        .build();

      const simSuccess =
        SIMULATION_DATASETS.mockRpcSimulationSuccess as unknown as SimulationSuccess;

      const result = await performanceTestRunner.runTest(
        "Tx Construction: Footprint Assembly & Signature",
        () => {
          requiresSigning(simSuccess);
          prepareSignedTransaction(unsignedTx, simSuccess, {
            network: "testnet",
            secretKey: sourceSecret,
          });
        },
        {
          iterations: 30,
          warmupIterations: 5,
          threshold:
            PERFORMANCE_BASELINES.transactionConstruction.footprintSignedTx,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.transactionConstruction.footprintSignedTx.p95!
      );
    });
  });

  describe("Multi-Operation Transaction Envelopes", () => {
    it("should build multi-operation payment and trustline envelope within budget", async () => {
      const {
        sourcePublicKey,
        destinationPublicKey,
        networkPassphrase,
        multiOperationPayload,
      } = TRANSACTION_DATASETS;

      const account = new StellarSdk.Account(sourcePublicKey, "1000");
      const asset = new StellarSdk.Asset(
        multiOperationPayload.assetCode,
        multiOperationPayload.issuer
      );

      const result = await performanceTestRunner.runTest(
        "Tx Construction: Multi-Operation Envelope (Trustline + Payment + Memo)",
        () => {
          new StellarSdk.TransactionBuilder(account, {
            fee: "200",
            networkPassphrase,
          })
            .addOperation(
              StellarSdk.Operation.changeTrust({
                asset,
                limit: multiOperationPayload.trustlineLimit,
              })
            )
            .addOperation(
              StellarSdk.Operation.payment({
                destination: destinationPublicKey,
                asset,
                amount: multiOperationPayload.paymentAmount,
              })
            )
            .addMemo(StellarSdk.Memo.text(multiOperationPayload.memoText))
            .setTimeout(30)
            .build();
        },
        {
          iterations: 30,
          warmupIterations: 5,
          threshold:
            PERFORMANCE_BASELINES.transactionConstruction.multiOperationTx,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.transactionConstruction.multiOperationTx.p95!
      );
    });
  });
});
