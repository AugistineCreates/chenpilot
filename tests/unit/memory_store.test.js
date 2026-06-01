"use strict";
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
      }
    : function (o, v) {
        o["default"] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o)
            if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== "default") __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
Object.defineProperty(exports, "__esModule", { value: true });
const memory_1 = require("../../src/Agents/memory/memory");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
describe("MemoryStore", () => {
  let storageDirectory;
  let storageFilePath;
  beforeEach(() => {
    storageDirectory = path.resolve(
      process.cwd(),
      "tmp",
      `memory-store-tests-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    );
    storageFilePath = path.join(storageDirectory, "agent-memory.json");
  });
  afterEach(() => {
    if (fs.existsSync(storageDirectory)) {
      fs.rmSync(storageDirectory, { recursive: true, force: true });
    }
  });
  it("persists memory entries and reloads them", () => {
    const store = new memory_1.MemoryStore(10, storageFilePath);
    store.add("user-1", "User: hello");
    store.add("user-1", "LLM: hi there");
    const reloadedStore = new memory_1.MemoryStore(10, storageFilePath);
    expect(reloadedStore.get("user-1")).toEqual([
      "User: hello",
      "LLM: hi there",
    ]);
  });
  it("enforces max context per agent across reloads", () => {
    const store = new memory_1.MemoryStore(2, storageFilePath);
    store.add("user-1", "entry-1");
    store.add("user-1", "entry-2");
    store.add("user-1", "entry-3");
    expect(store.get("user-1")).toEqual(["entry-2", "entry-3"]);
    const reloadedStore = new memory_1.MemoryStore(2, storageFilePath);
    expect(reloadedStore.get("user-1")).toEqual(["entry-2", "entry-3"]);
  });
  it("persists clear and clearAll operations", () => {
    const store = new memory_1.MemoryStore(10, storageFilePath);
    store.add("user-1", "entry-1");
    store.add("user-2", "entry-2");
    store.clear("user-1");
    let reloadedStore = new memory_1.MemoryStore(10, storageFilePath);
    expect(reloadedStore.get("user-1")).toEqual([]);
    expect(reloadedStore.get("user-2")).toEqual(["entry-2"]);
    reloadedStore.clearAll();
    reloadedStore = new memory_1.MemoryStore(10, storageFilePath);
    expect(reloadedStore.get("user-1")).toEqual([]);
    expect(reloadedStore.get("user-2")).toEqual([]);
  });
});
