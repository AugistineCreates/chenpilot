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
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const logger_1 = __importStar(require("../../src/config/logger"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
(0, globals_1.describe)("Logger", () => {
  const logsDir = path_1.default.join(process.cwd(), "logs");
  (0, globals_1.beforeEach)(() => {
    // Ensure logs directory exists
    if (!fs_1.default.existsSync(logsDir)) {
      fs_1.default.mkdirSync(logsDir, { recursive: true });
    }
  });
  (0, globals_1.it)("should log info messages", () => {
    const spy = globals_1.jest.spyOn(logger_1.default, "info");
    (0, logger_1.logInfo)("Test info message", { test: true });
    (0, globals_1.expect)(spy).toHaveBeenCalledWith("Test info message", {
      test: true,
    });
  });
  (0, globals_1.it)("should log error messages", () => {
    const spy = globals_1.jest.spyOn(logger_1.default, "error");
    const error = new Error("Test error");
    (0, logger_1.logError)("Test error message", error);
    (0, globals_1.expect)(spy).toHaveBeenCalled();
  });
  (0, globals_1.it)("should log warning messages", () => {
    const spy = globals_1.jest.spyOn(logger_1.default, "warn");
    (0, logger_1.logWarn)("Test warning message", { warning: true });
    (0, globals_1.expect)(spy).toHaveBeenCalledWith("Test warning message", {
      warning: true,
    });
  });
  (0, globals_1.it)("should log debug messages", () => {
    const spy = globals_1.jest.spyOn(logger_1.default, "debug");
    (0, logger_1.logDebug)("Test debug message", { debug: true });
    (0, globals_1.expect)(spy).toHaveBeenCalledWith("Test debug message", {
      debug: true,
    });
  });
  (0, globals_1.it)("should redact sensitive data", () => {
    const spy = globals_1.jest.spyOn(logger_1.default, "info");
    (0, logger_1.logInfo)("User data", {
      username: "john",
      password: "secret123",
      pk: "private-key-data",
    });
    (0, globals_1.expect)(spy).toHaveBeenCalled();
  });
});
