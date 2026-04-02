/**
 * Smoke test — runs in paper mode, tests the filter pipeline with a known token.
 * Usage: node src/test.js
 */
process.env.PAPER_MODE = 'true';
process.env.RPC_URL = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';

import { filterToken } from './rugcheck.js';
import { analyzeHolders } from './holders.js';
import { logger } from './logger.js';

// BONK — a known safe token, should pass filters
const TEST_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const TEST_CREATOR = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';

async function runTest() {
  logger.info('Running filter pipeline test...\n');

  logger.info('Step 1: Analyzing holders...');
  const holderData = await analyzeHolders(TEST_MINT, TEST_CREATOR);
  logger.info({ holderData }, 'Holder analysis result');

  logger.info('\nStep 2: Running token filter...');
  const filterResult = await filterToken(TEST_MINT, holderData);
  logger.info({ filterResult }, 'Filter result');

  if (filterResult.score > 0) {
    logger.info('✅ Pipeline working correctly');
  } else {
    logger.warn('⚠️ RugCheck returned no score — check API connectivity');
  }

  logger.info('\nTest complete. The bot would ' + (filterResult.pass ? '✅ SNIPE' : '🚫 SKIP') + ' this token.');
}

runTest().catch(err => {
  logger.error({ err: err.message }, 'Test failed');
  process.exit(1);
});
