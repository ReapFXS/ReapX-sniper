import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { config } from './config.js';
import { logger } from './logger.js';

const connection = new Connection(config.rpcUrl, { commitment: 'confirmed' });

/**
 * Fetch top token holders and compute concentration metrics.
 * Returns holder data used by the filter.
 */
export async function analyzeHolders(mintAddress, creatorAddress) {
  try {
    const mint = new PublicKey(mintAddress);

    // Get largest token accounts
    const { value: holders } = await connection.getTokenLargestAccounts(mint);

    if (!holders || holders.length === 0) {
      return { topHoldersPct: 0, devHolderPct: 0, bundleDetected: false, holderCount: 0 };
    }

    // Total supply from mint info
    const mintInfo = await connection.getParsedAccountInfo(mint);
    const supplyRaw = mintInfo.value?.data?.parsed?.info?.supply;
    const decimals = mintInfo.value?.data?.parsed?.info?.decimals ?? 6;
    const totalSupply = supplyRaw ? Number(supplyRaw) / Math.pow(10, decimals) : 0;

    if (totalSupply === 0) {
      return { topHoldersPct: 0, devHolderPct: 0, bundleDetected: false, holderCount: holders.length };
    }

    // Get account owners to identify dev wallet
    const ownerMap = new Map();
    for (const holder of holders.slice(0, 10)) {
      try {
        const info = await connection.getParsedAccountInfo(holder.address);
        const owner = info.value?.data?.parsed?.info?.owner;
        if (owner) ownerMap.set(holder.address.toBase58(), owner);
      } catch {
        // skip
      }
    }

    // Compute top-10 concentration
    const top10Amount = holders.slice(0, 10).reduce((sum, h) => sum + (h.uiAmount ?? 0), 0);
    const topHoldersPct = (top10Amount / totalSupply) * 100;

    // Dev holder pct — find if creator owns any of the top accounts
    let devHolderPct = 0;
    for (const holder of holders) {
      const owner = ownerMap.get(holder.address.toBase58());
      if (owner === creatorAddress) {
        devHolderPct = ((holder.uiAmount ?? 0) / totalSupply) * 100;
        break;
      }
    }

    // Bundle detection heuristic:
    // If multiple top holders have nearly identical amounts (within 0.1%),
    // they were likely bought atomically in the same bundle
    const bundleDetected = detectBundles(holders.slice(0, 20), totalSupply);

    return {
      topHoldersPct,
      devHolderPct,
      bundleDetected,
      holderCount: holders.length,
      top10Holders: holders.slice(0, 10).map(h => ({
        address: h.address.toBase58(),
        amount: h.uiAmount,
        pct: ((h.uiAmount ?? 0) / totalSupply * 100).toFixed(2),
      })),
    };
  } catch (err) {
    logger.warn({ mint: mintAddress, err: err.message }, 'Holder analysis failed');
    return { topHoldersPct: 0, devHolderPct: 0, bundleDetected: false, holderCount: 0 };
  }
}

/**
 * Detect if top holders bought in coordinated bundles.
 * Heuristic: 3+ wallets holding the same amount within 0.5% tolerance = likely bundled.
 */
function detectBundles(holders, totalSupply) {
  if (holders.length < 3) return false;

  const amounts = holders.map(h => h.uiAmount ?? 0).filter(a => a > 0);
  let bundleGroups = 0;

  for (let i = 0; i < amounts.length - 2; i++) {
    const base = amounts[i];
    if (base === 0) continue;

    let matchCount = 1;
    for (let j = i + 1; j < amounts.length; j++) {
      const diff = Math.abs(amounts[j] - base) / base;
      if (diff < 0.005) matchCount++; // within 0.5%
    }

    // 3+ wallets with the same amount = bundle signal
    if (matchCount >= 3) {
      const pct = (base * matchCount / totalSupply) * 100;
      // Only flag if the bundle controls a meaningful % of supply
      if (pct > 5) {
        bundleGroups++;
      }
    }
  }

  return bundleGroups > 0;
}

export default { analyzeHolders };
