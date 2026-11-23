// Payment gateways that issue a dedicated virtual account number per user.
// Each: create(user,keys) -> {account_no,bank,name} | verify(rawBody,headers,secret) | parse(body) -> {ref,amount,email|uid}
const crypto = require('crypto');
const { json } = require('./http');
const hmac = (k, b) => crypto.createHmac('sha512', k).update(b).digest('hex');
const H = t => ({ Authorization: 'Bearer ' + t, 'content-type': 'application/json' });
const P = (url, body, t) => json(url, { method: 'POST', headers: H(t), body: JSON.stringify(body) });
const nm = u => { const [f, ...r] = u.name.split(' '); return { first: f, last: r.join(' ') || f }; };

exports.paystack = { name: 'Paystack',
  async create(u, k) { const { first, last } = nm(u);
    const c = await P('https://api.paystack.co/customer', { email: u.email, first_name: first, last_name: last }, k.sec);
    const d = await P('https://api.paystack.co/dedicated_account', { customer: c.data.customer_code, preferred_bank: 'wema-bank' }, k.sec);
    return { account_no: d.data.account_number, bank: d.data.bank.name, name: d.data.account_name }; },
  async checkout(u, amount, ref, k, cb) { const j = await P('https://api.paystack.co/transaction/initialize', { email: u.email, amount: amount * 100, reference: ref, callback_url: cb }, k.sec); return j.data.authorization_url; },
  verify: (raw, h, sec) => hmac(sec, raw) === h['x-paystack-signature'],
  parse: b => b.event === 'charge.success' ? { ref: b.data.reference, amount: b.data.amount / 100, email: b.data.customer && b.data.customer.email } : null };

exports.flutterwave = { name: 'Flutterwave',
  async create(u, k) { const { first, last } = nm(u);
    const j = await P('https://api.flutterwave.com/v3/virtual-account-numbers', { email: u.email, is_permanent: true, bvn: process.env.FLW_BVN, tx_ref: 'TSVA' + u.id, firstname: first, lastname: last, narration: 'TellySMS ' + u.name }, k.sec);
    return { account_no: j.data.account_number, bank: j.data.bank_name, name: u.name }; },
  // In the Flutterwave dashboard set the webhook "secret hash" to the same value as your secret key
  verify: (raw, h, sec) => h['verif-hash'] === sec,
  parse: b => b.event === 'charge.completed' && b.data.status === 'successful' ? { ref: 'FLW' + b.data.id, amount: b.data.amount, email: b.data.customer && b.data.customer.email } : null };

// Monnify: store keys as pub = "apiKey|contractCode", sec = secretKey
const mtoken = async k => (await json('https://api.monnify.com/api/v1/auth/login', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(k.pub.split('|')[0] + ':' + k.sec).toString('base64') } })).responseBody.accessToken;
exports.monnify = { name: 'Monnify',
  async create(u, k) { const t = await mtoken(k);
    const j = await P('https://api.monnify.com/api/v2/bank-transfer/reserved-accounts', { accountReference: 'TS' + u.id, accountName: u.name, currencyCode: 'NGN', contractCode: k.pub.split('|')[1], customerEmail: u.email, customerName: u.name, getAllAvailableBanks: false, preferredBanks: ['035'] }, t);
    const a = j.responseBody.accounts[0]; return { account_no: a.accountNumber, bank: a.bankName, name: a.accountName }; },
  verify: (raw, h, sec) => hmac(sec, raw) === h['monnify-signature'],
  parse: b => { const e = b.eventData || {}; return b.eventType === 'SUCCESSFUL_TRANSACTION' && e.paymentStatus === 'PAID' ? { ref: e.transactionReference, amount: e.amountPaid, uid: +String((e.product || {}).reference || '').replace(/^TS/, '') || undefined, email: (e.customer || {}).email } : null; } };
