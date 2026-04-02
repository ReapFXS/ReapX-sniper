import 'dotenv/config';

function required(key) {
  const val = process.env[key];
  if (!val || val === `your_${key.toLowerCase()}_here`) {
    throw new Error(`Missing required env var: ${key}. Check your .env file.`);
  }
  return val;
}

function optional(key, fallback) {
  return process.env[key] ?? fallback;
}

const isPaper = process.argv.includes('--paper') || process.env.PAPER_MODE === 'true';

export const config = {
  // Mode
  paperMode: isPaper,

  // Wallet & RPC
  privateKey: isPaper ? null : required('PRIVATE_KEY'),
  rpcUrl: optional('RPC_URL', 'https://api.mainnet-beta.solana.com'),
  jitoUrl: optional('JITO_URL', 'https://mainnet.block-engine.jito.wtf'),

  // Trading
  buyAmountSol: parseFloat(optional('BUY_AMOUNT_SOL', '0.1')),
  slippageBps: parseInt(optional('SLIPPAGE_BPS', '500')),
  jitoTipSol: parseFloat(optional('JITO_TIP_SOL', '0.005')),
  maxBuyTax: parseFloat(optional('MAX_BUY_TAX', '10')),
  maxConcurrentSnipes: parseInt(optional('MAX_CONCURRENT_SNIPES', '1')),

  // Filters
  minRugcheckScore: parseInt(optional('MIN_RUGCHECK_SCORE', '80')),
  maxTop10HolderPct: parseFloat(optional('MAX_TOP10_HOLDER_PCT', '40')),
  maxDevHolderPct: parseFloat(optional('MAX_DEV_HOLDER_PCT', '10')),
  minLiquidityUsd: parseFloat(optional('MIN_LIQUIDITY_USD', '5000')),
  skipBundled: optional('SKIP_BUNDLED', 'true') === 'true',

  // Exit
  takeProfitMultipliers: optional('TAKE_PROFIT_MULTIPLIERS', '2,3,5')
    .split(',').map(Number),
  takeProfitPercents: optional('TAKE_PROFIT_PERCENTS', '30,30,20')
    .split(',').map(Number),
  stopLossPct: parseFloat(optional('STOP_LOSS_PCT', '40')),

  // Telegram
  telegramEnabled: optional('TELEGRAM_ENABLED', 'false') === 'true',
  telegramToken: optional('TELEGRAM_BOT_TOKEN', ''),
  telegramChatId: optional('TELEGRAM_CHAT_ID', ''),
};

// Validate exit ladder
if (config.takeProfitMultipliers.length !== config.takeProfitPercents.length) {
  throw new Error('TAKE_PROFIT_MULTIPLIERS and TAKE_PROFIT_PERCENTS must have the same number of values');
}

export default config;
