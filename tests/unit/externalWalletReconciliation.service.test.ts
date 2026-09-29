import { describe, it, expect, beforeEach } from "bun:test";
import {
  ExternalWalletReconciliationService,
  IngestOptions,
  InternalTransactionRecord,
  RawExternalTransaction,
} from "../../src/services/externalWalletReconciliation.service";
import { ReconciliationWorkspaceService } from "../../src/services/reconciliationWorkspace.service";

describe("ExternalWalletReconciliationService", () => {
  let service: ExternalWalletReconciliationService;

  beforeEach(() => {
    service = new ExternalWalletReconciliationService();
  });

  describe("Stable Chain Identities & Deduplication", () => {
    it("generates deterministic, stable chain identities across networks and operations", () => {
      const id1 = service.buildChainIdentity(
        "testnet",
        "stellar-testnet",
        "0xABCDEF123456",
        0
      );
      const id2 = service.buildChainIdentity(
        "testnet",
        "stellar-testnet",
        "0xabcdef123456",
        0
      );
      const id3 = service.buildChainIdentity(
        "testnet",
        "stellar-testnet",
        "0xabcdef123456",
        1
      );
      const idMainnet = service.buildChainIdentity(
        "mainnet",
        "stellar-mainnet",
        "0xabcdef123456",
        0
      );

      expect(id1).toBe("testnet:stellar-testnet:0xabcdef123456:0");
      expect(id1).toBe(id2); // Case insensitive hash normalization
      expect(id1).not.toBe(id3); // Multi-op uniqueness
      expect(id1).not.toBe(idMainnet); // Network isolation
    });

    it("deduplicates identical transactions and ensures reimports are idempotent", async () => {
      const rawTx: RawExternalTransaction = {
        txHash: "0xhash111",
        operationIndex: 0,
        sourceAddress: "GSOURCE111",
        targetAddress: "GTARGET111",
        amount: "50.00",
        asset: "USDC",
        status: "confirmed",
        timestamp: "2026-09-28T10:00:00Z",
      };

      const options: IngestOptions = {
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [rawTx],
      };

      // First import
      const result1 = await service.ingestAndReconcile(options);
      expect(result1.totalIngested).toBe(1);
      expect(result1.newlyImported).toBe(1);
      expect(result1.deduplicated).toBe(0);
      expect(result1.unmatched).toBe(1);

      // Re-importing exact same transaction
      const result2 = await service.ingestAndReconcile(options);
      expect(result2.totalIngested).toBe(1);
      expect(result2.newlyImported).toBe(0);
      expect(result2.deduplicated).toBe(1); // Deduped!

      // Original activity count in service remains exactly 1
      const unmatched = service.getUnmatchedActivities();
      expect(unmatched).toHaveLength(1);
      expect(unmatched[0].txHash).toBe("0xhash111");
    });
  });

  describe("Import Provenance & Checksum Integrity", () => {
    it("retains full provenance, actor identity, source, and payload checksum", async () => {
      const rawTx: RawExternalTransaction = {
        txHash: "0xhash222",
        sourceAddress: "GSOURCE222",
        targetAddress: "GTARGET222",
        amount: 100,
        asset: "XLM",
        status: "confirmed",
        extra: { memo: "payroll-sep-2026" },
      };

      const options: IngestOptions = {
        source: "external_export",
        network: "mainnet",
        importedBy: "admin-audit-user",
        metadata: { filename: "external_ledger_dump.csv" },
        rawTransactions: [rawTx],
      };

      const result = await service.ingestAndReconcile(options);
      expect(result.newlyImported).toBe(1);

      const activity = result.activities[0];
      expect(activity.provenance.source).toBe("external_export");
      expect(activity.provenance.importedBy).toBe("admin-audit-user");
      expect(activity.provenance.network).toBe("mainnet");
      expect(activity.provenance.metadata?.filename).toBe("external_ledger_dump.csv");
      expect(activity.provenance.rawPayloadChecksum).toBeDefined();
      expect(activity.provenance.rawPayloadChecksum.length).toBe(64); // SHA-256
    });
  });

  describe("Reconciliation & Quarantine of Ambiguous Matches", () => {
    it("links exact matching transactions successfully", async () => {
      const rawTx: RawExternalTransaction = {
        txHash: "0xmatched_hash_1",
        sourceAddress: "G_USER_WALLET",
        targetAddress: "G_MERCHANT",
        amount: "150.25",
        asset: "USDC",
        status: "confirmed",
      };

      const internalRecord: InternalTransactionRecord = {
        id: "int-tx-1",
        txHash: "0xmatched_hash_1",
        userId: "user-1",
        walletAddress: "G_USER_WALLET",
        amount: "150.25",
        asset: "USDC",
        status: "confirmed",
        sourceAddress: "G_USER_WALLET",
        targetAddress: "G_MERCHANT",
        createdAt: new Date(),
      };

      const result = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [rawTx],
        internalRecords: [internalRecord],
      });

      expect(result.matched).toBe(1);
      expect(result.quarantined).toBe(0);
      expect(result.unmatched).toBe(0);

      const activity = result.activities[0];
      expect(activity.linkStatus).toBe("matched");
      expect(activity.linkedInternalRecordId).toBe("int-tx-1");
    });

    it("quarantines transactions when amounts diverge (AMOUNT_MISMATCH)", async () => {
      const rawTx: RawExternalTransaction = {
        txHash: "0xhash_divergent_amount",
        sourceAddress: "G_WALLET",
        targetAddress: "G_RECEIVER",
        amount: "200.00",
        asset: "USDC",
        status: "confirmed",
      };

      const internalRecord: InternalTransactionRecord = {
        id: "int-tx-2",
        txHash: "0xhash_divergent_amount",
        userId: "user-1",
        amount: "180.00", // Divergent!
        asset: "USDC",
        status: "confirmed",
        createdAt: new Date(),
      };

      const result = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [rawTx],
        internalRecords: [internalRecord],
      });

      expect(result.matched).toBe(0);
      expect(result.quarantined).toBe(1);

      const quarantined = service.getQuarantinedMatches();
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0].quarantineReason).toBe("AMOUNT_MISMATCH");
      expect(quarantined[0].quarantineDetails?.delta).toBe(20);
    });

    it("quarantines transactions when assets diverge (ASSET_MISMATCH)", async () => {
      const rawTx: RawExternalTransaction = {
        txHash: "0xhash_divergent_asset",
        sourceAddress: "G_WALLET",
        amount: "100.00",
        asset: "XLM", // Divergent
        status: "confirmed",
      };

      const internalRecord: InternalTransactionRecord = {
        id: "int-tx-3",
        txHash: "0xhash_divergent_asset",
        userId: "user-1",
        amount: "100.00",
        asset: "USDC",
        status: "confirmed",
        createdAt: new Date(),
      };

      const result = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [rawTx],
        internalRecords: [internalRecord],
      });

      expect(result.quarantined).toBe(1);
      expect(result.activities[0].quarantineReason).toBe("ASSET_MISMATCH");
    });

    it("quarantines transactions when multiple candidate internal records match (MULTIPLE_CANDIDATE_MATCHES)", async () => {
      const now = new Date();
      const rawTx: RawExternalTransaction = {
        txHash: "0xexternal_no_direct_hash_link",
        sourceAddress: "G_SHARED_POOL",
        amount: "75.00",
        asset: "USDC",
        status: "confirmed",
        timestamp: now,
      };

      // Two internal records with identical amount and wallet in the same window
      const internalRecords: InternalTransactionRecord[] = [
        {
          id: "int-candidate-1",
          userId: "user-1",
          walletAddress: "G_SHARED_POOL",
          amount: "75.00",
          asset: "USDC",
          status: "pending",
          createdAt: now,
        },
        {
          id: "int-candidate-2",
          userId: "user-2",
          walletAddress: "G_SHARED_POOL",
          amount: "75.00",
          asset: "USDC",
          status: "pending",
          createdAt: now,
        },
      ];

      const result = await service.ingestAndReconcile({
        source: "manual_batch",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [rawTx],
        internalRecords,
      });

      expect(result.quarantined).toBe(1);
      const activity = result.activities[0];
      expect(activity.linkStatus).toBe("quarantined");
      expect(activity.quarantineReason).toBe("MULTIPLE_CANDIDATE_MATCHES");
      expect(activity.quarantineDetails?.count).toBe(2);
    });

    it("quarantines status conflicts when external succeeded but internal failed (STATUS_CONFLICT)", async () => {
      const rawTx: RawExternalTransaction = {
        txHash: "0xstatus_conflict_hash",
        sourceAddress: "G_WALLET",
        amount: "10.00",
        asset: "USDC",
        status: "confirmed",
      };

      const internalRecord: InternalTransactionRecord = {
        id: "int-failed-1",
        txHash: "0xstatus_conflict_hash",
        userId: "user-1",
        amount: "10.00",
        asset: "USDC",
        status: "failed", // Internal recorded failure!
        createdAt: new Date(),
      };

      const result = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [rawTx],
        internalRecords: [internalRecord],
      });

      expect(result.quarantined).toBe(1);
      expect(result.activities[0].quarantineReason).toBe("STATUS_CONFLICT");
    });
  });

  describe("Operator Triage & Review", () => {
    it("exposes unmatched activities and quarantined matches with filters", async () => {
      await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [
          {
            txHash: "0xunmatched_1",
            sourceAddress: "G_WALLET_A",
            amount: "10.00",
            asset: "USDC",
          },
          {
            txHash: "0xunmatched_2",
            sourceAddress: "G_WALLET_B",
            amount: "20.00",
            asset: "XLM",
          },
        ],
      });

      const allUnmatched = service.getUnmatchedActivities();
      expect(allUnmatched).toHaveLength(2);

      const filtered = service.getUnmatchedActivities({ walletAddress: "G_WALLET_A" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].txHash).toBe("0xunmatched_1");
    });

    it("allows authorized operators to resolve quarantined matches", async () => {
      const rawTx: RawExternalTransaction = {
        txHash: "0xquarantine_to_resolve",
        sourceAddress: "G_WALLET",
        amount: "100.00",
        asset: "USDC",
      };
      const internalRecord: InternalTransactionRecord = {
        id: "int-target-99",
        txHash: "0xquarantine_to_resolve",
        userId: "user-1",
        amount: "101.00", // slight discrepancy causing quarantine
        asset: "USDC",
        status: "confirmed",
        createdAt: new Date(),
      };

      const res = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [rawTx],
        internalRecords: [internalRecord],
      });

      const chainId = res.activities[0].chainIdentity;
      expect(service.getQuarantinedMatches()).toHaveLength(1);

      // Unauthorized actor fails
      expect(() =>
        service.resolveQuarantinedMatch(
          chainId,
          "link",
          "int-target-99",
          { id: "viewer", roles: ["viewer"] }
        )
      ).toThrow("Operator permission required");

      // Authorized operator succeeds
      const resolved = service.resolveQuarantinedMatch(
        chainId,
        "link",
        "int-target-99",
        { id: "operator-1", roles: ["operator"] }
      );

      expect(resolved.linkStatus).toBe("matched");
      expect(resolved.linkedInternalRecordId).toBe("int-target-99");
      expect(service.getQuarantinedMatches()).toHaveLength(0);
    });
  });

  describe("Integration with ReconciliationWorkspaceService & DriftItems", () => {
    it("converts unmatched and quarantined items to DriftItems and exports to ReconciliationCase", () => {
      const workspace = new ReconciliationWorkspaceService();

      service.buildChainIdentity("testnet", "stellar-testnet", "0xdrift_tx", 0);
      // Ingest an unmatched activity
      service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [
          {
            txHash: "0xdrift_tx",
            sourceAddress: "G_WALLET_DRIFT",
            amount: "500",
            asset: "USDC",
          },
        ],
      });

      const driftItems = service.toDriftItems();
      expect(driftItems).toHaveLength(1);
      expect(driftItems[0].type).toBe("external_activity_unmatched");
      expect(driftItems[0].severity).toBe("major");

      // Export directly into workspace cases
      const cases = service.exportToReconciliationCases(workspace, "rep-ext-101");
      expect(cases).toHaveLength(1);
      expect(cases[0].reportId).toBe("rep-ext-101");
      expect(cases[0].driftItem.type).toBe("external_activity_unmatched");
      expect(cases[0].status).toBe("unresolved");
    });
  });

  describe("Failure, Resilience & Partial Ingestion Retry", () => {
    it("isolates malformed records in errors array without failing entire batch", async () => {
      const batchWithBadRecords: RawExternalTransaction[] = [
        {
          txHash: "0xvalid_1",
          sourceAddress: "G_VALID",
          amount: "10.00",
        },
        {
          txHash: "", // Invalid empty txHash
          sourceAddress: "G_INVALID",
          amount: "20.00",
        },
        {
          txHash: "0xvalid_2",
          sourceAddress: "G_VALID_2",
          amount: -5, // Invalid negative amount
        },
        {
          txHash: "0xvalid_3",
          sourceAddress: "G_VALID_3",
          amount: "30.00",
        },
      ];

      const result = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: batchWithBadRecords,
      });

      expect(result.totalIngested).toBe(4);
      expect(result.newlyImported).toBe(2); // 0xvalid_1 and 0xvalid_3
      expect(result.errors).toHaveLength(2); // 2 invalid records captured
      expect(result.errors[0].itemIndex).toBe(1);
      expect(result.errors[1].itemIndex).toBe(2);

      // Verify the service retained the valid entries safely
      expect(service.getUnmatchedActivities()).toHaveLength(2);
    });

    it("supports resilient retry of partial batches idempotently", async () => {
      // First attempt: valid_1 and error on item 2
      const firstBatch: RawExternalTransaction[] = [
        { txHash: "0xbatch_tx_1", sourceAddress: "G1", amount: "10" },
        { txHash: "", sourceAddress: "G2", amount: "20" }, // error
      ];

      const res1 = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: firstBatch,
      });
      expect(res1.newlyImported).toBe(1);
      expect(res1.errors).toHaveLength(1);

      // Operator fixes item 2 and retries the entire batch
      const fixedBatch: RawExternalTransaction[] = [
        { txHash: "0xbatch_tx_1", sourceAddress: "G1", amount: "10" }, // already imported
        { txHash: "0xbatch_tx_2_fixed", sourceAddress: "G2", amount: "20" }, // fixed!
      ];

      const res2 = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: fixedBatch,
      });

      expect(res2.deduplicated).toBe(1); // 0xbatch_tx_1 was safely deduped
      expect(res2.newlyImported).toBe(1); // 0xbatch_tx_2_fixed was ingested
      expect(res2.errors).toHaveLength(0);
      expect(service.getUnmatchedActivities()).toHaveLength(2);
    });
  });
});
