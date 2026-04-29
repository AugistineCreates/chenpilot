## Chen Pilot System Architecture

The following diagrams illustrate the orchestration between AI agents, the centralized Tool Registry, and external blockchain infrastructure.

> To preview these diagrams, use a Mermaid-compatible Markdown viewer (such as the Mermaid extension in VS Code/Cursor).

---

## Logical Workflow: Request Processing to Execution

```mermaid
flowchart TD
  U[User / Client] -->|Natural language request| AP[AgentPlanner]

  AP -->|Get tool metadata| TR[ToolRegistry]
  TR -->|Available tools & metadata| AP

  AP -->|Planner prompt with tools\n+ user input| LLM[AgentLLM / External LLM]
  LLM -->|WorkflowPlan (JSON)| AP

  AP -->|ExecutionPlan| PE[PlanExecutor]

  PE -->|Execute step| TR
  TR -->|Invoke tool| T[Registered Tools\n(wallet, swap, soroban, ...)]
  T -->|RPC / HTTP calls| S[External Services\n(Blockchains, DeFi protocols,\nwallet providers, APIs)]
  S -->|Results / tx hashes| T

  T -->|ToolResult| TR
  TR -->|StepResult| PE
  PE -->|Aggregated ExecutionResult| U
```

**Legend**

- **AgentPlanner**: Analyzes user intent, calls the LLM, and produces an `ExecutionPlan`.
- **AgentLLM / External LLM**: Large language model used for planning (e.g., Claude, OpenAI, etc.).
- **ToolRegistry**: Discovers tools, exposes metadata, and executes them.
- **Registered Tools**: Concrete implementations (wallet, swap, Soroban, etc.).
- **External Services**: Blockchains, DeFi protocols, and any external APIs or infrastructure the tools call.

---

## Detailed Example: "Swap 100 XLM to USDC"

```mermaid
sequenceDiagram
  participant User
  participant AgentPlanner
  participant AgentLLM
  participant PlanExecutor
  participant ToolRegistry
  participant WalletTool
  participant SwapTool
  participant Blockchain as Blockchain / DeFi

  User->>AgentPlanner: "Swap 100 XLM to USDC"
  AgentPlanner->>ToolRegistry: getToolMetadata()
  ToolRegistry-->>AgentPlanner: tools[]

  AgentPlanner->>AgentLLM: analyzeWithLLM(prompt, tools, input)
  AgentLLM-->>AgentPlanner: WorkflowPlan\n(wallet_tool, swap_tool)

  AgentPlanner-->>User: ExecutionPlan summary\n(risk, steps, estimates)
  User->>AgentPlanner: Approve plan

  AgentPlanner->>PlanExecutor: executePlan(plan, userId, options)

  loop For each plan step
    PlanExecutor->>ToolRegistry: executeTool("wallet_tool", payload)
    ToolRegistry->>WalletTool: execute(payload, userId)
    WalletTool->>Blockchain: getBalance(XLM)
    Blockchain-->>WalletTool: balance
    WalletTool-->>ToolRegistry: ToolResult
    ToolRegistry-->>PlanExecutor: StepResult

    PlanExecutor->>ToolRegistry: executeTool("swap_tool", payload)
    ToolRegistry->>SwapTool: execute(payload, userId)
    SwapTool->>Blockchain: swap(100 XLM -> USDC)
    Blockchain-->>SwapTool: tx hash, output amount
    SwapTool-->>ToolRegistry: ToolResult
    ToolRegistry-->>PlanExecutor: StepResult
  end

  PlanExecutor-->>AgentPlanner: ExecutionResult
  AgentPlanner-->>User: Final status, tx hashes, balances
```

This sequence diagram focuses on the interactions between:

- **Agents** (`AgentPlanner`, `PlanExecutor`, `AgentLLM`)
- **Tools & ToolRegistry**
- **External Services** (blockchains / DeFi protocols)
