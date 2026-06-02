import { injectable } from "tsyringe";
import { Repository } from "typeorm";
import { User } from "./user.entity";
import AppDataSource from "../config/Datasource";
import { generateStellarKeypair } from "./stellar.service";
import { encrypt, decrypt } from "../utils/encryption";
import { ConflictError, BadError } from "../utils/error";

interface CreateUserPayload {
  name: string;
}

interface UserResponse {
  id: string;
  name: string;
  address: string;
  tokenType: string;
  createdAt: Date;
}

@injectable()
export default class UserService {
  private userRepository: Repository<User>;

  constructor() {
    this.userRepository = AppDataSource.getRepository(User);
  }

  async createUser(payload: CreateUserPayload): Promise<UserResponse> {
    const { name } = payload;

    // Validate name
    if (!name || name.length < 3 || name.length > 50) {
      throw new BadError("Name must be between 3 and 50 characters");
    }

    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      throw new BadError(
        "Name can only contain alphanumeric characters and underscores"
      );
    }

    // Check if username exists
    const existing = await this.userRepository.findOne({ where: { name } });
    if (existing) {
      throw new ConflictError("Username already exists");
    }

    // Generate Stellar keypair
    const { publicKey, secretKey } = generateStellarKeypair();

    // Encrypt private key
    const encryptedPrivateKey = encrypt(secretKey);

    // Create user
    const user = this.userRepository.create({
      name,
      address: publicKey,
      encryptedPrivateKey,
      tokenType: "XLM",
    });

    const savedUser = await this.userRepository.save(user);

    return {
      id: savedUser.id,
      name: savedUser.name,
      address: savedUser.address,
      tokenType: savedUser.tokenType,
      createdAt: savedUser.createdAt,
    };
  }

  async getUserById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async getUserByName(name: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { name } });
  }

  async getDecryptedPrivateKey(userId: string): Promise<string | null> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ["encryptedPrivateKey"],
    });

    if (!user || !user.encryptedPrivateKey) return null;
    return decrypt(user.encryptedPrivateKey);
  }
}
