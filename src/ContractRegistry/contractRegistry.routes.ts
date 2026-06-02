import { Router, Request, Response } from 'express';
import { ContractRegistryService } from '../ContractRegistry/contractRegistry.service';

const router = Router();
const service = new ContractRegistryService();

// List all deployed contracts
router.get('/', async (req: Request, res: Response) => {
  try {
    const contracts = await service.list();
    res.json(contracts);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get specific contract metadata
router.get('/:contractId', async (req: Request, res: Response) => {
  const { contractId } = req.params;
  const { network } = req.query as { network?: string };
  if (!network) {
    return res.status(400).json({ error: 'Missing network query parameter' });
  }
  try {
    const contract = await service.get(contractId, network);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    res.json(contract);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Upsert contract version (create or update)
router.post('/', async (req: Request, res: Response) => {
  try {
    const result = await service.upsert(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
