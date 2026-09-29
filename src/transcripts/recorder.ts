import { randomUUID } from 'crypto';
import type {
  ExecutionTranscript,
  ToolCall,
} from './schema';
import {
  sha256,
  scrubPII,
  assertNoSecrets,
  computeInputHash,
} from './schema';

/**
 * Records an execution transcript during a live LLM decision.
 * Wire this into the agent's decision loop.
 */
export class TranscriptRecorder {
  private toolCalls: ToolCall[] = [];

  /** Call this when the agent makes a tool call. */
  recordToolCall(
    toolName: string,
    args: unknown,
    result: unknown,
    requiresNetwork: boolean
  ): void {
    this.toolCalls.push({
      toolName,
      argumentsHash: sha256(JSON.stringify(args)),
      scrubbedResult: scrubPII(result),
      requiresNetwork,
    });
  }

  /** Call this after the LLM responds to produce the final transcript. */
  buildTranscript(params: {
    modelId: string;
    samplingParams: Record<string, unknown>;
    systemPrompt: string;
    fullPrompt: string;
    tools: { name: string; schema: unknown; version?: string }[];
    contextDocuments: string[];
    contextQuery: string;
    retrievalStrategy?: string;
    decision: string;
    finishReason: string;
    outputTokenCount?: number;
    agentVersion: string;
  }): ExecutionTranscript {
    const partial = {
      meta: {
        transcriptId: randomUUID(),
        timestamp: new Date().toISOString(),
        agentVersion: params.agentVersion,
        schemaVersion: '1.0' as const,
      },
      model: {
        modelId: params.modelId,
        modelIdHash: sha256(params.modelId),
        temperature: (params.samplingParams.temperature as number) ?? 1,
        topP: params.samplingParams.topP as number | undefined,
        maxTokens: params.samplingParams.maxTokens as number | undefined,
        samplingParams: params.samplingParams,
      },
      prompt: {
        promptHash: sha256(params.fullPrompt),
        systemPromptHash: sha256(params.systemPrompt),
        promptTokenCount: undefined,
        templateVersion: undefined,
      },
      tools: params.tools.map((t) => ({
        name: t.name,
        schemaHash: sha256(JSON.stringify(t.schema)),
        version: t.version,
      })),
      context: {
        documentHashes: params.contextDocuments.map(sha256),
        queryHash: sha256(params.contextQuery),
        retrievalStrategy: params.retrievalStrategy,
        documentCount: params.contextDocuments.length,
      },
      toolCalls: this.toolCalls,
    };

    const transcript: ExecutionTranscript = {
      ...partial,
      output: {
        decision: params.decision,
        decisionHash: sha256(params.decision),
        outputTokenCount: params.outputTokenCount,
        finishReason: params.finishReason,
      },
      inputHash: computeInputHash(partial),
    };

    // Safety check: no secrets leaked into transcript
    assertNoSecrets(transcript);

    return transcript;
  }

  /** Reset recorder for next decision */
  reset(): void {
    this.toolCalls = [];
  }
}
