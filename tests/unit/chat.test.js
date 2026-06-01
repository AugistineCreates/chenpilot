"use strict";
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.options = void 0;
exports.default = default_1;
const http_1 = __importDefault(require("k6/http"));
const k6_1 = require("k6");
/**
 * Requirement 76: Automated Load Testing
 * Analyzes /chat endpoint behavior under high concurrency.
 */
exports.options = {
  stages: [
    { duration: "1m", target: 20 }, // Ramp-up to 20 users
    { duration: "3m", target: 20 }, // Stay at 20 users
    { duration: "1m", target: 100 }, // Stress test spike
    { duration: "1m", target: 0 }, // Cool down
  ],
  thresholds: {
    // 95% of requests must be under 2s (Requirement: High Concurrency Analysis)
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.01"],
  },
};
const BASE_URL = __ENV.API_URL || "http://localhost:3000";
function default_1() {
  const url = `${BASE_URL}/chat`;
  const payload = JSON.stringify({
    message: "Simulated load test message for ChenPilot",
    network: "testnet",
  });
  const params = {
    headers: {
      "Content-Type": "application/json",
    },
  };
  const res = http_1.default.post(url, payload, params);
  // Requirement: Analyze behavior under high concurrency
  (0, k6_1.check)(res, {
    "status is 200": (r) => r.status === 200,
    "transaction-latency-acceptable": (r) => r.timings.duration < 2500,
  });
  (0, k6_1.sleep)(1);
}
