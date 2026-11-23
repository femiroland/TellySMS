// 10 airtime/data providers. pay(order) throws on failure; buy() fails over by priority.
// order = { kind:'airtime'|'data', network, phone, amount, plan(provider code), ref }
const { json } = require('./http');
const { db } = require('../db');
const key = id => (db.prepare("SELECT apikey FROM providers WHERE kind='util' AND id=?").get(id) || {}).apikey || process.env['UTIL_' + id.toUpperCase() + '_KEY'] || '';
const NET = { mtn: { v: 'mtn', c: '01', s: 1 }, airtel: { v: 'airtel', c: '04', s: 4 }, glo: { v: 'glo', c: '02', s: 2 }, '9mobile': { v: 'etisalat', c: '03', s: 3 } };
const post = (url, body, headers) => json(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

// "Django VTU script" API shared by many Nigerian resellers (Token auth, /topup/ and /data/)
const script = (id, name, base) => ({ id, name, async pay(o) {
  const n = NET[o.network], d = o.kind === 'data';
  const j = await post(`${base}/${d ? 'data' : 'topup'}/`, d ? { network: n.s, mobile_number: o.phone, plan: o.plan, Ported_number: true } : { network: n.s, amount: o.amount, mobile_number: o.phone, Ported_number: true, airtime_type: 'VTU' }, { Authorization: 'Token ' + key(id) });
  if (!/success|processing/i.test(String(j.Status || j.status || ''))) throw new Error(j.api_response || j.error || 'failed');
} });

const list = [
  { id: 'vtpass', name: 'VTpass', async pay(o) { const [k, s] = key('vtpass').split(':'), n = NET[o.network], d = o.kind === 'data';
    const j = await post('https://vtpass.com/api/pay', { request_id: o.ref, serviceID: d ? n.v + '-data' : n.v, amount: o.amount, phone: o.phone, ...(d ? { variation_code: o.plan, billersCode: o.phone } : {}) }, { 'api-key': k, 'secret-key': s });
    if (j.code !== '000') throw new Error(j.response_description || 'failed'); } },
  { id: 'flutterwave', name: 'Flutterwave Bills', async pay(o) { if (o.kind === 'data' && !o.plan) throw new Error('no plan');
    const j = await post('https://api.flutterwave.com/v3/bills', { country: 'NG', customer: o.phone, amount: o.amount, recurrence: 'ONCE', type: o.kind === 'data' ? o.plan : 'AIRTIME', reference: o.ref }, { Authorization: 'Bearer ' + key('flutterwave') });
    if (j.status !== 'success') throw new Error(j.message || 'failed'); } },
  { id: 'clubkonnect', name: 'Clubkonnect', async pay(o) { const [u, k] = key('clubkonnect').split(':'), n = NET[o.network], d = o.kind === 'data';
    const j = await json(`https://www.nellobytes.com/${d ? 'APIDatabundleV1' : 'APIAirtimeV1'}.asp?UserID=${u}&APIKey=${k}&MobileNetwork=${n.c}&${d ? 'DataPlan=' + o.plan : 'Amount=' + o.amount}&MobileNumber=${o.phone}&RequestID=${o.ref}`);
    if (!/ORDER_RECEIVED|ORDER_COMPLETED/.test(j.status || '')) throw new Error(j.status || 'failed'); } },
  { id: 'vtung', name: 'VTU.ng', async pay(o) { const [u, p] = key('vtung').split(':'), d = o.kind === 'data';
    const j = await json(`https://vtu.ng/wp-json/api/v1/${d ? 'data' : 'airtime'}?username=${u}&password=${p}&phone=${o.phone}&network_id=${o.network}&${d ? 'variation_id=' + o.plan : 'amount=' + o.amount}`);
    if (j.code !== 'success') throw new Error(j.message || 'failed'); } },
  script('gladtidings', 'Gladtidings', 'https://www.gladtidingsdata.com/api'),
  script('bilalsadasub', 'Bilalsadasub', 'https://bilalsadasub.com/api'),
  script('maskawa', 'Maskawa', 'https://maskawasub.com/api'),
  script('datastation', 'Datastation', 'https://datastationapi.com/api'),
  script('subandgain', 'Subandgain', 'https://subandgain.com/api'),
  script('alrahuz', 'Alrahuz Data', 'https://alrahuzdata.com.ng/api'),
];

async function buy(o) {
  const codes = o.kind === 'data' ? JSON.parse((db.prepare('SELECT codes FROM plans WHERE id=?').get(o.plan) || { codes: '{}' }).codes) : {};
  const errs = [];
  for (const { id } of db.prepare("SELECT id FROM providers WHERE kind='util' AND enabled=1 ORDER BY priority").all()) {
    const p = list.find(x => x.id === id); if (!p || !key(id)) continue;
    if (o.kind === 'data' && !codes[id]) continue;
    try { await p.pay({ ...o, plan: codes[id] }); return id; } catch (e) { errs.push(id + ': ' + e.message); }
  }
  const e = new Error('Service unavailable right now. You have not been charged.'); e.status = 503; e.detail = errs; throw e;
}
module.exports = { list, buy };
