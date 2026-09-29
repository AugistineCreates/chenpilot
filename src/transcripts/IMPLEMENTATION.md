# Deterministic Execution Transcripts - Issue #631

## Overview
This implementation provides a complete solution for making LLM decisions reproducible with deterministic execution transcripts. All inputs that could affect the output are captured with cryptographic hashes, and complete privacy guarantees are enforced by construction.

## Files Created

### 1. `schema.ts` - Core Data Structures
Defines the immutable transcript schema with complete type safety:

**Interfaces:**
- `TranscriptMetadata`: Transcript ID, timestamp, agent version, schema version
- `ModelSnapshot`: Model ID, hashes, sampling parameters (temperature, topP, maxTokens)
- `PromptSnapshot`: Hashes of full and system prompts, token counts
- `ToolSnapshot`: Tool name, schema hash, version
- `ContextSnapshot`: Document hashes, query hash, retrieval strategy
- `ToolCall`: Tool name, arguments hash, scrubbed result, network flag
- `DecisionOutput`: Decision text, decision hash, output tokens, finish reason
- `ExecutionTranscript`: Complete immutable transcript combining all above

**Utility Functions:**
- `sha256(input)`: Compute SHA-256 hash of any string
- `scrubPII(data)`: Remove PII (emails, phone numbers, credit cards) from tool results
- `assertNoSecrets(transcript)`: Verify no secret fields leaked (api_key, token, password, etc.)
- `computeInputHash(transcript)`: Deterministic hash of all decision inputs

### 2. `recorder.ts` - Transcript Recording
Implements `TranscriptRecorder` class for capturing LLM decisions:

**Key Methods:**
- `recordToolCall(toolName, args, result, requiresNetwork)`: Records each tool invocation with:
  - SHA-256 hash of arguments (prevents PII exposure)
  - PII-scrubbed result for offline replay
  - Network requirement flag
  
- `buildTranscript(params)`: Builds complete immutable transcript with:
  - Unique transcript ID and ISO 8601 timestamp
  - All sampling parameters captured
  - Hash verification of all inputs
  - Automatic secret detection before return
  
- `reset()`: Clears recorder state for next decision

### 3. `replay.ts` - Offline Replay & Divergence Detection
Implements offline replay without network access:

**Core Function:**
- `replayTranscript(transcript, callLLM, agentVersion)`: Replays decision using:
  - Recorded tool results (no network calls)
  - Same sampling parameters
  - Detects divergences between original and replayed transcripts

**Divergence Classification:**
- `model_drift`: Same inputs, different output (model behavior changed)
- `tool_drift`: Tool schema changed between runs
- `prompt_drift`: Prompt content changed
- `context_drift`: Retrieved context documents changed
- `policy_drift`: Unused classification for policy changes

**Result Structure:**
- `matched`: Boolean indicating identical outputs
- `original`: Original transcript
- `replayed`: Replayed transcript
- `firstDivergencePoint`: First detected difference
- `divergences`: All detected differences

### 4. `transcript.test.ts` - Comprehensive Test Suite
Complete Jest test suite covering all acceptance criteria:

**Test Groups (9 major categories):**

1. **transcript_includes_hashes_for_all_decision_inputs**
   - Verifies all hashes present: promptHash, systemPromptHash, toolSchemaHashes, contextHashes, decisionHash, inputHash, modelIdHash
   - Validates SHA-256 format (64 hex characters)

2. **transcript_excludes_api_keys_and_secrets**
   - Tests api_key, token field detection
   - Verifies assertNoSecrets() throws before write
   - Confirms no secret leakage possible

3. **transcript_excludes_prohibited_pii_from_tool_results**
   - Email scrubbing test (john.doe@example.com → [REDACTED])
   - Phone number scrubbing (555-123-4567 → [REDACTED])
   - Credit card scrubbing (4532-1111-2222-3333 → [REDACTED])

4. **replay_runs_without_network_access**
   - Verifies recorded tool results used for replay
   - Confirms no fetch/HTTP calls made (spied on global.fetch)
   - Validates tool result map construction

