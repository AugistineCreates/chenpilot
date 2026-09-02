# Multi-Region Failover Requirements

## Overview
Rules for ownership, fencing, replication, and failover that keep a single writer for durable financial operations and prevent split-brain execution and conflicting sequence numbers.

## Definitions
- Epoch fence: monotonic token from the quorum coordinator; required to execute durable ops.
- Owner region: the one region allowed to execute a partition's durable ops at an epoch.
- Chain state: committed log of durable ops and their sequence numbers.

## Requirements

### R1 Epoch-fenced execution
No region executes a durable op without a valid epoch fence. Every durable write carries the epoch; storage rejects stale-epoch writes. Epochs are strictly monotonic and issued by a quorum coordinator.

### R2 Single-writer ownership
Exactly one region owns a partition per epoch via a TTL lease. On lease loss the region stops executing and self-fences.

### R3 Data replication and freshness
Durable ops replicate synchronously before commit ack. Promotion requires proof the candidate applied chain state up to the prior owner's last committed sequence number. Reject promotion if lag exceeds the freshness bound (RPO=0).

### R4 Promotion with chain-state verification
Promotion requires verified data and chain-state freshness. A new owner obtains a strictly higher epoch; the old epoch is invalidated atomically so the prior owner can no longer commit.

### R5 Split-brain rejection under partition
Partition tests must prove at most one region holds a valid epoch. On quorum loss no promotion occurs and the isolated owner fences itself at lease expiry (fail-closed). Sequence numbers are namespaced by epoch and validated on commit, so conflicting allocation is impossible.

### R6 Recovery objectives
RTO <= 5 min for automated failover. RPO = 0 for durable financial ops. Recovery steps and durations are documented and tested.

### R7 Manual override risks
Forced promotion requires operator confirmation and an audit entry. Bypassing freshness risks data loss and duplicate execution; the workflow must surface this. Overrides still allocate a strictly higher epoch.

## Acceptance Criteria Mapping
- No execution without epoch fence -> R1, R2
- Promotion requires verified data and chain-state freshness -> R3, R4
- Partition tests prove split-brain rejection -> R5
- Recovery objectives and manual override risks documented -> R6, R7
