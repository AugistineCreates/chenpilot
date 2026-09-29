import AppDataSource from "../config/Datasource";
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";
import logger from "../config/logger";

// ---------------------------------------------------------------------------
// Version Registry Entity
// ---------------------------------------------------------------------------

export enum ContractEnvironment {
  TESTNET = "testnet",
  MAINNET = "mainnet",
  FUTURENET = "futurenet",
}

export enum ContractStatus {
  DEPLOYED = "deployed",
  ACTIVE = "active",
  DEPRECATED = "deprecated",
  RETIRED = "retired",
}

export interface CompatibilityMatrix {
  minSupportedVersion: string;
  maxSupportedVersion: string;
  breakingChanges: string[];
  features: string[];
}

@Entity()
@Index(["contractName", "version"], { unique: true })
@Index(["environment", "status"])
export class ContractVersion {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 100 })
  contractName!: string;

  @Column({ type: "varchar", length: 50 })
  version!: string;

  @Column({ type: "varchar", length: 50 })
  environment!: ContractEnvironment;

  @Column({ type: "varchar", length: 50 })
  status!: ContractStatus;

  @Column({ type: "varchar", length: 255, nullable: true })
  address?: string;

  @Column({ type: "jsonb", nullable: true })
  compatibility?: CompatibilityMatrix;

  @Column({ type: "text", nullable: true })
  deploymentTxHash?: string;

  @Column({ type: "text", nullable: true })
  notes?: string;

  @CreateDateColumn()
  deployedAt!: Date;

  @Column({ type: "timestamp", nullable: true })
  deprecatedAt?: Date;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface RegisterContractVersionParams {
  contractName: string;
  version: string;
  environment: ContractEnvironment;
  address: string;
  status?: ContractStatus;
  compatibility?: CompatibilityMatrix;
  deploymentTxHash?: string;
  notes?: string;
}

export interface ContractVersionQuery {
  contractName?: string;
  environment?: ContractEnvironment;
  status?: ContractStatus;
  version?: string;
}

export class ContractVersionService {
  private repo = AppDataSource.getRepository(ContractVersion);

  async register(params: RegisterContractVersionParams): Promise<ContractVersion> {
    const record = this.repo.create({
      contractName: params.contractName,
      version: params.version,
      environment: params.environment,
      address: params.address,
      status: params.status ?? ContractStatus.ACTIVE,
      compatibility: params.compatibility,
      deploymentTxHash: params.deploymentTxHash,
      notes: params.notes,
    });

    const saved = await this.repo.save(record);
    logger.info("Contract version registered", {
      contractName: params.contractName,
      version: params.version,
      environment: params.environment,
      address: params.address,
    });

    return saved;
  }

  async query(params: ContractVersionQuery = {}): Promise<ContractVersion[]> {
    const qb = this.repo.createQueryBuilder("cv");

    if (params.contractName) {
      qb.andWhere("cv.contractName = :contractName", { contractName: params.contractName });
    }
    if (params.environment) {
      qb.andWhere("cv.environment = :environment", { environment: params.environment });
    }
    if (params.status) {
      qb.andWhere("cv.status = :status", { status: params.status });
    }
    if (params.version) {
      qb.andWhere("cv.version = :version", { version: params.version });
    }

    qb.orderBy("cv.deployedAt", "DESC");
    return qb.getMany();
  }

  async getActiveVersion(contractName: string, environment: ContractEnvironment): Promise<ContractVersion | null> {
    return this.repo.findOne({
      where: { contractName, environment, status: ContractStatus.ACTIVE },
      order: { deployedAt: "DESC" },
    });
  }

  async deprecate(contractName: string, version: string, environment: ContractEnvironment): Promise<void> {
    const record = await this.repo.findOne({
      where: { contractName, version, environment },
    });

    if (!record) {
      throw new Error("Contract version not found");
    }

    record.status = ContractStatus.DEPRECATED;
    record.deprecatedAt = new Date();
    await this.repo.save(record);

    logger.info("Contract version deprecated", { contractName, version, environment });
  }

  async isCompatible(contractName: string, environment: ContractEnvironment, requestedVersion: string): Promise<boolean> {
    const active = await this.getActiveVersion(contractName, environment);
    if (!active) return false;

    if (active.compatibility) {
      return (
        requestedVersion >= active.compatibility.minSupportedVersion &&
        requestedVersion <= active.compatibility.maxSupportedVersion
      );
    }

    return active.version === requestedVersion;
  }
}

export const contractVersionService = new ContractVersionService();