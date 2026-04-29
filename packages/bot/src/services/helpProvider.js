"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchFeatures = searchFeatures;
exports.formatHelpMessage = formatHelpMessage;
const FEATURES = [
    {
        name: "Trustlines",
        description: "Add or manage trustlines for Stellar assets. Required before you can hold non-native tokens.",
        command: "/trustline",
        keywords: ["trust", "asset", "add", "token", "issuer", "hold"],
    },
    {
        name: "Asset Swap",
        description: "Exchange one Stellar asset for another using the decentralized exchange (DEX).",
        command: "/swap",
        keywords: ["trade", "exchange", "swap", "convert", "buy", "sell"],
    },
    {
        name: "Balance",
        description: "Check your current Stellar wallet balance and holdings.",
        command: "/balance",
        keywords: ["money", "balance", "account", "funds", "wallet", "holdings"],
    },
    {
        name: "Account Sponsorship",
        description: "Request account sponsorship to cover minimum balance requirements for new accounts.",
        command: "/sponsor",
        keywords: ["free", "sponsor", "activate", "open", "account", "funding"],
    },
    {
        name: "Transaction Notifications",
        description: "Get real-time alerts for your Stellar transactions.",
        command: "/notify",
        keywords: ["alert", "notify", "status", "history", "activity"],
    },
    {
        name: "Network Status",
        description: "View the current health and performance of the Stellar network.",
        command: "/status",
        keywords: ["network", "health", "stellar", "horizon", "online", "lag"],
    },
    {
        name: "Asset Prices",
        description: "Get current market prices for XLM and other Stellar assets.",
        command: "/price",
        keywords: ["price", "market", "cost", "value", "rate", "quote"],
    },
];
function searchFeatures(query) {
    if (!query || query.trim() === "") {
        return FEATURES;
    }
    const normalizedQuery = query.toLowerCase().trim();
    // Score features based on matches in name, description, and keywords
    const scored = FEATURES.map((feature) => {
        let score = 0;
        if (feature.name.toLowerCase().includes(normalizedQuery))
            score += 10;
        if (feature.description.toLowerCase().includes(normalizedQuery))
            score += 5;
        feature.keywords.forEach((keyword) => {
            if (keyword.includes(normalizedQuery) ||
                normalizedQuery.includes(keyword)) {
                score += 3;
            }
        });
        return { feature, score };
    });
    // Filter features with any match and sort by score
    return scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((s) => s.feature);
}
function formatHelpMessage(features, isSearch = false, format = "html") {
    if (features.length === 0) {
        return "🔍 I couldn't find any features matching your search. Try using simpler keywords like 'swap', 'balance', or 'trustline'.";
    }
    const bold = (text) => format === "html" ? `<b>${text}</b>` : `**${text}**`;
    const italic = (text) => format === "html" ? `<i>${text}</i>` : `*${text}*`;
    let message = isSearch
        ? `🔍 ${bold("Search Results:")}\n\n`
        : `📖 ${bold("Available Commands:")}\n\n`;
    features.forEach((f) => {
        // Convert / command to ! for Discord if needed, but keeping it generic for now
        const displayCommand = format === "markdown" ? f.command.replace("/", "!") : f.command;
        message += `${bold(f.name)} (${displayCommand})\n`;
        message += `${f.description}\n\n`;
    });
    if (!isSearch) {
        message += italic(`Tip: You can search for specific features by typing ${format === "html" ? "/help &lt;query&gt;" : "!help <query>"}`);
    }
    return message;
}
