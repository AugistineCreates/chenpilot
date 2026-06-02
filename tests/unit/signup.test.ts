import request from "supertest";
import app from "../../src/Gateway/api";
import AppDataSource from "../../src/config/Datasource";
import { User } from "../../src/Auth/user.entity";

describe("POST /signup", () => {
  beforeEach(async () => {
    const userRepository = AppDataSource.getRepository(User);
    await userRepository.clear();
  });

  it("should create a new user with valid name", async () => {
    const response = await request(app)
      .post("/signup")
      .send({ name: "testuser" })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe("User created successfully");
    expect(response.body.data).toHaveProperty("id");
    expect(response.body.data.name).toBe("testuser");
    expect(response.body.data.address).toMatch(/^G/);
    expect(response.body.data.tokenType).toBe("XLM");
    expect(response.body.data).toHaveProperty("createdAt");
    expect(response.body.data).not.toHaveProperty("encryptedPrivateKey");
  });

  it("should create a new user through /api/signup without sending raw pk", async () => {
    const response = await request(app)
      .post("/api/signup")
      .send({ name: "testuser_api" })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.userId).toBeDefined();

    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { name: "testuser_api" },
      select: ["encryptedPrivateKey"],
    });

    expect(user).not.toBeNull();
    expect(user?.address).toMatch(/^G/);
    expect(user?.encryptedPrivateKey).toBeDefined();
  });

  it("should return 400 when name is missing", async () => {
    const response = await request(app).post("/signup").send({}).expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("required");
  });

  it("should return 400 when name is too short", async () => {
    const response = await request(app)
      .post("/signup")
      .send({ name: "ab" })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("3");
  });

  it("should return 400 when name is too long", async () => {
    const longName = "a".repeat(51);
    const response = await request(app)
      .post("/signup")
      .send({ name: longName })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("50");
  });

  it("should return 400 when name contains invalid characters", async () => {
    const response = await request(app)
      .post("/signup")
      .send({ name: "test@user!" })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("alphanumeric");
  });

  it("should return 409 when username already exists", async () => {
    // Create first user
    await request(app)
      .post("/signup")
      .send({ name: "duplicateuser" })
      .expect(201);

    // Try to create duplicate
    const response = await request(app)
      .post("/signup")
      .send({ name: "duplicateuser" })
      .expect(409);

    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("already exists");
  });

  it("should store encrypted private key in database", async () => {
    await request(app)
      .post("/signup")
      .send({ name: "encryptiontest" })
      .expect(201);

    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { name: "encryptiontest" },
    });

    expect(user).not.toBeNull();
    expect(user!.encryptedPrivateKey).toBeDefined();
    expect(user!.encryptedPrivateKey).not.toMatch(/^S/);
    expect(user!.encryptedPrivateKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});
