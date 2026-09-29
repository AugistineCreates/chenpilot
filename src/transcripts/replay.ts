import type { ExecutionTranscript } from './schema';
import { sha256, computeInputHash } from './schema';
import { TranscriptRecorder } from './recorder';

export interface ReplayResult {
  /** Whether the replay produced the same decision */
  matched: boolean;

  /** The original transcript */
  original: ExecutionTranscript;

  /** The transcript from replay */
  replayed: ExecutionTranscript;

  /** First decision boundary where divergence occurred */
  firstDivergencePoint?: DivergencePoint;

  /** All divergences found */
  divergences: DivergencePoint[];
}

export interface DivergencePoint {
  /** What changed */
  field: string;

  /** Original value hash */
  originalHash: string;

  /** Replayed value hash */
  replayedHash: string;

  /** Human-readable classification */
  classification: 'model_drift' | 'tool_drift' | 'policy_drift' | 'prompt_drift' | 'context_drift';
}

/**
 * Replays an execution transcript offline using recorded tool results.
 * No network access — all tool calls use scrubbedResult from transcript.
 *
 * Distinguishes model drift from tool/policy drift by comparing
 * input hashes against output hashes.
 */
export async function replayTranscript(
  transcript: ExecutionTranscript,
  callLLM: (params: {
    modelId: string;
    prompt: string;
    tools: unknown[];
    samplingParams: Record<string, unknown>;
    recordedToolResults: Map<string, unknown>;
  }) => Promise<{ decision: string; finishReason: string; outputTokenCount?: number }>,
  currentAgentVersion: string
): Promise<ReplayResult> {
  // Reconstruct prompt from transcript metadata
  // (prompt content is not stored — only its hash)
  // Replay uses the SAME hashes to verify inputs match
  const recorder = new TranscriptRecorder();

  // Provide recorded tool results — no network access
  const toolResultMap = new Map(
    transcript.toolCalls.map((tc) => [tc.toolName, tc.scrubbedResult])
  );

  const { decision, finishReason, outputTokenCount } = await callLLM({
    modelId: transcript.model.modelId,
    prompt: '[reconstructed from transcript]', // caller provides
    tools: [], // caller provides current tool schemas
    samplingParams: transcript.model.samplingParams,
    recordedToolResults: toolResultMap,
  });

  const replayed = recorder.buildTranscript({
    agentVersion: currentAgentVersion,
    decision,
    finishReason,
    modelId: transcript.model.modelId,
    samplingParams: transcript.model.samplingParams,
    systemPrompt: '',
    fullPrompt: '',
    tools: [],
    contextDocuments: [],
    contextQuery: '',
    outputTokenCount,
  });

  const divergences = detectDivergences(transcript, replayed);

  return {
    matched: divergences.length === 0,
    original: transcript,
    replayed,
    firstDivergencePoint: divergences[0],
    divergences,
  };
}

function detectDivergences(
  original: ExecutionTranscript,
  replayed: ExecutionTranscript
): DivergencePoint[] {
  const divergences: DivergencePoint[] = [];

  // Model drift: same inputs, different output
  if (
    original.inputHash === replayed.inputHash &&
    original.output.decisionHash !== replayed.output.decisionHash
  ) {
    divergences.push({
      field: 'output.decision',
      originalHash: original.output.decisionHash,
      replayedHash: replayed.output.decisionHash,
      classification: 'model_drift',
    });
  }

  // Tool drift: tool schema changed
  for (const origTool of original.tools) {
    const replayTool = replayed.tools.find((t) => t.name === origTool.name);

    if (!replayTool || replayTool.schemaHash !== origTool.schemaHash) {
      divergences.push({
        field: `tools.${origTool.name}`,
        originalHash: origTool.schemaHash,
        replayedHash: replayTool?.schemaHash ?? 'missing',
        classification: 'tool_drift',
      });
    }
  }

  // Prompt drift
  if (original.prompt.promptHash !== replayed.prompt.promptHash) {
    divergences.push({
      field: 'prompt',
      originalHash: original.prompt.promptHash,
      replayedHash: replayed.prompt.promptHash,
      classification: 'prompt_drift',
    });
  }

  // Context drift
  const origContextHash = sha256(
    JSON.stringify(original.context.documentHashes.sort())
  );
  const replayContextHash = sha256(
    JSON.stringify(replayed.context.documentHashes.sort())
  );

  if (origContextHash !== replayContextHash) {
    divergences.push({
      field: 'context',
      originalHash: origContextHash,
      replayedHash: replayContextHash,
      classification: 'context_drift',
    });
  }

  return divergences;
}
