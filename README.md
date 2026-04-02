# ReapX-sniper
solana memecoin sniper pump-fun jito geyser kol-tracking conviction-scoring backtest trading-bot nodejs javascript
# ReapX

**Elite Solana memecoin sniper built for the trenches.**

ReapX listens to new pump.fun launches in real time via Geyser gRPC (or WebSocket fallback), scores every token through a multi-signal conviction engine, and executes buys atomically through Jito bundles with Jupiter routing. Built and used by a self-taught developer actively trading Solana memecoins.
```
New token detected (Geyser gRPC / WebSocket)
          │
          ├─► Targeted match? (ticker / name / dev wallet)
          │         └─► Instant buy, filters optional
          │
          ├─► KOL wallet bought?
          │         └─► Copy-trade within max delay window
          │
          └─► Normal pipeline
                    ├─ Holder analysis + bundle detection
                    ├─ RugCheck score
                    ├─ Conviction score (0–100)
                    ├─ Dynamic position sizing by score
                    └─ Jito bundle buy → position manager
```

## Features

**Speed**
- Geyser gRPC listener for sub-100ms token detection
- Multi-RPC pool with automatic failover and latency tracking
- Jito bundle submission with dynamic tip sizing
- WebSocket fallback when Geyser is unavailable

**Intelligence**
- Conviction scoring engine — combines holder concentration, bundle detection, RugCheck score, social signals, and dev wallet history into a 0–100 score
- Dynamic position sizing — higher conviction = larger buy, lower conviction = smaller buy
- On-chain bundle detection — heuristic algorithm identifies coordinated wallet clusters at launch
- Twitter/social signal integration — detects organic vs paid CT activity

**Targeted sniping**
- Ticker snipe — exact `$SYMBOL` match, buys instantly
- Name snipe — exact token name match
- Dev wallet snipe — buy anything launched by a specific address

**KOL copy-trade**
- Monitor multiple KOL wallets simultaneously
- Configurable max delay window (skip stale copies)
- Per-KOL buy size configuration

**Risk management**
- Staged take-profit ladder (e.g. sell 30% at 2x, 30% at 3x, 20% at 5x)
- Hard stop-loss with optional trailing stop
- Max concurrent positions limit

**Infrastructure**
- SQLite trade database — every buy/sell recorded with conviction score and trigger type
- Live web dashboard — real-time P&L, open positions, RPC status, Jito stats (WebSocket feed)
- Backtest engine — replay historical token data against your filter config
- Telegram alerts — buy, sell, stop-loss, KOL copy, targeted hit
- Paper trading mode — full simulation without spending SOL

## Stack

Node.js 20+ · `@solana/web3.js` · `@triton-one/yellowstone-grpc` · Jupiter v6 · Jito bundles · `better-sqlite3` · Express + WebSocket dashboard

## Setup
```bash
git clone https://github.com/ReapFX/reapx.git
cd reapx
npm install
cp .env.example .env
# Fill in .env — RPC URLs, private key, targets
npm run paper       # paper trading (no real SOL)
npm run backtest    # test filters against historical data
npm start           # go live
```

## Configuration

All settings via `.env`. See [`.env.example`](.env.example) for the full reference.

Key parameters:

| Variable | Description |
|---|---|
| `RPC_URLS` | Comma-separated RPC endpoints (multi-pool) |
| `GEYSER_ENDPOINT` | Yellowstone gRPC endpoint for fast detection |
| `BUY_AMOUNT_SOL` | Default buy size |
| `TARGETED_BUY_AMOUNT_SOL` | Buy size for targeted/ticker snipes |
| `KOL_WALLETS` | Wallets to copy-trade (`address:label:sol,...`) |
| `TICKER_SNIPE_TARGETS` | Tickers to instant-buy (`TRUMP,PEPE,...`) |
| `DEV_WALLET_TARGETS` | Dev wallet addresses to snipe |
| `MIN_CONVICTION_SCORE` | Minimum score to trade (0–100) |
| `JITO_TIP_MIN_SOL` / `MAX` | Dynamic Jito tip range |
| `STOP_LOSS_PCT` | Hard stop-loss % |
| `TRAILING_STOP_PCT` | Trailing stop % (0 to disable) |
| `TAKE_PROFIT_MULTIPLIERS` | TP levels e.g. `2,3,5` |
| `DASHBOARD_ENABLED` | Enable live web dashboard |
| `SOCIAL_SIGNAL_ENABLED` | Enable Twitter signal integration |

## Dashboard

When `DASHBOARD_ENABLED=true`, a live dashboard runs at `http://localhost:3000` showing real-time token detections, open positions with P&L, trade history, RPC pool latency, and Jito bundle land rate.

## Architecture
```
src/
├── index.js        Main orchestrator — event routing, buy pipeline
├── listener.js     Geyser gRPC + WebSocket token listener
├── conviction.js   Multi-signal conviction scoring engine
├── targeted.js     Ticker / name / dev wallet snipe matching
├── kol.js          KOL wallet monitor + copy-trade
├── holders.js      On-chain holder analysis + bundle detection
├── rugcheck.js     RugCheck API integration
├── social.js       Twitter/CT signal analysis
├── trader.js       Buy/sell execution via Jupiter v6
├── jito.js         Jito bundle submission + tip management
├── rpc.js          Multi-RPC pool with latency tracking
├── position.js     Position manager — TP ladder, stop-loss, trailing
├── db.js           SQLite trade database
├── backtest.js     Historical backtest engine
├── telegram.js     Telegram alert system
├── config.js       Environment config with validation
├── logger.js       Structured logger (pino)
└── dashboard/
    └── server.js   Express + WebSocket live dashboard
```

## Risk Warning

Memecoin trading carries extreme risk. Most tokens go to zero. Never trade with funds you cannot afford to lose completely. Always test in paper mode first.

## License

Proprietary — © 2025 ReapFX. All rights reserved.
```

---

## GitHub pinned repo description

When you pin it on your profile, use this as the description card:

> **ReapX** — Elite Solana sniper I built and use daily. Geyser gRPC detection, conviction scoring, KOL copy-trade, Jito bundles, live dashboard. Node.js.

---

## Your GitHub profile bio (optional but helps)
```
Self-taught dev · Solana memecoin trader · Building trading infrastructure in Node.js + Python
```

---

## Commit message for your first push
```
feat: initial public release — ReapX v4.0
