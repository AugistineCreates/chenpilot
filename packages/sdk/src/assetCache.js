"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.AssetCache = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class AssetCache {
    constructor(cacheDir = path.join(process.cwd(), ".asset-cache")) {
        this.cache = new Map();
        this.cacheFile = path.join(cacheDir, "assets.json");
        this.loadCache();
    }
    getKey(asset) {
        if (asset.isNative()) {
            return "XLM";
        }
        else {
            return `${asset.getCode()}:${asset.getIssuer()}`;
        }
    }
    loadCache() {
        try {
            if (fs.existsSync(this.cacheFile)) {
                const data = fs.readFileSync(this.cacheFile, "utf8");
                const cacheData = JSON.parse(data);
                for (const [key, info] of Object.entries(cacheData)) {
                    this.cache.set(key, info);
                }
            }
        }
        catch (error) {
            // Ignore errors, start with empty cache
        }
    }
    saveCache() {
        try {
            const cacheDir = path.dirname(this.cacheFile);
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }
            const cacheData = Object.fromEntries(this.cache);
            fs.writeFileSync(this.cacheFile, JSON.stringify(cacheData, null, 2));
        }
        catch (error) {
            // Ignore errors
        }
    }
    get(asset) {
        const key = this.getKey(asset);
        return this.cache.get(key);
    }
    set(asset, info) {
        const key = this.getKey(asset);
        this.cache.set(key, Object.assign(Object.assign({}, info), { lastUpdated: Date.now() }));
        this.saveCache();
    }
    fetchAndCache(asset, horizonUrl) {
        return __awaiter(this, void 0, void 0, function* () {
            const existing = this.get(asset);
            if (existing) {
                return existing;
            }
            // For now, just create basic info
            const info = {
                code: asset.isNative() ? "XLM" : asset.getCode(),
                issuer: asset.isNative() ? "" : asset.getIssuer(),
                lastUpdated: Date.now(),
            };
            this.set(asset, info);
            return info;
        });
    }
    clear() {
        this.cache.clear();
        this.saveCache();
    }
}
exports.AssetCache = AssetCache;
