import { injectable } from "tsyringe";
import { Repository } from "typeorm";
import { User } from "./user.entity";
import AppDataSource from "../config/Datasource";
import { generateStellarKeypair } from "./stellar.service";
import { encrypt, decrypt } from "../utils/encryption";
import { SecretBuffer } from "../utils/secretBuffer";
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

  /**
   * Returns the decrypted private key wrapped in a SecretBuffer.
   * Callers MUST call `destroy()` on the returned buffer when done.
   *
   * @deprecated Prefer `withDecryptedPrivateKey()` for safe lifecycle management.
   */
  async getDecryptedPrivateKey(userId: string): Promise<SecretBuffer | null> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ["encryptedPrivateKey"],
    });

    if (!user || !user.encryptedPrivateKey) return null;
    const plaintext = decrypt(user.encryptedPrivateKey);
    return SecretBuffer.fromString(plaintext, `user-key:${userId}`);
  }

  /**
   * Safely consume the decrypted private key with automatic zeroization.
   *
   * @example
   * ```ts
   * const txHash = await user.withDecryptedPrivateKey(userId, async (secret) => {
   *   return secret.consumeString(async (plainKey) => {
   *     const kp = Keypair.fromSecret(plainKey);
   *     // …sign transaction…
   *   });
   * });
   * ```
   */
  async withDecryptedPrivateKey<T>(
    userId: string,
    fn: (secret: SecretBuffer) => Promise<T> | T,
  ): Promise<T | null> {
    const secret = await this.getDecryptedPrivateKey(userId);
    if (!secret) return null;
    try {
      return await fn(secret);
    } finally {
      secret.destroy();
    }
  }
}
