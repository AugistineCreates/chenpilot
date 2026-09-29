# Agent plan token and cost monitoring

LLM calls made by the agent planner record input tokens, output tokens, total tokens, provider, model, and an estimated USD cost. Metrics can be aggregated with `getAggregatedPlanCostMetrics()` from `src/observability/agentPlanMetrics.ts`.

The default cost model is Claude 3.5 Haiku pricing:

- Input: `$0.80` per million tokens
- Output: `$4.00` per million tokens

Override pricing with `AGENT_LLM_INPUT_COST_PER_MILLION_USD` and `AGENT_LLM_OUTPUT_COST_PER_MILLION_USD`.

## Anomaly threshold

A plan is flagged when its accumulated usage exceeds three times the typical plan size. The defaults are:

- `AGENT_PLAN_TYPICAL_TOKENS=4096`
- `AGENT_PLAN_TOKEN_ANOMALY_MULTIPLIER=3`

Anomalies emit a warning through the application logger and are exposed in the aggregated `anomalousPlans` count. Set the environment variables explicitly when traffic or prompts have a different normal size.
