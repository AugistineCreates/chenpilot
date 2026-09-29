import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

// ── Operation types ────────────────────────────────────────────────────────────

export type LifecycleOperationType = "swap" | "soroban" | "delayed_job";

// ── Finality status tracking for reorg-aware confirmation ────────────────────
export type FinalityStatus =
  | "PENDING"        // Transaction not yet observed in ledger
  | "CONFIRMING"     // Observed in ledger, accumulating confirmation depth
  | "FINAL"          // Confirmed with sufficient depth, side effects triggered (terminal ✓)
  | "ORPHANED"       // Detected on orphaned fork, rolled back (terminal ✗)
  | "RECONCILING"    // After orphan, querying reconciliation provider
  | "CONFLICTED"     // Providers return conflicting results (terminal ✗)
  | "STALE";         // Primary provider stopped advancing ledger (terminal ✗)

// ── State machine ──────────────────────────────────────────────────────────────
//
//  All three operation types share the same state space.
//  Not every state is reachable by every type (see VALID_TRANSITIONS).
//
//  swap:        intent → simulating → executing → submitting → submitted → confirmed
//                                                                        ↘ failed
//  soroban:     intent → simulating → executing → confirmed
//                                              ↘ failed
//  delayed_job: intent → pending → waiting → submitting → submitted → confirmed
//                                                        ↘ failed
//                                  ↘ cancelled (from any non-terminal state)

export type LifecycleState =
  | "intent"       // User request received, not yet acted on
  | "simulating"   // Dry-run / fee estimation in progress
  | "executing"    // Building and signing the transaction
  | "pending"      // Delayed job created, waiting for trigger time
  | "waiting"      // Waiting for fee/congestion condition
  | "submitting"   // Submitting to the network
  | "submitted"    // Accepted by the network, awaiting ledger close
  | "confirmed"    // Included in a ledger (terminal ✓)
  | "failed"       // Unrecoverable error (terminal ✗)
  | "cancelled";   // Explicitly cancelled by user (terminal ✗)

// ── Finality status tracking for reorg-aware confirmation ────────────────────
export type FinalityStatus =
  | "PENDING"        // Transaction not yet observed in ledger
  | "CONFIRMING"     // Observed in ledger, accumulating confirmation depth
  | "FINAL"          // Confirmed with sufficient depth, side effects triggered (terminal ✓)
  | "ORPHANED"       // Detected on orphaned fork, rolled back (terminal ✗)
  | "RECONCILING"    // After orphan, querying reconciliation provider
  | "CONFLICTED"     // Providers return conflicting results (terminal ✗)
  | "STALE"          // Primary provider stopped advancing ledger (terminal ✗)

// Allowed transitions per operation type.
// Key = current state, value = set of reachable next states.
export const VALID_TRANSITIONS: Record<LifecycleState, Set<LifecycleState>> = {
  intent:     new Set(["simulating", "executing", "pending", "failed", "cancelled"]),
  simulating: new Set(["executing", "failed", "cancelled"]),
  executing:  new Set(["submitting", "confirmed", "failed", "cancelled"]),
  pending:    new Set(["waiting", "submitting", "cancelled", "failed"]),
  waiting:    new Set(["submitting", "cancelled", "failed"]),
  submitting: new Set(["submitted", "failed", "cancelled"]),
  submitted:  new Set(["confirmed", "failed"]),
  confirmed:  new Set(),   // terminal
  failed:     new Set(),   // terminal
  cancelled:  new Set(),   // terminal
};

export const TERMINAL_STATES = new Set<LifecycleState>(["confirmed", "failed", "cancelled"]);

// ── Entity ─────────────────────────────────────────────────────────────────────

@Entity("transaction_lifecycle")
@Index(["userId", "createdAt"])
@Index(["operationType", "state"])
export class TransactionLifecycle {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  @Index()
  userId!: string;

  @Column({ type: "varchar" })
  operationType!: LifecycleOperationType;

  @Column({ type: "varchar", default: "intent" })
  state!: LifecycleState;

  /** Correlation handle — txHash once known, planId for agent plans, delayedTx id, etc. */
  @Column({ type: "varchar", nullable: true })
  @Index()
  correlationId!: string | null;

  /** Arbitrary JSON snapshot of the operation payload at intent time */
  @Column({ type: "jsonb", nullable: true })
  payload!: Record<string, unknown> | null;

  /** Arbitrary JSON metadata updated at each transition (fee estimates, ledger, errors…) */
  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  /** Human-readable reason for the last transition (especially failures) */
  @Column({ type: "text", nullable: true })
  lastTransitionReason!: string | null;

  // ────────────────────────────────────────────────────────────────────────────
  // Reorg-aware finality tracking
  // ────────────────────────────────────────────────────────────────────────────

  /** Ledger sequence where transaction was first observed */
  @Column({ type: "bigint", nullable: true })
  @Index()
  ledgerSequence!: number | null;

  /** Hash of the ledger where transaction was observed */
  @Column({ type: "varchar", length: 64, nullable: true })
  ledgerHash!: string | null;

  /** How many ledgers have closed on top of the observed ledger */
  @Column({ type: "integer", default: 0 })
  confirmationDepth!: number;

  /** Which provider first reported this transaction confirmation (Horizon URL) */
  @Column({ type: "varchar", length: 128, nullable: true })
  observedAtProvider!: string | null;

  /** Current finality status (tracks reorg-aware confirmation progression) */
  @Column({ type: "varchar", length: 32, default: "PENDING" })
  @Index()
  finalityStatus!: FinalityStatus;

  /** When finality was declared (finality_status = FINAL) */
  @Column({ type: "timestamp with time zone", nullable: true })
  finalityDeclaredAt!: Date | null;

  /** When orphan was detected (finality_status = ORPHANED) */
  @Column({ type: "timestamp with time zone", nullable: true })
  orphanedAt!: Date | null;

  /** Hash of the ledger that was orphaned (for audit trail) */
  @Column({ type: "varchar", length: 64, nullable: true })
  orphanedLedgerHash!: string | null;

  /** When reconciliation completed after orphan */
  @Column({ type: "timestamp with time zone", nullable: true })
  reconciledAt!: Date | null;

  /** Which provider (Horizon URL) was used for reconciliation */
  @Column({ type: "varchar", length: 128, nullable: true })
  reconcileProvider!: string | null;

  /** How many ledgers were rolled back during reorg */
  @Column({ type: "integer", nullable: true })
  reorgDepth!: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
