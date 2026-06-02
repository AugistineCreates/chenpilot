import { AppDataSource } from "../config/Datasource";
import { DeployedContract } from "./contractRegistry.entity";
import { Repository } from "typeorm";

/** Service handling contract compatibility registry */
export class ContractRegistryService {
  private repo: Repository<DeployedContract>;

  constructor() {
    this.repo = AppDataSource.getRepository(DeployedContract);
  }

  /** Register or update a contract version */
  async upsert(contract: Partial<DeployedContract>): Promise<DeployedContract> {
    const existing = await this.repo.findOne({
      where: { contractId: contract.contractId!, network: contract.network! },
    });
    if (existing) {
      await this.repo.update(existing.id, contract);
      return this.repo.findOneOrFail({ where: { id: existing.id } });
    }
    const newEntity = this.repo.create(contract as any);
    return this.repo.save(newEntity);
  }

  /** Retrieve compatibility metadata for a contract */
  async get(contractId: string, network: string) {
    return this.repo.findOne({ where: { contractId, network } });
  }

  /** List all deployed contracts */
  async list() {
    return this.repo.find();
  }
}
