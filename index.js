require('dotenv').config();
const express = require('express'), path = require('path'), bcrypt = require('bcryptjs');
const D = require('./db'), { db } = D, nums = require('./providers/numbers'), utils = require('./providers/utilities');
const { router, webhook } = require('./routes');

D.seedProviders('num', nums.list.map(p => p.id));
D.seedProviders('util', utils.list.map(p => p.id));
if (!db.prepare('SELECT COUNT(*) c FROM plans').get().c) [['m1', 'mtn', '1GB · 30 days', 600], ['m2', 'mtn', '2GB · 30 days', 1200], ['a1', 'airtel', '1.5GB · 30 days', 1000], ['g1', 'glo', '2.9GB · 30 days', 1000], ['e1', '9mobile', '1.5GB · 30 days', 900]]
  .forEach(p => db.prepare('INSERT INTO plans VALUES(?,?,?,?,?)').run(...p, '{}'));
if (!db.prepare('SELECT 1 FROM users WHERE admin=1').get()) {
  const e = (process.env.ADMIN_EMAIL || 'admin@tellysms.com').toLowerCase(), p = process.env.ADMIN_PASSWORD || 'ChangeMe123';
  db.prepare('INSERT OR IGNORE INTO users(email,name,pass,pin,admin,created) VALUES(?,?,?,?,1,?)').run(e, 'Admin', bcrypt.hashSync(p, 10), bcrypt.hashSync('1234', 10), Date.now());
  console.log(`Admin created: ${e} (PIN 1234). Change the password and PIN now.`);
}

const app = express();
app.post('/webhooks/:gw', express.raw({ type: '*/*' }), webhook);   // raw body needed for signatures
app.use(express.json());
app.use('/api', router);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((e, q, s, n) => { if (e.detail) console.warn(e.message, e.detail); s.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong.' }); });

// Poll providers for incoming codes; auto-release numbers that expire without an SMS.
setInterval(async () => {
  for (const a of db.prepare("SELECT * FROM acts WHERE status='waiting'").all()) {
    try {
      if (Date.now() > a.exp) { await nums.cancel(a.provider, a.ext).catch(() => {}); D.release(a, 'Expired, no SMS'); }
      else { const code = await nums.status(a.provider, a.ext); if (code) db.prepare("UPDATE acts SET status='done',code=? WHERE id=?").run(code, a.id); }
    } catch (e) { /* retry next tick */ }
  }
}, 5000);

app.listen(process.env.PORT || 3000, () => console.log('TellySMS running on port ' + (process.env.PORT || 3000)));