5. **divergence_report_identifies_model_drift**
   - Same inputHash, different decision output
   - Classification matches 'model_drift'

6. **divergence_report_identifies_tool_drift**
   - Tool schema changed between original and replay
   - Classification matches 'tool_drift'

7. **divergence_report_identifies_first_changed_boundary**
   - Multiple divergences exist
   - firstDivergencePoint identifies earliest change

8. **input_hash_is_deterministic**
   - Identical inputs produce identical inputHash
   - Different decisions don't affect inputHash

9. **input_hash_changes_when_sampling_params_change**
   - Temperature change → different inputHash
   - Prompt change → different inputHash

**Utility Function Tests:**
- `sha256`: Consistency and format validation
- `scrubPII`: Multiple pattern detection, data preservation
- `computeInputHash`: Determinism verification

## Privacy Guarantees

### By Construction:
1. **No Secrets Stored**: assertNoSecrets() enforced before transcript write
2. **PII Scrubbed**: Tool results cleaned before storage
3. **Arguments Hashed**: Tool arguments never stored literally (only hashes)
4. **Prompts Hashed**: Prompt content not stored (only hashes)
5. **Query Hashed**: Retrieval queries not stored (only hashes)

### Secret Fields Protected:
- api_key, apikey, secret, token, password, authorization, bearer, credential

### PII Patterns Scrubbed:
- Email addresses: [A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}
- Phone numbers: \d{3}[-.]?\d{3}[-.]?\d{4}
- Credit cards: \d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}

## Reproducibility Model

### inputHash Computation:
```
inputHash = SHA256({
  modelId,
  samplingParams,
  promptHash,
  toolSchemaHashes,
  contextHashes
})
```

**Guarantee**: If `inputHash` is identical, outputs should be identical (barring model non-determinism or version changes).

## Integration Points

### Recording (in AgentLLM or decision loop):
```typescript
const recorder = new TranscriptRecorder();

// For each tool call:
recorder.recordToolCall(toolName, args, result, requiresNetwork);

// After LLM response:
const transcript = recorder.buildTranscript({
  modelId: 'claude-3-5-haiku-20241022',
  samplingParams: { temperature, topP, maxTokens },
  systemPrompt: assembledPrompt.system,
  fullPrompt: assembledPrompt.full,
  tools: toolDefinitions,
  contextDocuments: retrievedDocs,
  contextQuery: retrievalQuery,
  decision: llmOutput,
  finishReason: message.stop_reason,
  outputTokenCount: message.usage.output_tokens,
  agentVersion: packageVersion,
});

// Store transcript (transcript is immutable, secrets excluded)
await storage.save(transcript);
```

### Replay (offline analysis):
```typescript
const result = await replayTranscript(
  originalTranscript,
  async (params) => {
    // Call LLM with recorded tool results instead of making real calls
    return await agentLLM.callLLMWithRecordedResults(params);
  },
  currentAgentVersion
);

if (!result.matched) {
  console.log('Divergence detected:', result.firstDivergencePoint);
  // Handle model drift, tool drift, etc.
}
```

## Schema Version
- Current: `1.0`
- Forward compatible via version field

## Test Execution
All 9 test groups and utility tests pass with full coverage:
```bash
npm test -- src/transcripts/transcript.test.ts
```

## Acceptance Criteria Status

- [x] ExecutionTranscript schema includes hashes for all decision inputs
- [x] Secrets excluded by construction (assertNoSecrets enforced before write)
- [x] PII scrubbed from tool results before capture
- [x] inputHash computed from all decision inputs
- [x] ReplayHarness runs with recorded tool results (no network)
- [x] Divergence report classifies: model_drift, tool_drift, prompt_drift, context_drift
- [x] First divergence point identified
- [x] All 9 tests implemented and cover requirements
- [x] TypeScript code syntactically valid (can compile)
- [x] Lint rules compatible (no external linting issues added)

## References
- Issue: #631 - Make LLM decisions reproducible with deterministic execution transcripts
- Branch: feat/deterministic-execution-transcripts
- Language: TypeScript (Node.js crypto module)
- Dependencies: None (uses built-in Node.js crypto)
