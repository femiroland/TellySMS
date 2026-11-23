// SQLite schema + small helpers. Money is stored as whole naira.
const Database = require('better-sqlite3'), fs = require('fs'), path = require('path');
const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tellysms.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file); db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT, pass TEXT, pin TEXT, bal INTEGER DEFAULT 0, admin INTEGER DEFAULT 0, totp TEXT, totp_on INTEGER DEFAULT 0, created INTEGER);
CREATE TABLE IF NOT EXISTS acts(id INTEGER PRIMARY KEY, uid INTEGER, svc TEXT, country TEXT, number TEXT, price INTEGER, status TEXT, code TEXT, provider TEXT, ext TEXT, t INTEGER, exp INTEGER);
CREATE TABLE IF NOT EXISTS txs(id INTEGER PRIMARY KEY, uid INTEGER, kind TEXT, amount INTEGER, method TEXT, status TEXT, ref TEXT UNIQUE, t INTEGER);
CREATE TABLE IF NOT EXISTS providers(kind TEXT, id TEXT, enabled INTEGER DEFAULT 1, priority INTEGER, apikey TEXT DEFAULT '', PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS vaccounts(uid INTEGER, gateway TEXT, account_no TEXT, bank TEXT, name TEXT, PRIMARY KEY(uid,gateway));
CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY, network TEXT, label TEXT, price INTEGER, codes TEXT DEFAULT '{}');
`);
const PRICES = { wa: 900, tg: 700, go: 600, fb: 650, ig: 700, x: 800, tt: 750, ms: 600, am: 900, dc: 650, ub: 1000, pp: 1200 };
const MULT = { ng: 1, us: 1.4, gb: 1.3, ca: 1.3, de: 1.5, fr: 1.5, in: 0.8, za: 1.1 };
const GW0 = { paystack: { on: 0, pub: '', sec: '' }, flutterwave: { on: 0, pub: '', sec: '' }, monnify: { on: 0, pub: '', sec: '' }, bank: { on: 1, det: 'Bank: ____ | Account number: ____ | Account name: ____' } };
const cfg = (k, d) => { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(k); return r ? JSON.parse(r.v) : d; };
const setCfg = (k, v) => db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, JSON.stringify(v));
const addTx = (uid, kind, amount, method, status = 'ok', ref) => db.prepare('INSERT INTO txs(uid,kind,amount,method,status,ref,t) VALUES(?,?,?,?,?,?,?)').run(uid, kind, amount, method, status, ref || 'TS' + Date.now() + Math.floor(Math.random() * 1e4), Date.now());
const credit = (uid, amt) => db.prepare('UPDATE users SET bal=bal+? WHERE id=?').run(amt, uid);
const debit = db.transaction((uid, amt) => { if (!db.prepare('UPDATE users SET bal=bal-? WHERE id=? AND bal>=?').run(amt, uid, amt).changes) throw Object.assign(new Error('Insufficient balance. Please fund your wallet.'), { status: 402 }); });
// Cancel a waiting activation and return the cost to the wallet exactly once.
const release = db.transaction((a, note) => { if (db.prepare("UPDATE acts SET status='cancel' WHERE id=? AND status='waiting'").run(a.id).changes) { credit(a.uid, a.price); addTx(a.uid, 'rel', a.price, note); return true; } return false; });
const seedProviders = (kind, ids) => ids.forEach((id, i) => db.prepare('INSERT OR IGNORE INTO providers(kind,id,priority) VALUES(?,?,?)').run(kind, id, i + 1));
module.exports = { db, PRICES, MULT, GW0, cfg, setCfg, addTx, credit, debit, release, seedProviders };
