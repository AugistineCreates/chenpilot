import { Router, Request, Response } from "express";
import {
  contractMetadataRegistry,
  ContractEnvironment,
} from "./contractMetadataRegistry";

const router = Router();

router.get("/metadata", (req: Request, res: Response) => {
  const environment = req.query.environment as ContractEnvironment | undefined;
  const capability = req.query.capability as string | undefined;

  const contracts = capability
    ? contractMetadataRegistry.findByCapability(capability, environment)
    : contractMetadataRegistry.listContracts(environment);

  return res.status(200).json({
    success: true,
    data: {
      generatedAt: new Date().toISOString(),
      environment,
      contracts,
    },
  });
});

router.get("/metadata/:key", (req: Request, res: Response) => {
  const environment = req.query.environment as ContractEnvironment | undefined;
  const contract = contractMetadataRegistry.getContract(
    req.params.key,
    environment
  );

  if (!contract) {
    return res.status(404).json({
      success: false,
      message: "Contract metadata not found",
    });
  }

  return res.status(200).json({
    success: true,
    data: contract,
  });
});

export default router;
