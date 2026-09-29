/**
 * Link Command Handler
 * Handles bot identity linking commands for both Telegram and Discord
 */

import { CommandContext } from '../types';
import { accountLinkingService } from '../../services/accountLinkingService';

export async function handleLinkCommand(ctx: CommandContext): Promise<void> {
  const { platform, userId } = ctx;

  try {
    // Generate a link token for this user
    const linkToken = await accountLinkingService.generateLinkToken(
      userId,
      platform as 'telegram' | 'discord'
    );

    const message = `
🔗 Account Linking

To link your ${platform === 'telegram' ? 'Telegram' : 'Discord'} account to your Chen Pilot account:

1. Log in to your Chen Pilot dashboard
2. Navigate to Settings → Linked Accounts
3. Enter this link token: ${linkToken.token}

⏱️ This token expires in 15 minutes.

For security, never share your link token with others.
    `.trim();

    await ctx.reply(message);
  } catch (error) {
    await ctx.reply(
      '❌ Failed to generate link token. Please try again later.'
    );
  }
}

export async function handleUnlinkCommand(ctx: CommandContext): Promise<void> {
  const { platform, userId } = ctx;

  try {
    // Get the user's Chen Pilot account ID from the linked identity
    const userInfo = await accountLinkingService.getUserByBotIdentity(
      platform as 'telegram' | 'discord',
      userId
    );

    if (!userInfo || !userInfo.exists) {
      await ctx.reply(
        '❌ Your account is not linked to a Chen Pilot account.'
      );
      return;
    }

    // Unlink the identity
    const success = await accountLinkingService.unlinkIdentity(
      userInfo.userId,
      platform as 'telegram' | 'discord'
    );

    if (success) {
      await ctx.reply(
        '✅ Your account has been successfully unlinked from Chen Pilot.'
      );
    } else {
      await ctx.reply(
        '❌ Failed to unlink your account. Please try again later.'
      );
    }
  } catch (error) {
    await ctx.reply(
      '❌ Failed to unlink your account. Please try again later.'
    );
  }
}

export async function handleLinkedCommand(ctx: CommandContext): Promise<void> {
  const { platform, userId } = ctx;

  try {
    // Get the user's Chen Pilot account ID from the linked identity
    const userInfo = await accountLinkingService.getUserByBotIdentity(
      platform as 'telegram' | 'discord',
      userId
    );

    if (!userInfo || !userInfo.exists) {
      await ctx.reply(
        '❌ Your account is not linked to a Chen Pilot account.\n\nUse /link to connect your account.'
      );
      return;
    }

    // Get all linked identities for this user
    const identities = await accountLinkingService.getUserIdentities(userInfo.userId);

    let message = '🔗 Linked Accounts\n\n';

    if (identities.length === 0) {
      message += 'No linked accounts found.';
    } else {
      identities.forEach((identity) => {
        const platformName = identity.platform === 'telegram' ? 'Telegram' : 'Discord';
        const username = identity.platformUsername || identity.platformUserId;
        const linkedDate = new Date(identity.lastLinkedAt || identity.createdAt).toLocaleDateString();
        
        message += `• ${platformName}: @${username}\n`;
        message += `  Linked: ${linkedDate}\n`;
        message += `  Status: ${identity.isActive ? '✅ Active' : '❌ Inactive'}\n\n`;
      });
    }

    await ctx.reply(message);
  } catch (error) {
    await ctx.reply(
      '❌ Failed to retrieve linked accounts. Please try again later.'
    );
  }
}
