# TellySMS

Virtual numbers for SMS verification, airtime and data, and a naira wallet with per-user virtual accounts.
Node.js + Express + SQLite backend, single-file frontend in `public/`.

## Run
```
npm install
cp .env.example .env      # set JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm start                 # http://localhost:3000
```
Sign in as the admin from `.env` (PIN `1234`, change it in Profile). Then in **Profile > Admin portal**:
1. **Providers:** paste an API key for at least one number provider and one utility provider, switch them on, set priority (1 = tried first).
2. **Payment gateways:** enable Paystack, Flutterwave or Monnify and add keys. Choose which one issues **virtual accounts**.
3. **Data plans:** fill each plan's `codes` with that provider's plan code, e.g. `{"vtpass":"mtn-1gb-30d"}`. A provider with no code for a plan is skipped.

## Structure
```
server/
  index.js               boot, seeding, webhook mount, SMS polling and auto-release
  db.js                  schema, wallet helpers (debit, credit, release)
  routes.js              REST API: auth, state, numbers, utilities, wallet, 2FA, admin, webhooks
  providers/
    numbers.js           10 number providers + failover
    utilities.js         10 airtime/data providers + failover
    gateways.js          virtual-account gateways (Paystack, Flutterwave, Monnify)
    codes.js             service/country code maps per provider family
    http.js              fetch helpers
public/
  index.html             the whole frontend (landing, app, admin, legal pages)
  config.js              window.TELLY_API (backend URL; '' = same origin)
data/                    SQLite file (created on first run)
```

## Providers
- **Numbers (10):** GrizzlySMS, TigerSMS, SMSHub, SMSBower, DaisySMS, SMS-Activate (all SMS-Activate protocol), 5sim, SMS-Man, OnlineSim, SMSPool.
- **Utilities (10):** VTpass, Flutterwave Bills, Clubkonnect, VTU.ng, Gladtidings, Bilalsadasub, Maskawa, Datastation, Subandgain, Alrahuz Data.
- Keys: Admin portal or `.env` (`NUM_<ID>_KEY`, `UTIL_<ID>_KEY`). Two-part keys: VTpass `apikey:secret`, Clubkonnect `userid:apikey`, VTU.ng `username:password`.
- To add one: write an adapter in `numbers.js` / `utilities.js`, add it to `list`, restart. It appears in the admin table automatically.

## Virtual accounts and webhooks
Set each gateway's webhook URL to `https://YOURDOMAIN/webhooks/paystack`, `/webhooks/flutterwave`, `/webhooks/monnify`.
- Paystack: dedicated accounts must be enabled on your business. Keys: secret key in "Secret".
- Flutterwave: set `FLW_BVN` in `.env`; set the dashboard "secret hash" equal to your secret key.
- Monnify: "Public key" field = `apiKey|contractCode`; "Secret" = secret key.
Credits are idempotent (unique transaction reference), so a repeated webhook cannot double-credit.

## Wallet rules
Deposits are non-refundable. A number cancelled or expired before any SMS returns its cost to the wallet as credit (exactly once). Failed utility orders are not charged.

## Before going live (read this)
- **Not tested against live providers.** Endpoints, response formats and code maps were written from each provider's documented API style and must be checked against the current docs and tried with small real orders. Edit `codes.js` and the adapters as needed.
- SMS-Man and SMSPool need their numeric service/country ids in `codes.js` before they work.
- Failover on utilities can double-deliver if a provider succeeds but times out. Add reconciliation before volume.
- Add HTTPS (reverse proxy), rate limiting on `/api/login` and `/api/signup`, regular SQLite backups, and move provider/gateway keys to `.env` rather than the database if you prefer.
- Terms, Privacy and Refund text in `public/index.html` are templates. Have them reviewed before launch.
