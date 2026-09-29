Consolidate duplicate config files: commitlint.config.js vs .ts, hardhat.config.js vs .ts, eslint.config.mjs vs .mts
Repo Avatar
gear5labs/chenpilot
The repo root has both a .js and .ts version of commitlint.config, hardhat.config, and eslint.config. Having both is confusing for contributors (which one is actually loaded?) and risks the two files drifting out of sync silently.

Proposed Work

Determine which file is actually loaded by each tool (Node config resolution order)
Delete the unused duplicate, or clearly document why both exist (e.g., one is for a legacy toolchain)
Acceptance Criteria

 Duplicate config pairs resolved to a single source of truth each
 CONTRIBUTING.md notes the config file convention going forward