"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const memory_1 = require("../../src/Agents/memory/memory");
const seedAgentMemory_1 = require("../../src/scripts/seedAgentMemory");
(0, globals_1.describe)("Agent Memory Seeding", () => {
  (0, globals_1.beforeEach)(() => {
    // Clear memory before each test
    memory_1.memoryStore.clearAll();
  });
  (0, globals_1.afterEach)(() => {
    // Clean up after each test
    memory_1.memoryStore.clearAll();
  });
  (0, globals_1.describe)("seedMemoryData", () => {
    (0, globals_1.it)("should seed memory with default data", () => {
      (0, seedAgentMemory_1.seedMemoryData)();
      const agentIds = (0, seedAgentMemory_1.getSeededAgentIds)();
      const user1Memory = memory_1.memoryStore.get(agentIds.user1);
      const user2Memory = memory_1.memoryStore.get(agentIds.user2);
      (0, globals_1.expect)(user1Memory.length).toBeGreaterThan(0);
      (0, globals_1.expect)(user2Memory.length).toBeGreaterThan(0);
    });
    (0, globals_1.it)(
      "should clear existing data when clearExisting is true",
      () => {
        // Add some initial data
        memory_1.memoryStore.add("test-agent", "Initial entry");
        // Seed with clearExisting=true (default)
        (0, seedAgentMemory_1.seedMemoryData)(true);
        // Initial data should be cleared
        const testMemory = memory_1.memoryStore.get("test-agent");
        (0, globals_1.expect)(testMemory.length).toBe(0);
      }
    );
    (0, globals_1.it)(
      "should preserve existing data when clearExisting is false",
      () => {
        // Add some initial data
        memory_1.memoryStore.add("test-agent", "Initial entry");
        // Seed with clearExisting=false
        (0, seedAgentMemory_1.seedMemoryData)(false);
        // Initial data should still exist
        const testMemory = memory_1.memoryStore.get("test-agent");
        (0, globals_1.expect)(testMemory.length).toBeGreaterThan(0);
        (0, globals_1.expect)(testMemory[0]).toBe("Initial entry");
      }
    );
    (0, globals_1.it)(
      "should seed performance agent with 100 entries (limited to 10 by max context)",
      () => {
        (0, seedAgentMemory_1.seedMemoryData)();
        const agentIds = (0, seedAgentMemory_1.getSeededAgentIds)();
        const perfMemory = memory_1.memoryStore.get(agentIds.performanceAgent);
        // Memory store has a max context of 10, so only last 10 are kept
        (0, globals_1.expect)(perfMemory.length).toBe(10);
      }
    );
  });
  (0, globals_1.describe)("seedAgentMemory", () => {
    (0, globals_1.it)("should seed specific agent with custom entries", () => {
      const customEntries = [
        "User: Custom question 1",
        "Agent: Custom answer 1",
        "User: Custom question 2",
        "Agent: Custom answer 2",
      ];
      (0, seedAgentMemory_1.seedAgentMemory)("custom-agent", customEntries);
      const memory = memory_1.memoryStore.get("custom-agent");
      (0, globals_1.expect)(memory.length).toBe(4);
      (0, globals_1.expect)(memory[0]).toBe("User: Custom question 1");
    });
    (0, globals_1.it)(
      "should clear existing agent data when clearExisting is true",
      () => {
        // Add initial data
        memory_1.memoryStore.add("custom-agent", "Old entry");
        // Seed with clearExisting=true
        (0, seedAgentMemory_1.seedAgentMemory)(
          "custom-agent",
          ["New entry"],
          true
        );
        const memory = memory_1.memoryStore.get("custom-agent");
        (0, globals_1.expect)(memory.length).toBe(1);
        (0, globals_1.expect)(memory[0]).toBe("New entry");
      }
    );
    (0, globals_1.it)(
      "should append to existing data when clearExisting is false",
      () => {
        // Add initial data
        memory_1.memoryStore.add("custom-agent", "Old entry");
        // Seed with clearExisting=false
        (0, seedAgentMemory_1.seedAgentMemory)(
          "custom-agent",
          ["New entry"],
          false
        );
        const memory = memory_1.memoryStore.get("custom-agent");
        (0, globals_1.expect)(memory.length).toBe(2);
        (0, globals_1.expect)(memory[0]).toBe("Old entry");
        (0, globals_1.expect)(memory[1]).toBe("New entry");
      }
    );
  });
  (0, globals_1.describe)("getSeededAgentIds", () => {
    (0, globals_1.it)("should return all seeded agent IDs", () => {
      const agentIds = (0, seedAgentMemory_1.getSeededAgentIds)();
      (0, globals_1.expect)(agentIds).toHaveProperty("user1");
      (0, globals_1.expect)(agentIds).toHaveProperty("user2");
      (0, globals_1.expect)(agentIds).toHaveProperty("user3");
      (0, globals_1.expect)(agentIds).toHaveProperty("testAgent");
      (0, globals_1.expect)(agentIds).toHaveProperty("performanceAgent");
    });
  });
  (0, globals_1.describe)("getConversationTemplates", () => {
    (0, globals_1.it)("should return all conversation templates", () => {
      const templates = (0, seedAgentMemory_1.getConversationTemplates)();
      (0, globals_1.expect)(templates).toHaveProperty("stellar");
      (0, globals_1.expect)(templates).toHaveProperty("defi");
      (0, globals_1.expect)(templates).toHaveProperty("general");
      (0, globals_1.expect)(templates).toHaveProperty("trading");
      (0, globals_1.expect)(templates).toHaveProperty("staking");
    });
    (0, globals_1.it)("should have valid conversation entries", () => {
      const templates = (0, seedAgentMemory_1.getConversationTemplates)();
      (0, globals_1.expect)(Array.isArray(templates.stellar)).toBe(true);
      (0, globals_1.expect)(templates.stellar.length).toBeGreaterThan(0);
      (0, globals_1.expect)(typeof templates.stellar[0]).toBe("string");
    });
  });
  (0, globals_1.describe)("verifySeededData", () => {
    (0, globals_1.it)("should return true when data is properly seeded", () => {
      (0, seedAgentMemory_1.seedMemoryData)();
      const isValid = (0, seedAgentMemory_1.verifySeededData)();
      (0, globals_1.expect)(isValid).toBe(true);
    });
    (0, globals_1.it)("should return false when data is not seeded", () => {
      // Don't seed any data
      const isValid = (0, seedAgentMemory_1.verifySeededData)();
      (0, globals_1.expect)(isValid).toBe(false);
    });
  });
  (0, globals_1.describe)("Memory Retrieval Logic", () => {
    (0, globals_1.beforeEach)(() => {
      (0, seedAgentMemory_1.seedMemoryData)();
    });
    (0, globals_1.it)(
      "should retrieve Stellar-focused conversations for user1",
      () => {
        const agentIds = (0, seedAgentMemory_1.getSeededAgentIds)();
        const memory = memory_1.memoryStore.get(agentIds.user1);
        const stellarEntries = memory.filter((entry) =>
          entry.toLowerCase().includes("stellar")
        );
        (0, globals_1.expect)(stellarEntries.length).toBeGreaterThan(0);
      }
    );
    (0, globals_1.it)(
      "should retrieve DeFi-focused conversations for user2",
      () => {
        const agentIds = (0, seedAgentMemory_1.getSeededAgentIds)();
        const memory = memory_1.memoryStore.get(agentIds.user2);
        const defiEntries = memory.filter(
          (entry) =>
            entry.toLowerCase().includes("apy") ||
            entry.toLowerCase().includes("swap") ||
            entry.toLowerCase().includes("liquidity")
        );
        (0, globals_1.expect)(defiEntries.length).toBeGreaterThan(0);
      }
    );
    (0, globals_1.it)(
      "should handle empty memory for non-existent agent",
      () => {
        const memory = memory_1.memoryStore.get("non-existent-agent");
        (0, globals_1.expect)(memory).toEqual([]);
      }
    );
    (0, globals_1.it)("should respect max context limit", () => {
      const agentId = "limit-test-agent";
      // Add more entries than the default limit (10)
      for (let i = 0; i < 15; i++) {
        memory_1.memoryStore.add(agentId, `Entry ${i}`);
      }
      const memory = memory_1.memoryStore.get(agentId);
      // Should only keep the last 10 entries
      (0, globals_1.expect)(memory.length).toBe(10);
      (0, globals_1.expect)(memory[0]).toBe("Entry 5");
      (0, globals_1.expect)(memory[9]).toBe("Entry 14");
    });
    (0, globals_1.it)(
      "should retrieve conversation context for multi-turn interactions",
      () => {
        const agentIds = (0, seedAgentMemory_1.getSeededAgentIds)();
        const memory = memory_1.memoryStore.get(agentIds.user1);
        // Check for user-agent conversation pairs
        const userEntries = memory.filter((entry) => entry.startsWith("User:"));
        const agentEntries = memory.filter((entry) =>
          entry.startsWith("Agent:")
        );
        (0, globals_1.expect)(userEntries.length).toBeGreaterThan(0);
        (0, globals_1.expect)(agentEntries.length).toBeGreaterThan(0);
      }
    );
  });
  (0, globals_1.describe)("Performance Testing with Seeded Data", () => {
    (0, globals_1.it)("should handle large dataset efficiently", () => {
      (0, seedAgentMemory_1.seedMemoryData)();
      const agentIds = (0, seedAgentMemory_1.getSeededAgentIds)();
      const startTime = Date.now();
      // Retrieve memory 100 times
      for (let i = 0; i < 100; i++) {
        memory_1.memoryStore.get(agentIds.performanceAgent);
      }
      const endTime = Date.now();
      const duration = endTime - startTime;
      // Should complete in reasonable time (< 100ms)
      (0, globals_1.expect)(duration).toBeLessThan(100);
    });
    (0, globals_1.it)("should handle concurrent memory operations", () => {
      const agentId = "concurrent-test-agent";
      const operations = [];
      // Perform concurrent add operations
      for (let i = 0; i < 50; i++) {
        operations.push(
          Promise.resolve(
            memory_1.memoryStore.add(agentId, `Concurrent entry ${i}`)
          )
        );
      }
      return Promise.all(operations).then(() => {
        const memory = memory_1.memoryStore.get(agentId);
        // Should only keep last 10 due to max context limit
        (0, globals_1.expect)(memory.length).toBe(10);
      });
    });
  });
});
