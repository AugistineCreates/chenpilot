"use strict";
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
// chenpilot/tests/setup.ts
require("reflect-metadata");
const Datasource_1 = __importDefault(require("../src/config/Datasource"));
beforeAll(() =>
  __awaiter(void 0, void 0, void 0, function* () {
    try {
      if (!Datasource_1.default.isInitialized) {
        yield Datasource_1.default.initialize();
      }
    } catch (_a) {
      // Some tests don't require database connection (e.g., middleware unit tests)
      // Silently skip database initialization if it fails
      console.log(
        "Database initialization skipped (not required for this test)"
      );
    }
  })
);
afterAll(() =>
  __awaiter(void 0, void 0, void 0, function* () {
    try {
      if (Datasource_1.default.isInitialized) {
        yield Datasource_1.default.destroy();
      }
    } catch (_a) {
      // Silently skip database cleanup if it fails
    }
  })
);
