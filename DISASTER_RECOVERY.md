# Disaster Recovery Plan

## Introduction
This document defines the point-in-time disaster recovery (DR) procedures for Chen Pilot's stateful services. It covers RPO/RTO targets, restore prerequisites, step-by-step restoration, integrity verification, and drill result recording.

## Stateful Components
- PostgreSQL primary datastore for user, signing, and workflow data.
- Redis caches, price feeds, and coordination state. Rebuilt or reconciled, not blindly restored.
- Signing metadata: stored in PostgreSQL and possibly files.
- Chain cursors: indexer cursors persisted in PostgreSQL or separate store.

## RPO/RTO Targets
- Recovery Point Objective (RPO): 15 minutes (or as configured).
- Recovery Time Objective (RTO): 1 hour for full stack restore.
- These targets are measured and reported in each drill.

## Prerequisites
- Access to backup storage (S3, local, etc.)
- Restore host with Docker/local binaries for postgres, redis, etc.
- Environment variables loaded (see .env.example).
- Backups available: PostgreSQL base backup + WAL, Redis snapshot (optional), metadata files.

## Restore Procedure Overview