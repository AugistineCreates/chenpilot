/**
 * Link Command Handlers
 * Command handlers for bot identity linking
 */

import { CommandHandler, CommandContext, CommandReply } from '../types';
import { handleLinkCommand, handleUnlinkCommand, handleLinkedCommand } from './link';

export const linkHandler: CommandHandler = {
  name: 'link',
  description: 'Link your bot account to your Chen Pilot account',
  platforms: ['telegram', 'discord'],
  
  async execute(ctx: CommandContext): Promise<CommandReply> {
    await handleLinkCommand(ctx);
    return { text: '' };
  },
};

export const unlinkHandler: CommandHandler = {
  name: 'unlink',
  description: 'Unlink your bot account from Chen Pilot',
  platforms: ['telegram', 'discord'],
  
  async execute(ctx: CommandContext): Promise<CommandReply> {
    await handleUnlinkCommand(ctx);
    return { text: '' };
  },
};

export const linkedHandler: CommandHandler = {
  name: 'linked',
  description: 'Show your linked Chen Pilot accounts',
  platforms: ['telegram', 'discord'],
  
  async execute(ctx: CommandContext): Promise<CommandReply> {
    await handleLinkedCommand(ctx);
    return { text: '' };
  },
};
