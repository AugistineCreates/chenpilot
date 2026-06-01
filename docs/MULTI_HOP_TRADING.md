# Multi-Hop Trade Path Evaluation

## Overview

The Multi-Hop Trade Path Evaluation feature identifies the most efficient trading paths across the Stellar DEX using multiple intermediate assets. This utility evaluates all possible routes between two assets and selects the optimal path based on efficiency, price impact, and slippage.

## Features

- **Path Discovery**: Automatically finds all available trading paths up to a configurable number of hops
- **Path Evaluation**: Analyzes each path for efficiency, price impact, and estimated slippage
- **Optimal Selection**: Selects the best path based on multiple criteria
- **Risk Analysis**: Provides detailed metrics for informed trading decisions
- **Caching Integration**: Works with existing price caching infrastructure

## Architecture

### Core Components

1. **MultiHopPathFinder** (`src/services/multiHopPathFinder.ts`)
   - Service that discovers and evaluates trading paths
   - Uses Stellar's `strictSendPaths` and `strictReceivePaths` APIs
   - Calculates efficiency scores for path comparison

2. **MultiHopTradeTool** (`src/Agents/tools/multiHopTradeTool.ts`)
   - Agent tool for multi-hop path evaluation
   - Integrates with the tool registry
   - Provides structured responses with recommendations

3. **StellarPriceService Integration**
   - Extended with `getPriceWithMultiHop()` method
   - Combines price fetching with multi-hop analysis

## Usage

### Using the Service Directly

```typescript
import { multiHopPathFinder } from "./services/multiHopPathFinder";
import * as StellarSdk from "@stellar/stellar-sdk";

const sourceAsset = StellarSdk.Asset.native(); // XLM
const destAsset = new StellarSdk.Asset(
  "USDC",
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
);

const result = await multiHopPathFinder.findOptimalPath(
  sourceAsset,
  destAsset,
  "100.0000000",
  {
    maxHops: 5,
    timeout: 10000,
  }
);

console.log("Best Path:", result.bestPath);
console.log("All Paths:", result.allPaths);
console.log("Evaluation Time:", result.evaluationTime, "ms");
```

### Using the Agent Tool

```typescript
import { toolRegistry } from "./Agents/registry/ToolRegistry";

const result = await toolRegistry.executeTool(
  "multi_hop_trade",
  {
    fromAsset: "XLM",
    toAsset: "USDC",
    amount: 100,
    maxHops: 3,
  },
  "user-id"
);

if (result.success) {
  console.log("Best Path:", result.data.bestPath);
  console.log("Alternative Paths:", result.data.alternativePaths);
  console.log("Recommendation:", result.data.recommendation);
}
```

### Using the Price Service

```typescript
import stellarPriceService from "./services/stellarPrice.service";

const quote = await stellarPriceService.getPriceWithMultiHop(
  "XLM",
  "USDC",
  100,
  5 // maxHops
);

console.log("Price:", quote.price);
console.log("Path:", quote.path);
console.log("Multi-hop Analysis:", quote.multiHopAnalysis);
```

## Response Structure

### PathEvaluationResult

```typescript
{
  bestPath: {
    path: Asset[],              // Array of Stellar assets in the path
    sourceAmount: string,       // Amount of source asset
    destinationAmount: string,  // Amount received at destination
    priceImpact: number,        // Price impact percentage
    estimatedSlippage: number,  // Estimated slippage (0-1)
    hops: number,              // Number of intermediate hops
    route: string[],           // Human-readable route
    efficiency: number         // Overall efficiency score
  },
  allPaths: TradePath[],       // All discovered paths
  evaluationTime: number,      // Time taken to evaluate (ms)
  timestamp: number            // Evaluation timestamp
}
```

### Tool Response

```typescript
{
  success: true,
  data: {
    bestPath: {
      route: ['XLM', 'USDC:GA5ZSEJY...', 'USDT:GCQTGZQQ...'],
      hops: 2,
      sourceAmount: '100.0000000',
      destinationAmount: '12.5000000',
      priceImpact: '0.60%',
      estimatedSlippage: '0.150%',
      efficiency: '12.3500'
    },
    alternativePaths: [...],
    evaluation: {
      totalPathsFound: 5,
      evaluationTimeMs: 250,
      timestamp: '2024-03-30T12:00:00.000Z'
    },
    recommendation: 'Single intermediate hop - good efficiency with minimal complexity'
  }
}
```

