module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/.."],
  testMatch: ["**/__tests__/parallelScheduler.race.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  testTimeout: 30000,
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  globals: {
    "ts-jest": {
      isolatedModules: true,
      diagnostics: false,
    },
  },
  // Skip global setup that requires DB, Redis, and full env vars
  setupFilesAfterEnv: [],
};
