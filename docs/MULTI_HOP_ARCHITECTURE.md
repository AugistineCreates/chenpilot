# Multi-Hop Trade Path Evaluation - Architecture

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     User / Agent                             │
└────────────┬────────────────────────────────┬────────────────┘
             │                                │
             │                                │
    ┌────────▼────────┐              ┌───────▼────────┐
    │  Agent Tool     │              │ Price Service  │
    │  (multi_hop_    │              │ (getPriceWith  │
    │   trade)        │              │  MultiHop)     │
    └────────┬────────┘              └───────┬────────┘
             │                                │
             │                                │
             └────────────┬───────────────────┘
                          │
                ┌─────────▼──────────┐
                │ MultiHopPathFinder │
                │    Service         │
                └─────────┬──────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
    ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
    │ Strict    │  │ Strict    │  │ Path      │
    │ Send      │  │ Receive   │  │ Evaluation│
    │ Paths     │  │ Paths     │  │ Engine    │
    └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
          │               │               │
          └───────────────┼───────────────┘
                          │
                ┌─────────▼──────────┐
                │  Stellar Horizon   │
                │      Server        │
                └────────────────────┘
```

## Component Details

### 1. MultiHopPathFinder Service

- Core path discovery and evaluation logic
- Queries Stellar Horizon API
- Calculates efficiency scores
- Selects optimal paths

### 2. MultiHopTradeTool

- Agent-facing interface
- Input validation
- Response formatting
- Recommendation generation

### 3. Price Service Integration

- Enhanced price quotes
- Multi-hop analysis
- Cache integration

### 4. Tool Registry

- Automatic tool discovery
- Agent planner integration
- Workflow orchestration

## Data Flow

```
1. Request → Tool/Service
2. Asset Validation
3. API Queries (strictSend + strictReceive)
4. Path Discovery (up to 40 paths)
5. Path Evaluation (efficiency scoring)
6. Optimal Selection
7. Response Formatting
8. Return to User/Agent
```
