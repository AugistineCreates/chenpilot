/**
 * Command aliases mapping
 * Maps base commands to their supported shorter or localized versions
 */
export const COMMAND_ALIASES: Record<string, string[]> = {
  start: ['start', 's', 'inicio'],
  balance: ['balance', 'b', 'bal', 'saldo'],
  trustline: ['trustline', 't', 'tl', 'confianza'],
  sponsor: ['sponsor', 'sp', 'patrocinio'],
  swap: ['swap', 'sw', 'intercambio'],
  help: ['help', 'h', 'ayuda'],
};

/**
 * Gets all aliases for a base command including the base command itself
 */
export function getAliases(baseCommand: string): string[] {
  return COMMAND_ALIASES[baseCommand] || [baseCommand];
}

/**
 * Normalizes a command string by removing the prefix and resolving aliases
 */
export function normalizeCommand(commandText: string): string {
  if (!commandText) return '';
  
  // Remove prefix (/ for Telegram, ! for Discord) and convert to lowercase
  const cleanCommand = commandText.trim().toLowerCase().replace(/^[\/!]/, '').split(' ')[0];
  
  for (const [base, aliases] of Object.entries(COMMAND_ALIASES)) {
    if (base === cleanCommand || aliases.includes(cleanCommand)) {
      return base;
    }
  }
  
  return cleanCommand;
}
