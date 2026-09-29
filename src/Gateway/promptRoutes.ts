import { Router } from "express";
import { promptVersionManager } from "../Agents/registry/PromptVersionManager";
import { promptVersionService } from "../Agents/registry/PromptVersionService";
import {
  PromptChangeControlError,
  changeControlHttpStatus,
} from "../Agents/registry/PromptChangeControl";

const router = Router();

router.post("/versions", async (req, res) => {
  const { name, type, content, version, weight, revision } = req.body;
  try {
    const prompt = await promptVersionManager.createVersion(
      name,
      type,
      content,
      version,
      weight,
      revision
    );
    res.json(prompt);
  } catch (error) {
    if (error instanceof PromptChangeControlError) {
      return res.status(changeControlHttpStatus(error)).json({
        success: false,
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }
    throw error;
  }
});

router.patch("/versions/:id/activate", async (req, res) => {
  await promptVersionManager.activateVersion(req.params.id, req.body.revision);
  res.json({ success: true });
});

router.patch("/versions/:id/deactivate", async (req, res) => {
  await promptVersionManager.deactivateVersion(req.params.id, req.body.revision);
  res.json({ success: true });
});

router.patch("/versions/:id/weight", async (req, res) => {
  await promptVersionManager.updateWeight(
    req.params.id,
    req.body.weight,
    req.body.revision
  );
  res.json({ success: true });
});

router.get("/versions", async (req, res) => {
  const type = req.query.type as string | undefined;
  const versions = await promptVersionManager.listVersions(type);
  res.json(versions);
});

router.get("/versions/:id/metrics", async (req, res) => {
  const metrics = await promptVersionService.getMetrics(req.params.id);
  res.json(metrics);
});

router.get("/compare/:id1/:id2", async (req, res) => {
  const comparison = await promptVersionManager.compareVersions(
    req.params.id1,
    req.params.id2
  );
  res.json(comparison);
});

export default router;
