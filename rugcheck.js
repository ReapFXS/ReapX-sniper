import axios from 'axios';
import { config } from './config.js';
import { logger } from './logger.js';

const RUGCHECK_BASE = 'https://api.rugcheck.xyz/v1';

// Cache results to avoid hammering API
const cache = new Map();

/**
 * Fetch full RugCheck report for a token mint address.
 * Returns null if the API fails (fail-open: we still filter by our own criteria).
 */
export async function getRugCheckReport(mintAddress) {
  if (cache.has(mintAddress)) return cache.get(mintAddress);

  try {
    const { data } = await axios.get(
      `${RUGCHECK_BASE}/tokens/${mintAddress}/report/summary`,
      { timeout: 8000 }
    );
    cache.set(mintAddress, data);
    return data;
  } catch (err) {
    logger.warn({ mint: mintAddress, err: err.message }, 'RugCheck API failed');
    return null;
  }
}

/**
 * Core filter — returns { pass: bool, reason: string, score: number }
 */
export async function filterToken(mintAddress, holderData = null) {
  const report = await getRugCheckReport(mintAddress);
  const result = { pass: true, reason: '', score: 0, details: {} };

  // ── RugCheck score ────────────────────────────────────────────────
  if (report) {
    const score = report.score ?? 0;
    result.score = score;
    result.details.rugcheckScore = score;

    if (score < config.minRugcheckScore) {
      return { pass: false, reason: `RugCheck score too low: ${score}/${config.minRugcheckScore}`, score };
    }

    // Mint authority still enabled
    if (report.mintAuthority && report.mintAuthority !== '11111111111111111111111111111111') {
      return { pass: false, reason: 'Mint authority not revoked', score };
    }

    // Freeze authority still enabled
    if (report.freezeAuthority && report.freezeAuthority !== '11111111111111111111111111111111') {
      return { pass: false, reason: 'Freeze authority not revoked', score };
    }
  }

  // ── Holder concentration ──────────────────────────────────────────
  if (holderData) {
    const { topHoldersPct, devHolderPct, bundleDetected } = holderData;

    if (topHoldersPct > config.maxTop10HolderPct) {
      return {
        pass: false,
        reason: `Top 10 holders own ${topHoldersPct.toFixed(1)}% (max: ${config.maxTop10HolderPct}%)`,
        score: result.score,
      };
    }

    if (devHolderPct > config.maxDevHolderPct) {
      return {
        pass: false,
        reason: `Dev holds ${devHolderPct.toFixed(1)}% (max: ${config.maxDevHolderPct}%)`,
        score: result.score,
      };
    }

    if (config.skipBundled && bundleDetected) {
      return {
        pass: false,
        reason: 'Bundle activity detected at launch',
        score: result.score,
      };
    }
  }

  result.details.holderData = holderData;
  return result;
}

export default { getRugCheckReport, filterToken };
