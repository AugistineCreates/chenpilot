import { createHash } from 'crypto';

/**
 * Immutable execution transcript for a single LLM decision.
 * Captures every input that could affect the output, with hashes
 * for reproducibility verification.
 *
 * Privacy guarantees (by construction):
 * - Secrets are never included — see ExcludedFields
 * - PII fields are hashed, not stored literally
 * - Tool results are stored but PII-scrubbed before capture
 */
export interface TranscriptMetadata {
  /** Unique ID for this transcript */
  transcriptId: string;

  /** ISO 8601 timestamp when decision was made */
  timestamp: string;

  /** Version of chenpilot that produced this transcript */
  agentVersion: string;

  /** Schema version for forward compatibility */
  schemaVersion: '1.0';
}

export interface ModelSnapshot {
  /** Exact model identifier (e.g. claude-3-5-sonnet-20241022) */
  modelId: string;

  /** SHA-256 of the modelId string — for quick comparison */
  modelIdHash: string;

  /** Sampling parameters used */
  temperature: number;

  topP?: number;

  maxTokens?: number;

  /** Any other sampling params that affect output distribution */
  samplingParams: Record<string, unknown>;
}

export interface PromptSnapshot {
  /** SHA-256 hash of the full assembled prompt */
  promptHash: string;

  /** SHA-256 hash of the system prompt only */
  systemPromptHash: string;

  /** Number of tokens in the prompt (for drift detection) */
  promptTokenCount?: number;

  /** Template version used to assemble this prompt */
  templateVersion?: string;
}

export interface ToolSnapshot {
  /** Name of the tool */
  name: string;

  /** SHA-256 of the full tool schema JSON */
  schemaHash: string;

  /** Tool schema version string if present */
  version?: string;
}

export interface ContextSnapshot {
  /** SHA-256 of each retrieved context document */
  documentHashes: string[];

  /** Retrieval query hash (not the query itself — may contain PII) */
  queryHash: string;

  /** Retrieval strategy used (e.g. 'semantic', 'bm25', 'hybrid') */
  retrievalStrategy?: string;

  /** Number of documents retrieved */
  documentCount: number;
}

export interface ToolCall {
  /** Tool name called */
  toolName: string;

  /** SHA-256 of the tool arguments — arguments may contain PII */
  argumentsHash: string;

  /**
   * Recorded tool result for offline replay.
   * PII-scrubbed before capture — see scrubPII().
   * null if tool call failed.
   */
  scrubbedResult: unknown | null;

  /** Whether this tool call required network access */
  requiresNetwork: boolean;
}

export interface DecisionOutput {
  /** The decision/plan produced by the LLM */
  decision: string;

  /** SHA-256 of the decision text */
  decisionHash: string;

  /** Number of output tokens */
  outputTokenCount?: number;

  /** Finish reason (stop, length, tool_use, etc.) */
  finishReason: string;
}

/**
 * Complete immutable execution transcript.
 * All fields required unless marked optional.
 */
export interface ExecutionTranscript {
  meta: TranscriptMetadata;

  model: ModelSnapshot;

  prompt: PromptSnapshot;

  tools: ToolSnapshot[];

  context: ContextSnapshot;

  toolCalls: ToolCall[];

  output: DecisionOutput;

  /**
   * Hash of all decision inputs combined.
   * If two transcripts have the same inputHash, they should produce
   * identical outputs barring model non-determinism.
   */
  inputHash: string;
}

/** Fields that must NEVER appear in a transcript. */
const EXCLUDED_FIELDS = [
  'api_key',
  'apikey',
  'secret',
  'token',
  'password',
  'authorization',
  'bearer',
  'credential',
] as const;

/** PII patterns to scrub from tool results. */
const PII_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, // email
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, // phone
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, // credit card
];

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Scrubs PII from tool results before storing in transcript.
 * Replaces matched patterns with [REDACTED].
 */
export function scrubPII(data: unknown): unknown {
  const str = JSON.stringify(data);
  let scrubbed = str;

  for (const pattern of PII_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, '[REDACTED]');
  }

  try {
    return JSON.parse(scrubbed);
  } catch {
    // If parse fails, return original data
    return data;
  }
}

/**
 * Verifies no secret fields appear in the transcript.
 * Called before writing transcript to storage.
 */
export function assertNoSecrets(transcript: ExecutionTranscript): void {
  const str = JSON.stringify(transcript).toLowerCase();

  for (const field of EXCLUDED_FIELDS) {
    // Check if field name appears as a key (followed by colon)
    if (str.includes(`"${field}"`)) {
      throw new Error(
        `Secret field "${field}" found in transcript — this is a bug`
      );
    }
  }
}

/**
 * Computes the combined input hash for reproducibility comparison.
 */
export function computeInputHash(
  transcript: Omit<ExecutionTranscript, 'inputHash' | 'output'>
): string {
  const inputs = {
    modelId: transcript.model.modelId,
    samplingParams: transcript.model.samplingParams,
    promptHash: transcript.prompt.promptHash,
    toolSchemaHashes: transcript.tools.map((t) => t.schemaHash).sort(),
    contextHashes: transcript.context.documentHashes.sort(),
  };

  return sha256(JSON.stringify(inputs));
}
