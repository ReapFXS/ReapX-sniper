import {
  Connection, Keypair, PublicKey, LAMPORTS_PER_SOL,
  VersionedTransaction, TransactionMessage,
} from '@solana/web3.js';
import bs58 from 'bs58';
import axios from 'axios';
import { config } from './config.js';
import { logger } from './logger.js';
import { submitBundle } from './jito.js';

const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

let _connection = null;
let _wallet = null;

export function getConnection() {
  if (!_connection) {
    _connection = new Connection(config.rpcUrl, { commitment: 'confirmed' });
  }
  return _connection;
}

export function getWallet() {
  if (config.paperMode) return null;
  if (!_wallet) {
    const secret = bs58.decode(config.privateKey);
    _wallet = Keypair.fromSecretKey(secret);
    logger.info({ pubkey: _wallet.publicKey.toBase58() }, '🔑 Wallet loaded');
  }
  return _wallet;
}

/**
 * Get a Jupiter swap quote: SOL → token or token → SOL.
 */
async function getQuote(inputMint, outputMint, amountLamports) {
  const { data } = await axios.get(`${JUPITER_QUOTE_API}/quote`, {
    params: {
      inputMint,
      outputMint,
      amount: amountLamports.toString(),
      slippageBps: config.slippageBps,
      onlyDirectRoutes: false,
      asLegacyTransaction: false,
    },
    timeout: 10000,
  });
  return data;
}

/**
 * Build a swap transaction from a Jupiter quote.
 */
async function buildSwapTx(quote, walletPubkey) {
  const { data } = await axios.post(`${JUPITER_QUOTE_API}/swap`, {
    quoteResponse: quote,
    userPublicKey: walletPubkey.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: Math.floor(config.jitoTipSol * LAMPORTS_PER_SOL * 0.1), // small priority fee on top of tip
  }, { timeout: 10000 });

  const txBuffer = Buffer.from(data.swapTransaction, 'base64');
  return VersionedTransaction.deserialize(txBuffer);
}

/**
 * Execute a BUY — swap SOL → token.
 * Returns { success, signature, amountOut, entryPrice } or { success: false, error }
 */
export async function buy(mintAddress, amountSol = config.buyAmountSol) {
  if (config.paperMode) {
    logger.info({ mint: mintAddress, amountSol }, '📝 [PAPER] BUY simulated');
    return {
      success: true,
      paper: true,
      signature: 'PAPER_' + Date.now(),
      amountSol,
      amountOut: amountSol * 1_000_000, // fake token amount
      entryPrice: amountSol / 1_000_000,
      timestamp: Date.now(),
    };
  }

  const wallet = getWallet();
  const connection = getConnection();
  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  logger.info({ mint: mintAddress, amountSol }, '🟢 Executing BUY');

  try {
    const quote = await getQuote(SOL_MINT, mintAddress, lamports);
    const outAmount = Number(quote.outAmount);

    const tx = await buildSwapTx(quote, wallet.publicKey);
    tx.sign([wallet]);

    let signature;

    // Try Jito bundle first, fall back to normal submission
    try {
      const bundleId = await submitBundle([tx], wallet, connection);

      // Poll for landing (up to 30s)
      let attempts = 0;
      while (attempts < 15) {
        await sleep(2000);
        const { getBundleStatus } = await import('./jito.js');
        const status = await getBundleStatus(bundleId);
        if (status === 'landed') { signature = bundleId; break; }
        if (status === 'failed') throw new Error('Bundle failed to land');
        attempts++;
      }
      if (!signature) signature = bundleId;
    } catch (jitoErr) {
      logger.warn('Jito failed, using normal submission');
      signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'processed',
        maxRetries: 3,
      });
      await connection.confirmTransaction(signature, 'confirmed');
    }

    const entryPrice = amountSol / outAmount;

    logger.info({ signature, amountOut: outAmount, entryPrice }, '✅ BUY confirmed');

    return {
      success: true,
      signature,
      amountSol,
      amountOut: outAmount,
      entryPrice,
      timestamp: Date.now(),
    };
  } catch (err) {
    logger.error({ err: err.message, mint: mintAddress }, '❌ BUY failed');
    return { success: false, error: err.message };
  }
}

/**
 * Execute a SELL — swap token → SOL.
 * @param {string} mintAddress
 * @param {number} tokenAmount — raw token amount (with decimals)
 * @param {number} pctOfPosition — 0–100, what % of this amount to sell
 */
export async function sell(mintAddress, tokenAmount, pctOfPosition = 100) {
  const sellAmount = Math.floor(tokenAmount * (pctOfPosition / 100));

  if (config.paperMode) {
    logger.info({ mint: mintAddress, pct: pctOfPosition }, '📝 [PAPER] SELL simulated');
    return { success: true, paper: true, signature: 'PAPER_SELL_' + Date.now(), sellAmount };
  }

  const wallet = getWallet();
  const connection = getConnection();

  logger.info({ mint: mintAddress, sellAmount, pct: pctOfPosition }, '🔴 Executing SELL');

  try {
    const quote = await getQuote(mintAddress, SOL_MINT, sellAmount);
    const tx = await buildSwapTx(quote, wallet.publicKey);
    tx.sign([wallet]);

    let signature;
    try {
      const bundleId = await submitBundle([tx], wallet, connection);
      signature = bundleId;
    } catch {
      signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false, maxRetries: 3,
      });
      await connection.confirmTransaction(signature, 'confirmed');
    }

    const solReceived = Number(quote.outAmount) / LAMPORTS_PER_SOL;
    logger.info({ signature, solReceived, pct: pctOfPosition }, '✅ SELL confirmed');

    return { success: true, signature, sellAmount, solReceived, timestamp: Date.now() };
  } catch (err) {
    logger.error({ err: err.message, mint: mintAddress }, '❌ SELL failed');
    return { success: false, error: err.message };
  }
}

/**
 * Get current token price in SOL (via Jupiter quote for 1 token).
 */
export async function getTokenPrice(mintAddress, decimals = 6) {
  try {
    const oneToken = Math.pow(10, decimals);
    const quote = await getQuote(mintAddress, SOL_MINT, oneToken);
    return Number(quote.outAmount) / LAMPORTS_PER_SOL;
  } catch {
    return null;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default { buy, sell, getTokenPrice, getWallet, getConnection };
