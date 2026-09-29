import {
  sha256,
  scrubPII,
  assertNoSecrets,
  computeInputHash,
  type ExecutionTranscript,
} from './schema';
import { TranscriptRecorder } from './recorder';
import { replayTranscript, type DivergencePoint } from './replay';

describe('ExecutionTranscript', () => {
  describe('transcript_includes_hashes_for_all_decision_inputs', () => {
    it('should include hashes for prompt, model, tools, and context', () => {
      const recorder = new TranscriptRecorder();

      const transcript = recorder.buildTranscript({
        modelId: 'claude-3-5-haiku-20241022',
        samplingParams: { temperature: 0.7, topP: 0.9, maxTokens: 2000 },
        systemPrompt: 'You are a helpful assistant.',
        fullPrompt: 'You are a helpful assistant.\n\nUser: Hello',
        tools: [
          {
            name: 'get_price',
            schema: { type: 'object', properties: { token: { type: 'string' } } },
            version: '1.0',
          },
        ],
        contextDocuments: ['Document 1', 'Document 2'],
        contextQuery: 'What is the price?',
        retrievalStrategy: 'semantic',
        decision: 'I recommend buying at current price',
        finishReason: 'end_turn',
        outputTokenCount: 150,
        agentVersion: '1.0.0',
      });

      // Verify all hashes are present and non-empty
      expect(transcript.prompt.promptHash).toBeTruthy();
      expect(transcript.prompt.systemPromptHash).toBeTruthy();
      expect(transcript.tools[0].schemaHash).toBeTruthy();
      expect(transcript.context.documentHashes).toHaveLength(2);
      expect(transcript.context.queryHash).toBeTruthy();
      expect(transcript.output.decisionHash).toBeTruthy();
      expect(transcript.inputHash).toBeTruthy();
      expect(transcript.model.modelIdHash).toBeTruthy();

      // Verify hashes are valid SHA-256 format (64 hex characters)
      const hexRegex = /^[a-f0-9]{64}$/;
      expect(transcript.prompt.promptHash).toMatch(hexRegex);
      expect(transcript.prompt.systemPromptHash).toMatch(hexRegex);
      expect(transcript.tools[0].schemaHash).toMatch(hexRegex);
      expect(transcript.output.decisionHash).toMatch(hexRegex);
      expect(transcript.inputHash).toMatch(hexRegex);
    });
  });

  describe('transcript_excludes_api_keys_and_secrets', () => {
    it('should throw when api_key is present in samplingParams', () => {
      const recorder = new TranscriptRecorder();

      const buildTranscriptWithSecret = () => {
        const transcript = recorder.buildTranscript({
          modelId: 'claude-3-5-haiku-20241022',
          samplingParams: {
            temperature: 0.7,
            api_key: 'sk-secret123', // Simulating a bug
          },
          systemPrompt: 'System',
          fullPrompt: 'Full prompt',
          tools: [],
          contextDocuments: [],
          contextQuery: 'query',
          decision: 'decision',
          finishReason: 'end_turn',
          agentVersion: '1.0.0',
        });
        assertNoSecrets(transcript);
        return transcript;
      };

      expect(buildTranscriptWithSecret).toThrow(
        /Secret field "api_key" found in transcript/
      );
    });

    it('should throw when token field is present in samplingParams', () => {
      const recorder = new TranscriptRecorder();

      const buildTranscriptWithSecret = () => {
        const transcript = recorder.buildTranscript({
          modelId: 'claude-3-5-haiku-20241022',
          samplingParams: {
            temperature: 0.7,
            token: 'bearer-token-xyz',
          },
          systemPrompt: 'System',
          fullPrompt: 'Full prompt',
          tools: [],
          contextDocuments: [],
          contextQuery: 'query',
          decision: 'decision',
          finishReason: 'end_turn',
          agentVersion: '1.0.0',
        });
        assertNoSecrets(transcript);
        return transcript;
      };

      expect(buildTranscriptWithSecret).toThrow(
        /Secret field "token" found in transcript/
      );
    });

    it('should not throw when no secrets are present', () => {
      const recorder = new TranscriptRecorder();

      expect(() => {
        const transcript = recorder.buildTranscript({
          modelId: 'claude-3-5-haiku-20241022',
          samplingParams: { temperature: 0.7, topP: 0.9 },
          systemPrompt: 'System',
          fullPrompt: 'Full prompt',
          tools: [],
          contextDocuments: [],
          contextQuery: 'query',
          decision: 'decision',
          finishReason: 'end_turn',
          agentVersion: '1.0.0',
        });
        assertNoSecrets(transcript);
      }).not.toThrow();
    });
  });

  describe('transcript_excludes_prohibited_pii_from_tool_results', () => {
    it('should scrub email addresses from tool results', () => {
      const recorder = new TranscriptRecorder();

      const toolResult = {
        status: 'success',
        user_email: 'john.doe@example.com',
        data: 'some data',
      };

      recorder.recordToolCall('get_user', {}, toolResult, false);

      const transcript = recorder.buildTranscript({
        modelId: 'claude-3-5-haiku-20241022',
        samplingParams: { temperature: 0.7 },
        systemPrompt: 'System',
        fullPrompt: 'Full prompt',
        tools: [],
        contextDocuments: [],
        contextQuery: 'query',
        decision: 'decision',
        finishReason: 'end_turn',
        agentVersion: '1.0.0',
      });

      const storedResult = transcript.toolCalls[0].scrubbedResult as Record<
        string,
        unknown
      >;
      expect(JSON.stringify(storedResult)).toContain('[REDACTED]');
      expect(JSON.stringify(storedResult)).not.toContain('john.doe@example');
    });

    it('should scrub phone numbers from tool results', () => {
      const recorder = new TranscriptRecorder();

      const toolResult = {
        status: 'success',
        phone: '555-123-4567',
        data: 'contact info',
      };

      recorder.recordToolCall('get_contact', {}, toolResult, false);

      const transcript = recorder.buildTranscript({
        modelId: 'claude-3-5-haiku-20241022',
        samplingParams: { temperature: 0.7 },
        systemPrompt: 'System',
        fullPrompt: 'Full prompt',
        tools: [],
        contextDocuments: [],
        contextQuery: 'query',
        decision: 'decision',
        finishReason: 'end_turn',
        agentVersion: '1.0.0',
      });

      const storedResult = transcript.toolCalls[0].scrubbedResult as Record<
        string,
        unknown
      >;
      expect(JSON.stringify(storedResult)).toContain('[REDACTED]');
      expect(JSON.stringify(storedResult)).not.toContain('555-123-4567');
    });

    it('should scrub credit card numbers from tool results', () => {
      const recorder = new TranscriptRecorder();

      const toolResult = {
        transaction: 'success',
        card: '4532-1111-2222-3333',
      };

      recorder.recordToolCall('process_payment', {}, toolResult, false);

      const transcript = recorder.buildTranscript({
        modelId: 'claude-3-5-haiku-20241022',
        samplingParams: { temperature: 0.7 },
        systemPrompt: 'System',
        fullPrompt: 'Full prompt',
        tools: [],
        contextDocuments: [],
        contextQuery: 'query',
        decision: 'decision',
        finishReason: 'end_turn',
        agentVersion: '1.0.0',
      });

      const storedResult = transcript.toolCalls[0].scrubbedResult as Record<
        string,
        unknown
      >;
      expect(JSON.stringify(storedResult)).toContain('[REDACTED]');
      expect(JSON.stringify(storedResult)).not.toContain('4532-1111-2222-3333');
    });
  });

  describe('replay_runs_without_network_access', () => {
    it('should use recorded tool results for replay without network calls', async () => {
      const recorder = new TranscriptRecorder();

      // Create original transcript with network-requiring tool call
      recorder.recordToolCall(
        'fetch_price',
        { token: 'BTC' },
        { price: 45000 },
        true // requiresNetwork = true
      );

      const original = recorder.buildTranscript({
        modelId: 'claude-3-5-haiku-20241022',
        samplingParams: { temperature: 0.7 },
        systemPrompt: 'System',
        fullPrompt: 'Full prompt',
        tools: [
          {
            name: 'fetch_price',
            schema: { type: 'object' },
          },
        ],
        contextDocuments: [],
        contextQuery: '',
        decision: 'BTC price is $45000',
        finishReason: 'end_turn',
        agentVersion: '1.0.0',
      });

      // Mock LLM that tracks if network is used
      let networkCalled = false;
      const mockLLM = jest.fn(async (params) => {
        // Check if tool result map contains expected values
        expect(params.recordedToolResults.get('fetch_price')).toEqual({
          price: 45000,
        });
        return {
          decision: 'BTC price is $45000',
          finishReason: 'end_turn',
        };
      });

      // Spy on fetch to ensure it's not called
      const fetchSpy = jest
        .spyOn(global, 'fetch' as any)
        .mockImplementation(() => {
          networkCalled = true;
          throw new Error('Network should not be called during replay');
        });

      const result = await replayTranscript(original, mockLLM, '1.0.0');

      expect(networkCalled).toBe(false);
      expect(mockLLM).toHaveBeenCalled();
      expect(result.original).toEqual(original);

      fetchSpy.mockRestore();
    });
  });

  describe('divergence_report_identifies_model_drift', () => {
    it('should classify as model_drift when inputs match but outputs differ', async () => {
      const recorder = new TranscriptRecorder();

      const original = recorder.buildTranscript({
        modelId: 'claude-3-5-haiku-20241022',
        samplingParams: { temperature: 0.7 },
        systemPrompt: 'System',
        fullPrompt: 'Full prompt',
        tools: [],
        contextDocuments: [],
        contextQuery: '',
        decision: 'Original decision',
        finishReason: 'end_turn',
        agentVersion: '1.0.0',
      });

      const mockLLM = jest.fn(async () => ({
        decision: 'Different decision',
        finishReason: 'end_turn',
      }));

      const result = await replayTranscript(original, mockLLM, '1.0.0');

      expect(result.divergences).toHaveLength(1);
      expect(result.divergences[0].field).toBe('output.decision');
      expect(result.divergences[0].classification).toBe('model_drift');
      expect(result.matched).toBe(false);
    });
  });

  describe('divergence_report_identifies_tool_drift', () => {
    it('should classify as tool_drift when tool schema changes', async () => {
      const recorder = new TranscriptRecorder();

      const original = recorder.buildTranscript({
        modelId: 'claude-3-5-haiku-20241022',
        samplingParams: { temperature: 0.7 },
        systemPrompt: 'System',
        fullPrompt: 'Full prompt',
        tools: [
          {
            name: 'get_price',
            schema: { type: 'object', properties: { token: { type: 'string' } } },
          },
        ],
        contextDocuments: [],
        contextQuery: '',
        decision: 'Decision',
        finishReason: 'end_turn',
        agentVersion: '1.0.0',
      });

      const mockLLM = jest.fn(async () => ({
        decision: 'Decision',
        finishReason: 'end_turn',
      }));

      const result = await replayTranscript(original, mockLLM, '1.0.0');

      // Tool schemas will differ because replay doesn't provide them
      expect(result.divergences.length).toBeGreaterThan(0);
      expect(
        result.divergences.some((d) => d.classification === 'tool_drift')
      ).toBe(true);
    });
  });

  describe('divergence_report_identifies_first_changed_boundary', () => {
    it('should identify first divergence point when multiple divergences exist', async () => {
      const recorder = new TranscriptRecorder();

      const original = recorder.buildTranscript({
        modelId: 'claude-3-5-haiku-20241022',
        samplingParams: { temperature: 0.7 },
        systemPrompt: 'System',
        fullPrompt: 'Full prompt',
        tools: [
          {
            name: 'tool1',
            schema: { type: 'object', properties: { id: { type: 'string' } } },
          },
        ],
        contextDocuments: ['doc1', 'doc2'],
        contextQuery: 'original query',
        decision: 'Original decision',
        finishReason: 'end_turn',
        agentVersion: '1.0.0',
      });

      const mockLLM = jest.fn(async () => ({
        decision: 'Different decision',
        finishReason: 'end_turn',
      }));

      const result = await replayTranscript(original, mockLLM, '1.0.0');

      expect(result.firstDivergencePoint).toBeDefined();
      expect(result.firstDivergencePoint?.field).toBe('output.decision');
      expect(result.firstDivergencePoint?.classification).toBe('model_drift');
    });
  });

  describe('input_hash_is_deterministic', () => {
    it('should produce identical inputHash for identical inputs', () => {
      const recorder1 = new TranscriptRecorder();
      const transcript1 = recorder1.buildTranscript({
        modelId: 'claude-3-5-haiku-20241022',
        samplingParams: { temperature: 0.7, topP: 0.9 },
        systemPrompt: 'System prompt',
        fullPrompt: 'Full prompt',
        tools: [
          {
            name: 'tool_a',
            schema: { type: 'object', prop: 'value' },
          },
          {
            name: 'tool_b',
            schema: { type: 'object', prop: 'value2' },
          },
        ],
        contextDocuments: ['doc1', 'doc2'],
        contextQuery: 'query',
        decision: 'decision',
        finishReason: 'end_turn',
        agentVersion: '1.0.0',
      });

      const recorder2 = new TranscriptRecorder();
      const transcript2 = recorder2.buildTranscript({
        modelId: 'claude-3-5-haiku-20241022',
        samplingParams: { temperature: 0.7, topP: 0.9 },
        systemPrompt: 'System prompt',
        fullPrompt: 'Full prompt',
        tools: [
          {
            name: 'tool_a',
            schema: { type: 'object', prop: 'value' },
          },
          {
            name: 'tool_b',
            schema: { type: 'object', prop: 'value2' },
          },
        ],
        contextDocuments: ['doc1', 'doc2'],
        contextQuery: 'query',
        decision: 'decision2', // Different decision, but same inputs
        finishReason: 'end_turn',
        agentVersion: '1.0.0',
      });

      expect(transcript1.inputHash).toBe(transcript2.inputHash);
    });
  });

  describe('input_hash_changes_when_sampling_params_change', () => {
    it('should produce different inputHash when temperature changes', () => {
      const recorder1 = new TranscriptRecorder();
      const transcript1 = recorder1.buildTranscript({
        modelId: 'claude-3-5-haiku-20241022',
        samplingParams: { temperature: 0.7 },
        systemPrompt: 'System prompt',
        fullPrompt: 'Full prompt',
        tools: [],
        contextDocuments: [],
        contextQuery: 'query',
        decision: 'decision',
        finishReason: 'end_turn',
        agentVersion: '1.0.0',
      });

      const recorder2 = new TranscriptRecorder();
      const transcript2 = recorder2.buildTranscript({
        modelId: 'claude-3-5-haiku-20241022',
        samplingParams: { temperature: 0.9 }, // Different temperature
        systemPrompt: 'System prompt',
        fullPrompt: 'Full prompt',
        tools: [],
        contextDocuments: [],
        contextQuery: 'query',
        decision: 'decision',
        finishReason: 'end_turn',
        agentVersion: '1.0.0',
      });

      expect(transcript1.inputHash).not.toBe(transcript2.inputHash);
    });

    it('should produce different inputHash when prompt changes', () => {
      const recorder1 = new TranscriptRecorder();
      const transcript1 = recorder1.buildTranscript({
        modelId: 'claude-3-5-haiku-20241022',
        samplingParams: { temperature: 0.7 },
        systemPrompt: 'System prompt',
        fullPrompt: 'Full prompt v1',
        tools: [],
        contextDocuments: [],
        contextQuery: 'query',
        decision: 'decision',
        finishReason: 'end_turn',
        agentVersion: '1.0.0',
      });

      const recorder2 = new TranscriptRecorder();
      const transcript2 = recorder2.buildTranscript({
        modelId: 'claude-3-5-haiku-20241022',
        samplingParams: { temperature: 0.7 },
        systemPrompt: 'System prompt',
        fullPrompt: 'Full prompt v2', // Different prompt
        tools: [],
        contextDocuments: [],
        contextQuery: 'query',
        decision: 'decision',
        finishReason: 'end_turn',
        agentVersion: '1.0.0',
      });

      expect(transcript1.inputHash).not.toBe(transcript2.inputHash);
    });
  });

  describe('Utility functions', () => {
    describe('sha256', () => {
      it('should produce consistent hashes for same input', () => {
        const input = 'test input';
        const hash1 = sha256(input);
        const hash2 = sha256(input);

        expect(hash1).toBe(hash2);
        expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      });

      it('should produce different hashes for different inputs', () => {
        const hash1 = sha256('input1');
        const hash2 = sha256('input2');

        expect(hash1).not.toBe(hash2);
      });
    });

    describe('scrubPII', () => {
      it('should scrub multiple email addresses', () => {
        const data = {
          emails: ['alice@example.com', 'bob@test.org'],
        };

        const scrubbed = scrubPII(data) as Record<string, unknown>;

        expect(JSON.stringify(scrubbed)).toContain('[REDACTED]');
        expect(JSON.stringify(scrubbed)).not.toContain('@');
      });

      it('should preserve non-PII data', () => {
        const data = {
          status: 'success',
          count: 42,
          message: 'Operation completed',
        };

        const scrubbed = scrubPII(data);

        expect(scrubbed).toEqual(data);
      });
    });

    describe('computeInputHash', () => {
      it('should be deterministic', () => {
        const recorder = new TranscriptRecorder();

        const partial1 = {
          meta: {
            transcriptId: 'id1',
            timestamp: '2024-01-01T00:00:00Z',
            agentVersion: '1.0.0',
            schemaVersion: '1.0' as const,
          },
          model: {
            modelId: 'claude-3-5-haiku-20241022',
            modelIdHash: sha256('claude-3-5-haiku-20241022'),
            temperature: 0.7,
            samplingParams: { temperature: 0.7 },
          },
          prompt: {
            promptHash: sha256('prompt'),
            systemPromptHash: sha256('system'),
          },
          tools: [
            {
              name: 'tool1',
              schemaHash: sha256('{}'),
            },
          ],
          context: {
            documentHashes: [sha256('doc1')],
            queryHash: sha256('query'),
            documentCount: 1,
          },
          toolCalls: [],
        };

        const hash1 = computeInputHash(partial1 as any);
        const hash2 = computeInputHash(partial1 as any);

        expect(hash1).toBe(hash2);
      });
    });
  });
});
