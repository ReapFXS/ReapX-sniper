import { config } from './config.js';
import { logger } from './logger.js';
import { PumpFunListener } from './pumpfun.js';
import { filterToken } from './rugcheck.js';
import { analyzeHolders } from './holders.js';
import { buy, getWallet } from './trader.js';
import { openPosition, checkPositions, getOpenPositions, hasPosition } from './position.js';
import { notify } from './telegram.js';

// ── Banner ────────────────────────────────────────────────────────
function printBanner() {
  console.log('\n');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║      Solana Sniper Bot v2.0              ║');
  console.log('  ║      pump.fun · Jito · Jupiter           ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log(`  Mode:      ${config.paperMode ? '📝 PAPER (no real trades)' : '🔴 LIVE'}`);
  console.log(`  Buy size:  ${config.buyAmountSol} SOL`);
  console.log(`  Jito tip:  ${config.jitoTipSol} SOL`);
  console.log(`  Stop loss: -${config.stopLossPct}%`);
  console.log(`  TP levels: ${config.takeProfitMultipliers.map((m, i) => `${m}x→sell ${config.takeProfitPercents[i]}%`).join(', ')}`);
  console.log(`  Filters:   RugCheck ≥${config.minRugcheckScore} | Dev ≤${config.maxDevHolderPct}% | Top10 ≤${config.maxTop10HolderPct}%`);
  console.log(`  Telegram:  ${config.telegramEnabled ? '✅ Enabled' : '❌ Disabled'}`);
  console.log('\n');
}

// Track tokens currently being processed to avoid double-sniping
const processing = new Set();
let totalSnipes = 0;
let totalFiltered = 0;

/**
 * Core handler — called for every new pump.fun token launch.
 */
async function handleNewToken({ mint, creator, name, symbol, signature, timestamp }) {
  if (processing.has(mint)) return;
  if (hasPosition(mint)) return;
  if (getOpenPositions().length >= config.maxConcurrentSnipes) {
    logger.debug({ mint }, 'Max concurrent snipes reached, skipping');
    return;
  }

  processing.add(mint);

  const age = ((Date.now() - timestamp) / 1000).toFixed(1);
  logger.info({ mint: mint.slice(0, 8) + '...', name, symbol, age: `${age}s` }, '🆕 New token detected');

  try {
    // ── Step 1: Holder analysis (bundle detection, concentration) ──
    const holderData = await analyzeHolders(mint, creator);

    if (holderData.bundleDetected && config.skipBundled) {
      logger.warn({ mint: mint.slice(0, 8) }, '🚫 Bundle detected — skipped');
      totalFiltered++;
      processing.delete(mint);
      return;
    }

    // ── Step 2: RugCheck + filter logic ────────────────────────────
    const filterResult = await filterToken(mint, holderData);

    if (!filterResult.pass) {
      logger.warn({ mint: mint.slice(0, 8), reason: filterResult.reason }, '🚫 Filter rejected');
      totalFiltered++;
      processing.delete(mint);
      return;
    }

    logger.info(
      {
        mint: mint.slice(0, 8),
        score: filterResult.score,
        topHoldersPct: holderData.topHoldersPct?.toFixed(1),
        devPct: holderData.devHolderPct?.toFixed(1),
      },
      '✅ Token passed filters — sniping'
    );

    // ── Step 3: Notify ─────────────────────────────────────────────
    await notify(
      `🎯 *Sniping* \`${symbol}\` (${name})\n` +
      `Mint: \`${mint}\`\n` +
      `Score: ${filterResult.score} | Dev: ${holderData.devHolderPct?.toFixed(1)}% | Top10: ${holderData.topHoldersPct?.toFixed(1)}%\n` +
      `Bundle: ${holderData.bundleDetected ? '⚠️ YES' : '✅ No'}`
    );

    // ── Step 4: Buy ────────────────────────────────────────────────
    const buyResult = await buy(mint);

    if (!buyResult.success) {
      logger.error({ mint: mint.slice(0, 8), err: buyResult.error }, '❌ Buy failed');
      await notify(`❌ Buy failed: \`${mint.slice(0, 8)}...\`\nReason: ${buyResult.error}`);
      processing.delete(mint);
      return;
    }

    totalSnipes++;
    openPosition(mint, buyResult);

    await notify(
      `✅ *Bought* \`${symbol}\`\n` +
      `Amount: ${config.buyAmountSol} SOL\n` +
      `Sig: \`${buyResult.signature.slice(0, 16)}...\`\n` +
      `TP: ${config.takeProfitMultipliers.join('x / ')}x | SL: -${config.stopLossPct}%`
    );

  } catch (err) {
    logger.error({ err: err.message, mint }, 'Unexpected error in handleNewToken');
  } finally {
    processing.delete(mint);
  }
}

/**
 * Handle migration events (bonding curve → Raydium).
 * These are often the best entry point — token has proven demand.
 */
async function handleMigration({ mint, raydiumPool, signature }) {
  if (hasPosition(mint)) return;
  if (getOpenPositions().length >= config.maxConcurrentSnipes) return;

  logger.info({ mint: mint.slice(0, 8), raydiumPool }, '⚡ Migration to Raydium detected');
  // Re-run filters + buy logic on migration as well (reuse handleNewToken logic)
  // Creator unknown at this point so holder check is partial
  await handleNewToken({ mint, creator: '', name: 'MIGRATED', symbol: '???', signature, timestamp: Date.now() });
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  printBanner();

  if (!config.paperMode) {
    const wallet = getWallet();
    logger.info({ pubkey: wallet.publicKey.toBase58() }, '🔑 Wallet ready');
  }

  const listener = new PumpFunListener();

  listener.on('newToken', handleNewToken);
  listener.on('migration', handleMigration);
  listener.on('error', err => logger.error({ err: err.message }, 'WebSocket error — reconnecting'));

  await listener.start();

  // ── Position monitor loop (every 15 seconds) ────────────────────
  const positionInterval = setInterval(async () => {
    const open = getOpenPositions();
    if (open.length > 0) {
      logger.debug({ openCount: open.length }, 'Checking positions');
      await checkPositions();
    }
  }, 15_000);

  // ── Stats log every 5 minutes ───────────────────────────────────
  const statsInterval = setInterval(() => {
    logger.info({
      totalSnipes,
      totalFiltered,
      openPositions: getOpenPositions().length,
    }, '📊 Stats');
  }, 5 * 60 * 1000);

  // ── Graceful shutdown ───────────────────────────────────────────
  async function shutdown(signal) {
    logger.info({ signal }, 'Shutting down gracefully');
    clearInterval(positionInterval);
    clearInterval(statsInterval);
    await listener.stop();
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Reconnect on WebSocket errors
  listener.on('error', async () => {
    await sleep(5000);
    try { await listener.start(); } catch { /* will retry */ }
  });

  logger.info('🚀 Bot is running — listening for new pump.fun launches');
  await notify('🚀 Solana Sniper Bot started' + (config.paperMode ? ' (PAPER MODE)' : ''));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => {
  logger.error({ err: err.message }, 'Fatal error');
  process.exit(1);
});
