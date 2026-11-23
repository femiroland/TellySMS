const express = require('express'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), { authenticator } = require('otplib');
const D = require('./db'), { db } = D;
const nums = require('./providers/numbers'), utils = require('./providers/utilities'), GW = require('./providers/gateways');
const r = express.Router(), SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const w = f => (q, s, n) => f(q, s).catch(n), bad = (m, c = 400) => Object.assign(new Error(m), { status: c });
const sign = id => jwt.sign({ id }, SECRET, { expiresIn: '7d' }), user = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
const auth = (q, s, n) => { try { q.user = user(jwt.verify((q.headers.authorization || '').slice(7), SECRET).id); if (!q.user) throw 0; n(); } catch (e) { s.status(401).json({ error: 'Please sign in again.' }); } };
const adm = (q, s, n) => q.user.admin ? n() : s.status(403).json({ error: 'Admins only' });
const pinOk = (u, p) => { if (u.pin && !bcrypt.compareSync(String(p || ''), u.pin)) throw bad('Incorrect PIN.', 403); };
const price = (svc, c) => { const b = D.cfg('prices', D.PRICES)[svc], m = D.MULT[c]; if (!b || !m) throw bad('Unknown service or country'); return Math.round(b * m / 10) * 10; };
const gws = () => D.cfg('gw', D.GW0), vagId = () => { const g = D.cfg('vag', ''), k = gws()[g]; return g && k && k.on && k.sec && GW[g] ? g : ''; };
const GN = { paystack: 'Paystack', flutterwave: 'Flutterwave', monnify: 'Monnify' };

