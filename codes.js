// Our service ids -> each provider family's codes. EDIT HERE to add services/countries.
// A missing code means that provider is skipped for that request (failover moves on).
const SVC = { wa: 'whatsapp', tg: 'telegram', go: 'google', fb: 'facebook', ig: 'instagram', x: 'twitter', tt: 'tiktok', ms: 'microsoft', am: 'amazon', dc: 'discord', ub: 'uber', pp: 'paypal' };
module.exports = {
  // SMS-Activate protocol family (numeric country ids)
  sa: { svc: { wa: 'wa', tg: 'tg', go: 'go', fb: 'fb', ig: 'ig', x: 'tw', tt: 'lf', ms: 'mm', am: 'am', dc: 'ds', ub: 'ub', pp: 'ts' },
        ct: { ng: 19, us: 12, gb: 16, ca: 36, de: 43, fr: 78, in: 22, za: 31 } },
  // 5sim (names)
  fs: { svc: SVC, ct: { ng: 'nigeria', us: 'usa', gb: 'england', ca: 'canada', de: 'germany', fr: 'france', in: 'india', za: 'southafrica' } },
  // OnlineSim (service names, numeric dial-code country ids)
  os: { svc: SVC, ct: { us: 1, gb: 44, ng: 234, de: 49, fr: 33, in: 91, za: 27 } },
  // SMS-Man and SMSPool use their own numeric ids: fill from their country/service list endpoints
  sm: { svc: {}, ct: {} },
  sp: { svc: {}, ct: {} },
};
