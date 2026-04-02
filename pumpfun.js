import { Connection, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'events';
import { config } from './config.js';
import { logger } from './logger.js';

// pump.fun program ID on Solana mainnet
export const PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

// Raydium V4 AMM program (tokens migrate here after bonding curve completion)
export const RAYDIUM_AMM_V4 = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

// pump.fun bonding curve seed
const BONDING_CURVE_SEED = 'bonding-curve';

/**
 * PumpFunListener — emits 'newToken' events when a fresh launch is detected.
 *
 * Events emitted:
 *   'newToken' — { mint, bondingCurve, creator, signature, timestamp }
 *   'migration' — { mint, raydiumPool, signature, timestamp }  (bonding curve → Raydium)
 *   'error'    — Error object
 */
export class PumpFunListener extends EventEmitter {
  constructor() {
    super();
    this.connection = new Connection(config.rpcUrl, {
      commitment: 'processed',
      wsEndpoint: config.rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://'),
    });
    this.subscriptionId = null;
    this.running = false;
    this._seenSignatures = new Set();
  }

  /**
   * Start listening for new pump.fun token creations.
   */
  async start() {
    if (this.running) return;
    this.running = true;

    logger.info('🔌 Connecting to Solana WebSocket...');

    try {
      // Subscribe to logs mentioning the pump.fun program
      this.subscriptionId = this.connection.onLogs(
        PUMP_FUN_PROGRAM,
        async (logsResult) => {
          try {
            await this._handleLog(logsResult);
          } catch (err) {
            this.emit('error', err);
          }
        },
        'processed'
      );

      logger.info(`✅ Subscribed to pump.fun program logs (sub #${this.subscriptionId})`);
    } catch (err) {
      this.running = false;
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Stop the listener.
   */
  async stop() {
    if (!this.running) return;
    this.running = false;

    if (this.subscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
      logger.info('🔌 WebSocket subscription removed');
    }
  }

  /**
   * Handle incoming log — detect 'Create' instructions (new token launch).
   */
  async _handleLog({ signature, logs, err }) {
    if (err) return;
    if (this._seenSignatures.has(signature)) return;
    this._seenSignatures.add(signature);

    // Keep seen set bounded
    if (this._seenSignatures.size > 5000) {
      const first = this._seenSignatures.values().next().value;
      this._seenSignatures.delete(first);
    }

    const logStr = logs.join(' ');

    // New token launch detection
    if (logStr.includes('InitializeMint') || logStr.includes('Program log: Instruction: Create')) {
      const tokenData = await this._parseNewToken(signature);
      if (tokenData) {
        this.emit('newToken', { ...tokenData, signature, timestamp: Date.now() });
      }
    }

    // Migration to Raydium detection (bonding curve completed)
    if (logStr.includes('Program log: Instruction: Initialize') && logStr.includes(RAYDIUM_AMM_V4.toBase58())) {
      const migrationData = await this._parseMigration(signature);
      if (migrationData) {
        this.emit('migration', { ...migrationData, signature, timestamp: Date.now() });
      }
    }
  }

  /**
   * Parse transaction to extract new token details.
   */
  async _parseNewToken(signature) {
    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || !tx.transaction) return null;

      const accounts = tx.transaction.message.accountKeys;
      if (!accounts || accounts.length < 2) return null;

      // Creator is the fee payer (first account)
      const creator = accounts[0]?.pubkey?.toBase58?.() ?? accounts[0]?.toString();

      // Find the new mint — typically the second account in pump.fun create tx
      const mint = accounts[1]?.pubkey?.toBase58?.() ?? accounts[1]?.toString();

      if (!mint || !creator) return null;

      // Derive bonding curve PDA
      const [bondingCurve] = PublicKey.findProgramAddressSync(
        [Buffer.from(BONDING_CURVE_SEED), new PublicKey(mint).toBytes()],
        PUMP_FUN_PROGRAM
      );

      // Extract name/symbol from logs if available
      const meta = tx.meta;
      const logMessages = meta?.logMessages ?? [];
      const nameLog = logMessages.find(l => l.includes('name:'));
      const symbolLog = logMessages.find(l => l.includes('symbol:'));

      return {
        mint,
        bondingCurve: bondingCurve.toBase58(),
        creator,
        name: nameLog ? nameLog.split('name:')[1]?.trim() : 'Unknown',
        symbol: symbolLog ? symbolLog.split('symbol:')[1]?.trim() : 'UNKNOWN',
      };
    } catch (err) {
      logger.debug({ signature, err: err.message }, 'Failed to parse new token tx');
      return null;
    }
  }

  /**
   * Parse migration transaction (bonding curve → Raydium pool).
   */
  async _parseMigration(signature) {
    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) return null;

      const accounts = tx.transaction.message.accountKeys;
      const mint = accounts[1]?.pubkey?.toBase58?.() ?? accounts[1]?.toString();

      return { mint, raydiumPool: accounts[4]?.pubkey?.toBase58?.() ?? null };
    } catch {
      return null;
    }
  }
}

export default PumpFunListener;
