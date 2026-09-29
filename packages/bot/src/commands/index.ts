/**
 * Command framework public API + default registration.
 *
 * Import this module once (in index.ts) to register all shared handlers.
 * Adapter-specific commands (Discord /thread, Telegram /settings) are
 * registered separately inside each adapter.
 */

export { CommandRegistry, commandRegistry } from "./registry";
export type {
  CommandContext,
  CommandHandler,
  CommandReply,
  GuardResult,
  CommandMetrics,
  CommandRegistryOptions,
  Platform,
  SupportedCurrency,
} from "./types";
export { SUPPORTED_CURRENCIES } from "./types";
export { getUserCurrency, setUserCurrency } from "./handlers/currency";
export { getAlerts } from "./handlers/alert";

import { commandRegistry } from "./registry";
import { startHandler } from "./handlers/start";
import { pingHandler } from "./handlers/ping";
import { helpHandler } from "./handlers/help";
import { trustlineHandler } from "./handlers/trustline";
import { validateHandler } from "./handlers/validate";
import { sponsorHandler } from "./handlers/sponsor";
import { dashboardHandler } from "./handlers/dashboard";
import { multisigHandler } from "./handlers/multisig";
import { swapHandler } from "./handlers/swap";
import { currencyHandler } from "./handlers/currency";
import { portfolioHandler, reportHandler } from "./handlers/portfolio";
import { alertHandler, alertsHandler } from "./handlers/alert";
import { discoverHandler, advancedHandler } from "./handlers/discover";
import { feedbackHandler } from "./handlers/feedback";
import { linkHandler, unlinkHandler, linkedHandler } from "./handlers/linkHandler";

/**
 * Register all cross-platform command handlers into the shared registry.
 * Called once during bootstrap (index.ts).
 */
export function registerAllCommands(): void {
  commandRegistry.register(
    startHandler,
    pingHandler,
    helpHandler,
    trustlineHandler,
    validateHandler,
    sponsorHandler,
    dashboardHandler,
    multisigHandler,
    swapHandler,
    currencyHandler,
    portfolioHandler,
    reportHandler,  // alias: same logic as portfolio
    alertHandler,
    alertsHandler,
    discoverHandler,
    advancedHandler,
    feedbackHandler,
    linkHandler,
    unlinkHandler,
    linkedHandler,
  );
}