r.post('/signup', w(async (q, s) => { const { name, email, password, pin } = q.body;
  if (!name || !/\S+@\S+\.\S+/.test(email || '') || String(password || '').length < 6 || !/^\d{4}$/.test(pin || '')) throw bad('Enter your name, a valid email, a password of 6+ characters and a 4-digit PIN.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase())) throw bad('An account with this email already exists.');
  const i = db.prepare('INSERT INTO users(email,name,pass,pin,created) VALUES(?,?,?,?,?)').run(email.toLowerCase(), name.trim(), bcrypt.hashSync(password, 10), bcrypt.hashSync(pin, 10), Date.now());
  s.json({ token: sign(i.lastInsertRowid) }); }));
r.post('/login', w(async (q, s) => { const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(q.body.email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(String(q.body.password || ''), u.pass)) throw bad('Incorrect email or password.', 401);
  if (u.totp_on) { if (!q.body.code) return s.status(401).json({ error: 'Authenticator code required', need2fa: true }); if (!authenticator.check(String(q.body.code), u.totp)) throw bad('Wrong authenticator code.', 401); }
  s.json({ token: sign(u.id) }); }));

const PR = k => { const m = k === 'num' ? nums : utils; return db.prepare('SELECT * FROM providers WHERE kind=? ORDER BY priority').all(k).map(p => ({ id: p.id, name: (m.list.find(x => x.id === p.id) || {}).name || p.id, on: p.enabled, pri: p.priority, hasKey: !!(p.apikey || process.env[(k === 'num' ? 'NUM_' : 'UTIL_') + p.id.toUpperCase() + '_KEY']) })); };
r.get('/state', auth, w(async (q, s) => { const u = q.user, a = !!u.admin, g = gws(), vag = vagId();
  const A = db.prepare(`SELECT a.*,u.email FROM acts a JOIN users u ON u.id=a.uid ${a ? '' : 'WHERE a.uid=?'} ORDER BY a.t DESC LIMIT 300`).all(...(a ? [] : [u.id]));
  const T = db.prepare(`SELECT x.*,u.email FROM txs x JOIN users u ON u.id=x.uid ${a ? '' : 'WHERE x.uid=?'} ORDER BY x.t DESC LIMIT 300`).all(...(a ? [] : [u.id]));
  const va = vag ? db.prepare('SELECT account_no,bank,name FROM vaccounts WHERE uid=? AND gateway=?').get(u.id, vag) : undefined;
  const U = (a ? db.prepare('SELECT * FROM users').all() : [u]).map(x => ({ e: x.email, n: x.name, b: x.bal, a: x.admin, pin: x.pin ? 1 : 0, totp: x.totp_on, va: x.id === u.id ? va : undefined }));
  const G = a ? g : { ...(g.paystack.on && g.paystack.sec ? { paystack: { on: 1 } } : {}), bank: { on: g.bank.on, det: g.bank.det } };
  s.json({ s: u.email, u: U, vag, rate: D.cfg('rate', 1500), P: D.cfg('prices', D.PRICES), G,
    A: A.map(x => ({ id: x.id, e: x.email, s: x.svc, c: x.country, num: x.number, p: x.price, t: x.t, x: x.exp, code: x.code || '', st: x.status })),
    T: T.map(x => ({ id: x.ref, e: x.email, k: x.kind, a: x.amount, m: x.method, st: x.status, t: x.t })),
    PL: db.prepare('SELECT * FROM plans').all().map(p => ({ id: p.id, n: p.network, l: p.label, p: p.price, ...(a ? { codes: JSON.parse(p.codes) } : {}) })),
    PR: a ? { num: PR('num'), util: PR('util') } : { num: [], util: [] } }); }));

r.post('/numbers/buy', auth, w(async (q, s) => { const { svc, country, pin } = q.body, u = q.user; pinOk(u, pin);
  const p = price(svc, country); D.debit(u.id, p);
  try { const n = await nums.buy(svc, country), t = Date.now();
    db.prepare("INSERT INTO acts(uid,svc,country,number,price,status,provider,ext,t,exp) VALUES(?,?,?,?,?,'waiting',?,?,?,?)").run(u.id, svc, country, n.number, p, n.provider, n.ext, t, t + 20 * 60 * 1000);
    D.addTx(u.id, 'buy', -p, `${svc} · ${country}`); s.json({ ok: 1 });
  } catch (e) { D.credit(u.id, p); throw e; } }));
r.post('/numbers/cancel', auth, w(async (q, s) => { const a = db.prepare("SELECT * FROM acts WHERE id=? AND uid=? AND status='waiting'").get(q.body.id, q.user.id); if (!a) throw bad('Nothing to cancel', 404);
  await nums.cancel(a.provider, a.ext).catch(() => {}); D.release(a, 'Cancelled before SMS'); s.json({ ok: 1 }); }));

r.post('/util/buy', auth, w(async (q, s) => { const { kind, network, phone, plan, pin } = q.body, u = q.user; pinOk(u, pin);
  if (!['airtime', 'data'].includes(kind) || !['mtn', 'airtel', 'glo', '9mobile'].includes(network) || !/^0\d{10}$/.test(phone || '')) throw bad('Invalid request');
  let amount = Math.round(+q.body.amount);
  if (kind === 'data') { const p = db.prepare('SELECT * FROM plans WHERE id=? AND network=?').get(plan, network); if (!p) throw bad('Choose a data plan'); amount = p.price; } else if (!(amount >= 50 && amount <= 50000)) throw bad('Airtime must be ₦50 to ₦50,000');
  D.debit(u.id, amount); const ref = 'U' + Date.now() + Math.floor(Math.random() * 1e4);
  try { await utils.buy({ kind, network, phone, amount, plan, ref }); D.addTx(u.id, 'util', -amount, `${network.toUpperCase()} ${kind} · ${phone}`, 'ok', ref); s.json({ ok: 1 }); } catch (e) { D.credit(u.id, amount); throw e; } }));

r.post('/wallet/virtual-account', auth, w(async (q, s) => { const g = vagId(); if (!g) throw bad('Virtual accounts are not enabled yet.');
  const ex = db.prepare('SELECT * FROM vaccounts WHERE uid=? AND gateway=?').get(q.user.id, g); if (ex) return s.json(ex);
  const a = await GW[g].create({ id: q.user.id, email: q.user.email, name: q.user.name }, gws()[g]);
  db.prepare('INSERT INTO vaccounts VALUES(?,?,?,?,?)').run(q.user.id, g, a.account_no, a.bank, a.name); s.json(a); }));
r.post('/wallet/card', auth, w(async (q, s) => { const amt = Math.round(+q.body.amount), k = gws().paystack; if (!(amt >= 500) || !k.on || !k.sec) throw bad('Card payments are not available.');
  const ref = 'TSC' + Date.now() + Math.floor(Math.random() * 1e4); D.addTx(q.user.id, 'dep', amt, 'Paystack', 'pending', ref);
  s.json({ url: await GW.paystack.checkout(q.user, amt, ref, k, (process.env.PUBLIC_URL || '') + '/#wallet') }); }));
r.post('/wallet/bank', auth, w(async (q, s) => { const amt = Math.round(+q.body.amount); if (!(amt >= 500)) throw bad('Minimum deposit is ₦500.'); D.addTx(q.user.id, 'dep', amt, 'Bank transfer', 'pending'); s.json({ ok: 1 }); }));
r.post('/pin', auth, w(async (q, s) => { pinOk(q.user, q.body.cur); if (!/^\d{4}$/.test(q.body.pin || '')) throw bad('New PIN must be 4 digits.'); db.prepare('UPDATE users SET pin=? WHERE id=?').run(bcrypt.hashSync(q.body.pin, 10), q.user.id); s.json({ ok: 1 }); }));
r.post('/2fa/setup', auth, w(async (q, s) => { const sec = authenticator.generateSecret(); db.prepare('UPDATE users SET totp=?,totp_on=0 WHERE id=?').run(sec, q.user.id); s.json({ secret: sec, uri: authenticator.keyuri(q.user.email, 'TellySMS', sec) }); }));
r.post('/2fa/enable', auth, w(async (q, s) => { const u = user(q.user.id); if (!u.totp || !authenticator.check(String(q.body.code || ''), u.totp)) throw bad('Wrong code.'); db.prepare('UPDATE users SET totp_on=1 WHERE id=?').run(u.id); s.json({ ok: 1 }); }));

// ---- admin
const A = [auth, adm];
r.post('/admin/gateway', ...A, w(async (q, s) => { const { id, on, pub, sec, det } = q.body, g = gws(), c = g[id]; if (!c) throw bad('Unknown gateway'); c.on = on ? 1 : 0; if (id === 'bank') c.det = det || ''; else { c.pub = pub || ''; if (sec) c.sec = sec; } D.setCfg('gw', g); s.json({ ok: 1 }); }));
r.post('/admin/settings', ...A, w(async (q, s) => { if ('vag' in q.body) D.setCfg('vag', GW[q.body.vag] ? q.body.vag : ''); if (+q.body.rate > 0) D.setCfg('rate', +q.body.rate); s.json({ ok: 1 }); }));
r.post('/admin/provider', ...A, w(async (q, s) => { const { kind, id, enabled, priority, apikey } = q.body; if (!['num', 'util'].includes(kind)) throw bad('Bad kind');
  db.prepare('UPDATE providers SET enabled=?,priority=? WHERE kind=? AND id=?').run(enabled ? 1 : 0, +priority || 99, kind, id); if (apikey) db.prepare('UPDATE providers SET apikey=? WHERE kind=? AND id=?').run(apikey, kind, id); s.json({ ok: 1 }); }));
r.post('/admin/price', ...A, w(async (q, s) => { const p = D.cfg('prices', D.PRICES); if (!(q.body.svc in p) || !(+q.body.price > 0)) throw bad('Bad price'); p[q.body.svc] = Math.round(+q.body.price); D.setCfg('prices', p); s.json({ ok: 1 }); }));
r.post('/admin/plans', ...A, w(async (q, s) => { const L = q.body.plans; if (!Array.isArray(L)) throw bad('Bad plans');
  db.transaction(() => { db.prepare('DELETE FROM plans').run(); L.forEach(p => db.prepare('INSERT INTO plans VALUES(?,?,?,?,?)').run(String(p.id), p.n, p.l, Math.round(p.p), JSON.stringify(p.codes || {}))); })(); s.json({ ok: 1 }); }));
r.post('/admin/deposit', ...A, w(async (q, s) => { const t = db.prepare("SELECT * FROM txs WHERE ref=? AND status='pending'").get(q.body.id); if (!t) throw bad('Not found', 404);
  db.transaction(() => { db.prepare('UPDATE txs SET status=? WHERE id=?').run(q.body.ok ? 'ok' : 'rejected', t.id); if (q.body.ok) D.credit(t.uid, t.amount); })(); s.json({ ok: 1 }); }));
r.post('/admin/adjust', ...A, w(async (q, s) => { const u = db.prepare('SELECT * FROM users WHERE email=?').get(q.body.email), a = Math.round(+q.body.amount); if (!u || !a) throw bad('Bad request');
  db.transaction(() => { D.credit(u.id, a); D.addTx(u.id, 'adj', a, 'Admin adjustment'); })(); s.json({ ok: 1 }); }));

// ---- gateway webhooks (mounted with a raw body parser in index.js)
const webhook = w(async (q, s) => { const id = q.params.gw, g = GW[id], k = gws()[id] || {};
  if (!g || !k.sec) return s.sendStatus(404); if (!g.verify(q.body, q.headers, k.sec)) return s.sendStatus(401);
  const ev = g.parse(JSON.parse(q.body.toString()));
  if (ev) db.transaction(() => { const t = db.prepare('SELECT * FROM txs WHERE ref=?').get(ev.ref);
    if (t) { if (t.status !== 'pending') return; db.prepare("UPDATE txs SET status='ok' WHERE id=?").run(t.id); return D.credit(t.uid, t.amount); }
    const u = ev.uid ? user(ev.uid) : db.prepare('SELECT * FROM users WHERE email=?').get(String(ev.email || '').toLowerCase()); if (!u) return;
    const amt = Math.round(ev.amount); D.addTx(u.id, 'dep', amt, GN[id] + ' virtual account', 'ok', ev.ref); D.credit(u.id, amt); })();
  s.sendStatus(200); });
module.exports = { router: r, webhook };