## Path Evaluation Metrics

### Efficiency Score

The efficiency score combines multiple factors:

- **Destination Amount**: Higher output is better
- **Hop Penalty**: Each hop reduces efficiency by 10%
- **Price Impact**: Higher impact reduces efficiency
- **Slippage**: Higher slippage reduces efficiency

Formula:

```
efficiency = destinationAmount × (1 - hopPenalty - impactPenalty - slippagePenalty)
```

### Price Impact

Calculated based on:

- Number of hops (0.3% per hop)
- Path complexity

### Estimated Slippage

Calculated using:

- Base slippage: 0.1%
- Hop multiplier: 1.5^(hops-1)

## Configuration

### Options

```typescript
interface PathFinderOptions {
  maxHops?: number; // Maximum hops (default: 5)
  minDestinationAmount?: string; // Minimum acceptable output
  includeAssets?: Asset[]; // Specific assets to include
  timeout?: number; // Timeout in ms (default: 10000)
}
```

### Supported Assets

Currently supports:

- **XLM**: Native Stellar asset
- **USDC**: Circle USD Coin
- **USDT**: Tether USD

To add more assets, update the `STELLAR_ASSETS` constant in:

- `src/Agents/tools/multiHopTradeTool.ts`
- `src/services/stellarPrice.service.ts`

## Best Practices

1. **Set Appropriate Max Hops**
   - 1-2 hops: Fast, low complexity
   - 3-4 hops: Balanced
   - 5+ hops: Comprehensive but slower

2. **Monitor Evaluation Time**
   - Typical: 100-500ms
   - High: >1000ms (consider reducing maxHops)

3. **Check Recommendations**
   - Direct paths are optimal
   - High price impact suggests splitting trades
   - High slippage requires careful monitoring

4. **Use Caching**
   - Price service includes caching
   - Cache TTL: 60 seconds
   - Invalidate when needed

## Testing

Run the test suite:

```bash
npm test tests/unit/multiHopPathFinder.test.ts
npm test tests/unit/multiHopTradeTool.test.ts
```

## Integration with Existing Features

### Risk Analysis

Combine with the existing risk analyzer:

```typescript
import { flashSwapRiskAnalyzer } from './services/flashSwapRiskAnalyzer';

const pathResult = await multiHopPathFinder.findOptimalPath(...);
const riskAnalysis = await flashSwapRiskAnalyzer.analyzeSwapRisk({
  fromAsset: sourceAsset,
  toAsset: destAsset,
  amount: parseFloat(pathResult.bestPath.sourceAmount)
});
```

### Agent Planner

The tool is automatically available to the agent planner:

```typescript
// Agent can now use multi-hop evaluation in workflows
const plan = await agentPlanner.createPlan({
  userId: "user-id",
  userInput: "Find the best path to swap 100 XLM to USDC",
});
```

## Performance Considerations

- **API Calls**: Makes 2 API calls per evaluation (strictSend + strictReceive)
- **Path Limit**: Evaluates up to 20 paths per API call
- **Timeout**: Default 10s, configurable
- **Caching**: Leverages existing price cache

## Future Enhancements

- [ ] Support for custom asset lists
- [ ] Historical path performance tracking
- [ ] Real-time liquidity depth analysis
- [ ] Path execution with automatic splitting
- [ ] MEV protection strategies
- [ ] Cross-DEX path finding (Stellar + Soroban)

## Troubleshooting

### No Paths Found

```typescript
// Error: No valid trading paths found
```

**Solutions**:

- Check asset liquidity on Stellar DEX
- Verify asset codes and issuers
- Increase maxHops parameter
- Check network connectivity

### Timeout Errors

```typescript
// Error: Path finding timed out
```

**Solutions**:

- Reduce maxHops
- Increase timeout parameter
- Check Horizon server performance

### Low Efficiency Scores

**Causes**:

- High number of hops
- Low liquidity
- Wide spreads

**Solutions**:

- Consider direct paths
- Split large trades
- Wait for better liquidity

## API Reference

See inline documentation in:

- `src/services/multiHopPathFinder.ts`
- `src/Agents/tools/multiHopTradeTool.ts`
- `src/services/stellarPrice.service.ts`
