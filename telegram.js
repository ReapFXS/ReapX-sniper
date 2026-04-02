import TelegramBot from 'node-telegram-bot-api';
import { config } from './config.js';
import { logger } from './logger.js';

let bot = null;

if (config.telegramEnabled && config.telegramToken) {
  try {
    bot = new TelegramBot(config.telegramToken, { polling: false });
    logger.info('📱 Telegram alerts enabled');
  } catch (err) {
    logger.warn({ err: err.message }, 'Telegram init failed');
  }
}

/**
 * Send a Telegram message. Silently skips if Telegram is not configured.
 * Supports Markdown formatting.
 */
export async function notify(message) {
  if (!bot || !config.telegramChatId) return;

  try {
    await bot.sendMessage(config.telegramChatId, message, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'Telegram send failed');
  }
}

export default { notify };
