module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",

  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/__tests__/**",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  moduleFileExtensions: ["ts", "js", "json"],
  testTimeout: 10000,

  rootDir: "../../",
  roots: ["<rootDir>/packages/sdk/src"],
  testMatch: ["**/packages/sdk/src/__tests__/**/*.test.ts"],

  rootDir: __dirname,
  roots: ["<rootDir>/src"],
  testMatch: ["<rootDir>/src/__tests__/**/*.test.ts"],

  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/__tests__/**",
    "!src/types/**",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.json",
      },
    ],
  },
  testTimeout: 10000,
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};
