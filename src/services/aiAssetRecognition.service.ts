import { agentLLM } from "../Agents/agent";
import logger from "../config/logger";
import { injectable } from "tsyringe";

export interface RecognizedAsset {
  assetCode: string;
  issuer?: string;
  confidence: number;
  description: string;
}

@injectable()
export class AIAssetRecognitionService {
  /**
   * Recognizes a Stellar asset from a natural language description or name.
   * @param input User's description or name of the asset
   * @param userId The ID of the user making the request
   * @returns RecognizedAsset object or null if not found
   */
  async recognizeAsset(input: string, userId: string): Promise<RecognizedAsset | null> {
    const prompt = `
      You are an expert in Stellar assets. Your task is to recognize the Stellar asset the user is referring to from their input.
      User input might be an asset code (like USDC), a name (like "the dollar stablecoin from Circle"), or a description.
      
      Return a JSON object with the following fields:
      - assetCode: The formal code of the asset (e.g., USDC, XLM, ARST).
      - issuer: The domain or G... address of the issuer if known (e.g., circle.com, stellar.org). For XLM, use 'native'.
      - confidence: A value between 0 and 1 indicating your confidence in this recognition.
      - description: A brief explanation of why you chose this asset.

      If you cannot recognize the asset with at least 0.5 confidence, return an empty object.

      Common assets to keep in mind:
      - XLM: Stellar Lumens (native)
      - USDC: USD Coin by circle.com
      - EURC: Euro Coin by circle.com
      - ARST: Argentine Peso by bitera.com
      - BRLC: Brazilian Real by bitera.com
      - AQUA: Aquarius
      - yUSDC: Yield-bearing USDC by ultrastellar.com
      - yXLM: Yield-bearing XLM by ultrastellar.com
    `;

    try {
      logger.info("Attempting AI asset recognition", { input, userId });
      const response = await agentLLM.callLLM(userId, prompt, input, true) as any;
      
      if (response && response.assetCode && response.confidence >= 0.5) {
        logger.info("Asset recognized successfully", { 
          input, 
          recognized: response.assetCode, 
          confidence: response.confidence 
        });
        return {
          assetCode: response.assetCode,
          issuer: response.issuer === 'native' ? undefined : response.issuer,
          confidence: response.confidence,
          description: response.description
        };
      }
      
      logger.warn("Asset recognition returned low confidence or no result", { input, response });
      return null;
    } catch (error) {
      logger.error("Asset recognition failed due to error", { 
        error: error instanceof Error ? error.message : String(error), 
        input 
      });
      return null;
    }
  }
}

export const aiAssetRecognitionService = new AIAssetRecognitionService();
