import { config } from './config.js';
import { logger } from './logger.js';
import { sell, getTokenPrice } from './trader.js';
import { notify } from './telegram.js';

// Active positions: mint → PositionData
const positions = new Map();

/**
 * Open a new position after a successful buy.
 */
export function openPosition(mint, buyResult) {
  const position = {
    mint,
    entryPrice: buyResult.entryPrice,
    amountSol: buyResult.amountSol,
    tokenAmount: buyResult.amountOut,
    remainingTokens: buyResult.amountOut,
    paper: buyResult.paper ?? false,
    openedAt: Date.now(),
    signature: buyResult.signature,

    // Exit ladder state
    tpLevels: config.takeProfitMultipliers.map((mult, i) => ({
      multiplier: mult,
      pct: config.takeProfitPercents[i],
      hit: false,
    })),
    slHit: false,
  };

  positions.set(mint, position);
  logger.info({ mint, entryPrice: buyResult.entryPrice, amountSol: buyResult.amountSol }, '📂 Position opened');

  return position;
}

/**
 * Check all open positions against current prices — handle TP/SL.
 * Call this on a price poll interval.
 */
export async function checkPositions() {
  for (const [mint, pos] of positions.entries()) {
    if (pos.slHit) continue;

    const currentPrice = await getTokenPrice(mint);
    if (!currentPrice) continue;

    const multiplier = currentPrice / pos.entryPrice;
    const pnlPct = (multiplier - 1) * 100;

    logger.debug({ mint, multiplier: multiplier.toFixed(3), pnlPct: pnlPct.toFixed(1) }, 'Position check');

    // ── Stop loss ──────────────────────────────────────────────────
    if (pnlPct <= -config.stopLossPct) {
      logger.warn({ mint, pnlPct: pnlPct.toFixed(1) }, '🛑 Stop loss triggered — full exit');

      const result = await sell(mint, pos.remainingTokens, 100);

      if (result.success) {
        pos.slHit = true;
        pos.remainingTokens = 0;

        const pnlSol = (result.solReceived ?? 0) - pos.amountSol;
        notify(`🛑 *STOP LOSS* \`${mint.slice(0, 8)}...\`\nP&L: ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL (${pnlPct.toFixed(1)}%)`);
        positions.delete(mint);
      }
      continue;
    }

    // ── Take profit ladder ─────────────────────────────────────────
    for (const level of pos.tpLevels) {
      if (level.hit) continue;
      if (multiplier < level.multiplier) continue;

      level.hit = true;
      const sellPct = level.pct;
      const sellTokens = Math.floor(pos.tokenAmount * (sellPct / 100));

      logger.info({ mint, multiplier: multiplier.toFixed(2), sellPct }, `🎯 TP${level.multiplier}x — selling ${sellPct}%`);

      const result = await sell(mint, sellTokens, 100);

      if (result.success) {
        pos.remainingTokens = Math.max(0, pos.remainingTokens - sellTokens);
        const solReceived = result.solReceived ?? 0;
        notify(`🎯 *TP ${level.multiplier}x* \`${mint.slice(0, 8)}...\`\nSold ${sellPct}% → received ${solReceived.toFixed(4)} SOL`);

        // All levels hit or no tokens left — close position
        const allHit = pos.tpLevels.every(l => l.hit);
        if (allHit || pos.remainingTokens <= 0) {
          positions.delete(mint);
          logger.info({ mint }, '📁 Position fully closed');
        }
      }

      break; // Only process one TP level per check
    }
  }
}

export function getOpenPositions() {
  return Array.from(positions.values());
}

export function hasPosition(mint) {
  return positions.has(mint);
}

export default { openPosition, checkPositions, getOpenPositions, hasPosition };
