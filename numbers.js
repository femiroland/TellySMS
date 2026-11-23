// 10 virtual-number providers. Each exposes buy(svc,country) / status(ext) / cancel(ext).
// Order and on/off are controlled in Admin > Providers; failover runs by priority.
const { http, json } = require('./http');
const C = require('./codes');
const { db } = require('../db');
const key = id => (db.prepare("SELECT apikey FROM providers WHERE kind='num' AND id=?").get(id) || {}).apikey || process.env['NUM_' + id.toUpperCase() + '_KEY'] || '';
const map = (t, s, c) => { const a = C[t].svc[s], b = C[t].ct[c]; if (a == null || b == null) throw new Error('no code mapping'); return [a, b]; };

// SMS-Activate-compatible API (one adapter, six providers)
const sa = (id, name, base) => {
  const q = (act, extra = '') => `${base}?api_key=${key(id)}&action=${act}${extra}`;
  return { id, name,
    async buy(s, c) { const [sv, ct] = map('sa', s, c); const r = await http(q('getNumber', `&service=${sv}&country=${ct}`)); const m = r.match(/^ACCESS_NUMBER:(\d+):(\d+)/); if (!m) throw new Error(r.slice(0, 80)); return { ext: m[1], number: m[2] }; },
    async status(x) { const m = (await http(q('getStatus', `&id=${x}`))).match(/^STATUS_OK:(.+)/); return m ? m[1] : null; },
    async cancel(x) { await http(q('setStatus', `&id=${x}&status=8`)); } };
};

const fivesim = (() => { const id = 'fivesim', B = 'https://5sim.net/v1', h = () => ({ headers: { Authorization: 'Bearer ' + key(id), Accept: 'application/json' } });
  return { id, name: '5sim',
    async buy(s, c) { const [sv, ct] = map('fs', s, c); const j = await json(`${B}/user/buy/activation/${ct}/any/${sv}`, h()); return { ext: String(j.id), number: String(j.phone).replace('+', '') }; },
    async status(x) { const j = await json(`${B}/user/check/${x}`, h()); return j.sms && j.sms[0] ? j.sms[0].code : null; },
    async cancel(x) { await http(`${B}/user/cancel/${x}`, h()); } }; })();

const smsman = (() => { const id = 'smsman', B = 'https://api.sms-man.com/control';
  return { id, name: 'SMS-Man',
    async buy(s, c) { const [a, k] = map('sm', s, c); const j = await json(`${B}/get-number?token=${key(id)}&country_id=${k}&application_id=${a}`); if (!j.request_id) throw new Error(JSON.stringify(j)); return { ext: String(j.request_id), number: String(j.number) }; },
    async status(x) { const j = await json(`${B}/get-sms?token=${key(id)}&request_id=${x}`); return j.sms_code || null; },
    async cancel(x) { await http(`${B}/set-status?token=${key(id)}&request_id=${x}&status=reject`); } }; })();

const onlinesim = (() => { const id = 'onlinesim', B = 'https://onlinesim.io/api';
  return { id, name: 'OnlineSim',
    async buy(s, c) { const [sv, ct] = map('os', s, c); const j = await json(`${B}/getNum.php?apikey=${key(id)}&service=${sv}&country=${ct}`); if (j.response != 1) throw new Error(JSON.stringify(j)); const st = await json(`${B}/getState.php?apikey=${key(id)}&tzid=${j.tzid}`); return { ext: String(j.tzid), number: String(st[0].number).replace('+', '') }; },
    async status(x) { const st = await json(`${B}/getState.php?apikey=${key(id)}&tzid=${x}&message_to_code=1`); return st[0] && st[0].msg ? String(st[0].msg) : null; },
    async cancel(x) { await http(`${B}/setOperationOk.php?apikey=${key(id)}&tzid=${x}`); } }; })();

const smspool = (() => { const id = 'smspool', B = 'https://api.smspool.net', post = (p, o) => json(B + p, { method: 'POST', body: new URLSearchParams({ key: key(id), ...o }) });
  return { id, name: 'SMSPool',
    async buy(s, c) { const [sv, ct] = map('sp', s, c); const j = await post('/purchase/sms', { country: ct, service: sv }); if (!j.order_id) throw new Error(JSON.stringify(j)); return { ext: String(j.order_id), number: String(j.number) }; },
    async status(x) { const j = await post('/sms/check', { orderid: x }); return j.sms && j.sms !== '0' ? String(j.sms) : null; },
    async cancel(x) { await post('/sms/cancel', { orderid: x }); } }; })();

const list = [
  sa('grizzlysms', 'GrizzlySMS', 'https://api.grizzlysms.com/stubs/handler_api.php'),
  sa('tigersms', 'TigerSMS', 'https://api.tiger-sms.com/stubs/handler_api.php'),
  sa('smshub', 'SMSHub', 'https://smshub.org/stubs/handler_api.php'),
  sa('smsbower', 'SMSBower', 'https://smsbower.online/stubs/handler_api.php'),
  sa('daisysms', 'DaisySMS', 'https://daisysms.com/stubs/handler_api.php'),
  sa('smsactivate', 'SMS-Activate', 'https://api.sms-activate.ae/stubs/handler_api.php'),
  fivesim, smsman, onlinesim, smspool,
];
const by = id => list.find(p => p.id === id);

async function buy(svc, country) {
  const errs = [];
  for (const { id } of db.prepare("SELECT id FROM providers WHERE kind='num' AND enabled=1 ORDER BY priority").all()) {
    const p = by(id); if (!p || !key(id)) continue;
    try { return { provider: id, ...(await p.buy(svc, country)) }; } catch (e) { errs.push(id + ': ' + e.message); }
  }
  const e = new Error('No numbers available right now. Try another country or service.'); e.status = 503; e.detail = errs; throw e;
}
module.exports = { list, buy, status: (id, x) => by(id).status(x), cancel: (id, x) => by(id).cancel(x) };
