# Role-Based Access Control (RBAC)

This directory contains the Soroban smart contracts responsible for on-chain Role-Based Access Control (RBAC). 

## On-Chain Role Hierarchy

The contract defines four distinct privilege levels, managed per-address. An address may hold multiple roles.

1. **SuperAdmin** 
   - **Capabilities:** Can grant or revoke any role, and transfer SuperAdmin privileges. Initialized once upon contract deployment.
   - **Off-Chain Mapping:** Corresponds to the `UserRole.ADMIN` off-chain role enforced by `src/Gateway/middleware/adminAuth.ts` and `rbac.middleware.ts`. Access is typically restricted to whitelisted IP addresses via the `ADMIN_ALLOWED_IPS` environment configurations.

2. **EmergencyAdmin**
   - **Capabilities:** High-privilege role reserved for security emergencies. Can trigger a system-wide pause (`emergency_pause`).
   - **Off-Chain Mapping:** Corresponds to high-level incident response roles (often mapped to `UserRole.ADMIN` off-chain, potentially requiring multi-sig or specialized operations).

3. **OracleProvider**
   - **Capabilities:** Authorized to submit price feed updates (`submit_price`).
   - **Off-Chain Mapping:** Typically maps to automated data worker instances or trusted backend services operating with specific API keys/identities.

4. **AgentOperator**
   - **Capabilities:** Authorized to trigger and execute autonomous agent tasks (`run_agent`).
   - **Off-Chain Mapping:** Corresponds to bot runner services or authenticated users (`UserRole.USER` / `UserRole.MODERATOR`) operating through the Node.js backend.

## Cross-Reference Table

| On-Chain Role (`contracts/rbac/src/lib.rs`) | Off-Chain Concept (`src/Gateway/middleware`) | Enforcement Mechanism |
| :--- | :--- | :--- |
| `SuperAdmin` | `UserRole.ADMIN` | `requireAdminAuth`, `requireAdmin`, IP Whitelist |
| `EmergencyAdmin` | `UserRole.ADMIN` (Incident Response) | Off-chain monitoring alerts, IP Whitelist |
| `OracleProvider` | Service Identity / Data Worker | API Keys, `requireModerator` (potentially) |
| `AgentOperator` | Bot Services / `UserRole.USER` | `requireUser`, `requireAnyRole` |

## Modifying Roles

Only the `SuperAdmin` can issue `grant_role` or `revoke_role` operations. Role assignments are stored persistently and verified upon execution of any gated action in the contract.
