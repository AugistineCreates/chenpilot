import logger from "../config/logger";
import { createBudget, budgetedFetch, BudgetExhaustedError } from "../utils/budget";

const TRANSCRIPTION_BUDGET = createBudget({
  deadlineMs: 30000,
  attempts: 2,
  bytes: 25 * 1024 * 1024,
  downstreamCalls: 5,
  path: "voiceTranscription.openai",
});

export interface TranscriptionResult {
  success: boolean;
  text?: string;
  error?: string;
  duration?: number;
}

/**
 * Service for transcribing voice messages using OpenAI Whisper API
 */
export class VoiceTranscriptionService {
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || "";
    this.apiUrl = process.env.OPENAI_API_URL || "https://api.openai.com/v1/audio/transcriptions";
  }

  /**
   * Transcribe an audio file buffer using OpenAI Whisper
   */
  async transcribeAudio(
    audioBuffer: Buffer,
    mimeType: string = "audio/ogg"
  ): Promise<TranscriptionResult> {
    if (!this.apiKey) {
      logger.error("OpenAI API key not configured for voice transcription");
      return {
        success: false,
        error: "OpenAI API key not configured",
      };
    }

    try {
      // Create multipart form data using Blob
      const form = new FormData();
      const blob = new Blob([audioBuffer], { type: mimeType });
      form.append("file", blob, "voice.ogg");
      form.append("model", "whisper-1");
      form.append("language", "en"); // Default to English, can be made configurable

      const response = await budgetedFetch(TRANSCRIPTION_BUDGET, this.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: form,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("OpenAI transcription API error", {
          status: response.status,
          error: errorText,
        });
        return {
          success: false,
          error: `Transcription API error: ${response.status}`,
        };
      }

      const data = await response.json();
      
      logger.info("Voice transcription successful", {
        textLength: data.text?.length,
      });

      return {
        success: true,
        text: data.text,
      };
    } catch (error) {
      if (error instanceof BudgetExhaustedError) {
        logger.error("Transcription budget exhausted", {
          resource: error.resource,
          error: error.message,
        });
        return {
          success: false,
          error: `Transcription budget exhausted: ${error.resource}`,
        };
      }
      logger.error("Error transcribing audio", { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown transcription error",
      };
    }
  }

  /**
   * Check if the transcription service is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }
}

export const voiceTranscriptionService = new VoiceTranscriptionService();
