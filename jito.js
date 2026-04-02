import axios from 'axios';
import { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import { config } from './config.js';
import { logger } from './logger.js';

// Jito tip accounts — rotate to distribute tips
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt13ij922T',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

function getRandomTipAccount() {
  return JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
}

/**
 * Submit a bundle of transactions to Jito for priority inclusion.
 *
 * @param {Transaction[]} transactions - Array of signed transactions (max 5)
 * @param {Keypair} payer - Wallet that pays the tip
 * @param {Connection} connection
 * @returns {string} Bundle ID
 */
export async function submitBundle(transactions, payer, connection) {
  const tipLamports = Math.floor(config.jitoTipSol * LAMPORTS_PER_SOL);

  // Build tip transaction
  const tipTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: new PublicKey(getRandomTipAccount()),
      lamports: tipLamports,
    })
  );

  const { blockhash } = await connection.getLatestBlockhash('finalized');
  tipTx.recentBlockhash = blockhash;
  tipTx.feePayer = payer.publicKey;
  tipTx.sign(payer);

  // Add tip tx at the end of the bundle
  const allTxs = [...transactions, tipTx];

  const encodedTxs = allTxs.map(tx =>
    Buffer.from(tx.serialize()).toString('base64')
  );

  logger.info({ tipSol: config.jitoTipSol, txCount: encodedTxs.length }, '📦 Submitting Jito bundle');

  try {
    const { data } = await axios.post(
      `${config.jitoUrl}/api/v1/bundles`,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [encodedTxs],
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );

    const bundleId = data?.result;
    logger.info({ bundleId }, '✅ Jito bundle submitted');
    return bundleId;
  } catch (err) {
    const msg = err.response?.data?.error?.message ?? err.message;
    logger.warn({ err: msg }, '⚠️ Jito bundle failed — falling back to normal submission');
    throw new Error(`Jito submission failed: ${msg}`);
  }
}

/**
 * Poll Jito for bundle status.
 * Returns: 'landed' | 'failed' | 'pending'
 */
export async function getBundleStatus(bundleId) {
  try {
    const { data } = await axios.post(
      `${config.jitoUrl}/api/v1/bundles`,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'getBundleStatuses',
        params: [[bundleId]],
      },
      { timeout: 8000 }
    );

    const status = data?.result?.value?.[0]?.confirmation_status;
    if (status === 'confirmed' || status === 'finalized') return 'landed';
    if (data?.result?.value?.[0]?.err) return 'failed';
    return 'pending';
  } catch {
    return 'pending';
  }
}

export default { submitBundle, getBundleStatus };
