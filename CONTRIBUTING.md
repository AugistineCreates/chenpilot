# Contributing to Chen Pilot

Thank you for your interest in contributing to Chen Pilot! We're building the most intelligent gateway for cross-chain DeFi operations, and we'd love your help.

## 🚀 Getting Started

1.  **Fork the Project**: Create your own copy of the repository.
2.  **Environment Setup**:
    - Install Node.js (18+).
    - Install `pnpm` (`npm install -g pnpm`).
    - Run `pnpm install`.
    - Copy `.env.example` to `.env` and configure your keys.
3.  **Run Locally**:
    - `npm run migration:run` (Requires a running PostgreSQL instance).
    - `npm run dev`.

## 🛠️ How to Contribute

### 1. Find an Issue

Look at our [Issues list](https://github.com/chen-pilot/chen-pilot-experimental/issues) for tasks labeled `help wanted` or `good first issue`. We have a roadmap of 50 priority issues focused on building a world-class **DeFi Agent on Stellar** (Yield strategies, Portfolio management, and Protocol integrations).

### 2. Your First PR

New to the project? Here's a concrete walkthrough for your first contribution.

#### Environment sanity check

Before picking up an issue, confirm your local environment works:

```bash
pnpm install
npm test                  # runs Jest — all tests should pass
npm run build:check       # runs tsc --noEmit — no type errors
```

If both pass, you're ready to contribute.

#### Suggested first issues

Good starter categories:
- **Docs** — improve README sections, fix typos, clarify API docs
- **Test coverage** — add missing unit tests for existing services
- **Type-safety** — replace `any` with proper types (we've added an ESLint rule `@typescript-eslint/no-explicit-any` to flag these)

Browse all [good first issues](https://github.com/gear5labs/chenpilot/issues?q=label%3A%22good+first+issue%22) for a starting point.

#### What reviewers look for

- **Conventional commit format** — `feat:`, `fix:`, `docs:`, `test:`, `refactor:`
- **Strict typing** — no `any` unless absolutely necessary
- **Tests** — include or update tests for your change
- **Linting** — pre-commit hooks run `lint-staged` automatically; make sure they pass
- **Scope** — keep PRs focused on a single issue

### 3. Creating a Pull Request

- Create a branch from `main`: `git checkout -b feature/your-feature-name`.
- Commit your changes using **Conventional Commits**:
  - `feat: add automated yield farming strategy`
  - `fix: resolve profit calculation bug in portfolio tool`
  - `docs: update strategy contribution guide`
- Push to your fork and submit a PR to `main`.

## 📐 Coding Standards

- **TypeScript**: Use strict typing. Avoid `any` unless absolutely necessary.
- **Tools**: All new tools should extend `BaseTool` and be placed in `src/Agents/tools/`.
- **Testing**: Add unit tests for new logic in the `tests/unit` directory.
- **Linting**: We use Husky and lint-staged. Your code will be automatically formatted and linted on commit.

### Configuration file convention

Tool configuration files (ESLint, commitlint, etc.) use the `.mjs` or `.js` extension — not `.mts` or `.ts` — because most tools do not natively resolve TypeScript config files. Keep configs in JavaScript unless the tool explicitly documents TypeScript support.

## 🏛️ Architecture Overview

- **Gateway**: The API entry point (`src/Gateway`).
- **Agents**: The brain of the operation (`src/Agents`).
- **Tools**: Specialized functions the agent can call (`src/Agents/tools`).
- **Registry**: Where tools and prompt templates are managed.

## 💬 Communication

If you have questions, feel free to open an issue or join our community discussions!

---

_Chen Pilot — Automating the Multi-Chain Future._
