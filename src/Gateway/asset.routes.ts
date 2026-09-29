import { Router } from "express";
import { aiAssetRecognitionService } from "../services/aiAssetRecognition.service";
import { authenticate } from "../Auth/auth";
import { UnauthorizedError } from "../utils/error";

const router = Router();

/**
 * @swagger
 * /api/assets/recognize:
 *   post:
 *     summary: Recognize a Stellar asset from a description or name using AI
 *     tags: [Assets]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - query
 *             properties:
 *               userId:
 *                 type: string
 *                 description: ID of the user
 *               query:
 *                 type: string
 *                 description: Description or name of the asset
 *     responses:
 *       200:
 *         description: Asset recognized successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 asset:
 *                   type: object
 *                   properties:
 *                     assetCode:
 *                       type: string
 *                     issuer:
 *                       type: string
 *                     confidence:
 *                       type: number
 *                     description:
 *                       type: string
 *       401:
 *         description: Unauthorized
 */
router.post("/recognize", async (req, res, next) => {
  try {
    const { userId, query } = req.body;

    const user = await authenticate(userId);
    if (!user) throw new UnauthorizedError("invalid credentials");

    const recognizedAsset = await aiAssetRecognitionService.recognizeAsset(query, userId);

    if (recognizedAsset) {
      res.json({
        success: true,
        asset: recognizedAsset
      });
    } else {
      res.json({
        success: false,
        message: "Could not recognize asset"
      });
    }
  } catch (error) {
    next(error);
  }
});

export default router;
