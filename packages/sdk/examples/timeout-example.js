"use strict";
/**
 * Example: Using request timeouts with the SDK
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const src_1 = require("../src");
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        // Example 1: HorizonClient with global timeout
        const client = new src_1.HorizonClient({
            baseUrl: "https://horizon-testnet.stellar.org",
            timeout: 5000, // 5 second timeout for all requests
        });
        try {
            const offers = yield client.getAccountOffers("GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
            console.log(`Found ${offers.records.length} offers`);
        }
        catch (error) {
            console.error("Request timed out or failed:", error);
        }
        // Example 2: Network status check with timeout
        try {
            const health = yield (0, src_1.checkNetworkHealth)({
                network: "testnet",
                timeout: 3000, // 3 second timeout
            });
            console.log("Network healthy:", health.isHealthy);
            console.log("Response time:", health.responseTimeMs, "ms");
        }
        catch (error) {
            console.error("Health check timed out:", error);
        }
        // Example 3: Full network status with timeout
        try {
            const status = yield (0, src_1.getNetworkStatus)({
                network: "mainnet",
                timeout: 10000, // 10 second timeout
            });
            console.log("Protocol version:", status.protocol.version);
            console.log("Latest ledger:", status.health.latestLedger);
        }
        catch (error) {
            console.error("Status check timed out:", error);
        }
    });
}
main();
