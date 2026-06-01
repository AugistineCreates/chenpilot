# Multi-Hop Trade Path Evaluation

## Quick Start

```typescript
import { multiHopPathFinder } from "./src/services/multiHopPathFinder";
import * as StellarSdk from "@stellar/stellar-sdk";

// Find optimal path
const result = await multiHopPathFinder.findOptimalPath(
  StellarSdk.Asset.native(),
  new StellarSdk.Asset(
    "USDC",
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
  ),
  "100.0000000",
  { maxHops: 5 }
);

console.log("Best Path:", result.bestPath.route.join(" → "));
console.log("Efficiency:", result.bestPath.efficiency);
console.log("Total Paths Found:", result.allPaths.length);
```

## What's New

This implementation adds comprehensive multi-hop trade path evaluation to the Stellar DEX SDK:

- **Intelligent Path Discovery**: Finds all available trading routes across Stellar DEX
- **Efficiency Scoring**: Evaluates paths based on output amount, hops, price impact, and slippage
- **Multiple Integration Points**: Service API, Agent Tool, and Price Service integration
- **Smart Recommendations**: Context-aware suggestions for optimal trading

## Key Features

### 1. Path Discovery

- Queries both `strictSendPaths` and `strictReceivePaths` APIs
- Evaluates up to 40 paths per request
- Configurable maximum hops (default: 5)

### 2. Path Evaluation

- **Efficiency Score**: Combines multiple factors into single metric
- **Price Impact**: Calculated per hop with complexity adjustments
- **Slippage Estimation**: Exponential model based on path length
- **Route Comparison**: Automatic selection of optimal path

### 3. Integration Options

#### Option A: Direct Service

```typescript
import { multiHopPathFinder } from './src/services/multiHopPathFinder';
const result = await multiHopPathFinder.findOptimalPath(...);
```

#### Option B: Agent Tool

```typescript
import { toolRegistry } from './src/Agents/registry/ToolRegistry';
const result = await toolRegistry.executeTool('multi_hop_trade', {...}, 'user-id');
```

#### Option C: Price Service

```typescript
import stellarPriceService from "./src/services/stellarPrice.service";
const quote = await stellarPriceService.getPriceWithMultiHop(
  "XLM",
  "USDC",
  100
);
```

## Files Added

```
src/
├── services/
│   └── multiHopPathFinder.ts          # Core path finding service
└── Agents/
    └── tools/
        └── multiHopTradeTool.ts        # Agent tool wrapper

tests/
└── unit/
    ├── multiHopPathFinder.test.ts     # Service tests
    └── multiHopTradeTool.test.ts      # Tool tests

docs/
└── MULTI_HOP_TRADING.md               # Complete documentation

examples/
└── multiHopTradeExample.ts            # Usage examples
```

## Response Structure

```typescript
{
  bestPath: {
    route: ['XLM', 'USDC:GA5ZSEJY...', 'USDT:GCQTGZQQ...'],
    hops: 2,
    sourceAmount: '100.0000000',
    destinationAmount: '12.5000000',
    priceImpact: '0.60%',
    estimatedSlippage: '0.150%',
    efficiency: '12.3500'
  },
  allPaths: [...],  // All discovered paths
  evaluationTime: 250,  // ms
  timestamp: 1234567890
}
```

## Supported Assets

- **XLM**: Native Stellar Lumens
- **USDC**: Circle USD Coin
- **USDT**: Tether USD

## Configuration

```typescript
interface PathFinderOptions {
  maxHops?: number; // Default: 5
  minDestinationAmount?: string; // Optional minimum output
  includeAssets?: Asset[]; // Optional asset filter
  timeout?: number; // Default: 10000ms
}
```

## Testing

```bash
# Run all tests
npm test -- multiHop

# Run specific tests
npm test tests/unit/multiHopPathFinder.test.ts
npm test tests/unit/multiHopTradeTool.test.ts

# With coverage
npm test -- --coverage multiHop
```

## Documentation

- **Complete Guide**: `docs/MULTI_HOP_TRADING.md`
- **Implementation Summary**: `MULTI_HOP_IMPLEMENTATION_SUMMARY.md`
- **Examples**: `examples/multiHopTradeExample.ts`

## Performance

- **Typical Evaluation**: 100-500ms
- **API Calls**: 2 per evaluation
- **Path Limit**: Up to 40 paths evaluated
- **Timeout**: 10 seconds (configurable)

## Best Practices

1. **Set Appropriate Max Hops**
   - 1-2 hops: Fast, simple paths
   - 3-4 hops: Balanced approach
   - 5+ hops: Comprehensive but slower

2. **Monitor Evaluation Time**
   - <500ms: Good performance
   - > 1000ms: Consider reducing maxHops

3. **Check Recommendations**
   - Direct paths are optimal
   - High price impact → split trades
   - High slippage → monitor carefully

## Integration with Existing Features

### Risk Analysis

```typescript
import { flashSwapRiskAnalyzer } from './src/services/flashSwapRiskAnalyzer';

const pathResult = await multiHopPathFinder.findOptimalPath(...);
const riskAnalysis = await flashSwapRiskAnalyzer.analyzeSwapRisk({
  fromAsset: sourceAsset,
  toAsset: destAsset,
  amount: parseFloat(pathResult.bestPath.sourceAmount)
});
```

### Agent Planner

The tool is automatically available for natural language workflows:

```
User: "Find the best way to swap 100 XLM to USDC"
Agent: Automatically uses multi_hop_trade tool
```

## Troubleshooting

### No Paths Found

- Check asset liquidity on Stellar DEX
- Verify asset codes and issuers
- Increase maxHops parameter

### Timeout Errors

- Reduce maxHops
- Increase timeout parameter
- Check Horizon server status

### Low Efficiency Scores

- High number of hops
- Low liquidity
- Wide spreads
  → Consider direct paths or split trades

## Future Enhancements

- [ ] Dynamic asset discovery
- [ ] Historical path performance
- [ ] Real-time liquidity analysis
- [ ] Automatic trade execution
- [ ] MEV protection
- [ ] Cross-DEX integration

## Support

For issues or questions:

1. Check `docs/MULTI_HOP_TRADING.md` for detailed documentation
2. Review `examples/multiHopTradeExample.ts` for usage patterns
3. Run tests to verify functionality

## License

Same as parent project
