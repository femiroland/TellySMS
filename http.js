// Tiny fetch helpers with a 15s timeout (Node 18+).
const http = async (url, o = {}) => {
  const r = await fetch(url, { ...o, signal: AbortSignal.timeout(15000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  return t;
};
const json = async (url, o) => JSON.parse(await http(url, o));
module.exports = { http, json };
