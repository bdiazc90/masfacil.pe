import crypto from 'node:crypto';

export const OFFICIAL_ANCHOR_SCHEME = 'gate-1.1-establishment-id-v1';

export function officialAnchorFromRegistration(registration) {
  const exactRegistration = String(registration ?? '').trim();
  if (!exactRegistration) throw new TypeError('El anchor requiere un REGISTRO oficial no vacío');
  const digest = crypto.createHash('sha256')
    .update(`facilito-ux-lab|gate-1.1|v1|establishment|${exactRegistration}`)
    .digest('hex')
    .slice(0, 24);
  return `est_${digest}`;
}
