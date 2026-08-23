import fs from 'node:fs';
import { isPublicCommercialEntry } from './commercial-catalog.mjs';
import crypto from 'node:crypto';

export const AUDIT_SCHEMA_VERSION = '1.0.0';

const top = ['schema_version', 'audit_id', 'catalog_id', 'entries']; const entry = ['establishment_id', 'entry_sha256', 'selection_reason', 'reviewer', 'reviewed_at', 'result'];
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const text = (value) => typeof value === 'string' && value.trim().length > 0; const iso = (value) => text(value) && Number.isFinite(Date.parse(value));
export function canonicalizeCommercialEntry(value) { if (Array.isArray(value)) return value.map(canonicalizeCommercialEntry); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeCommercialEntry(value[key])])); return value; }
export function commercialEntrySha256(value) { return crypto.createHash('sha256').update(JSON.stringify(canonicalizeCommercialEntry(value))).digest('hex'); }
export function validateCommercialAudit(audit) {
  const errors = [];
  if (!exact(audit, top)) errors.push('audit: campos inesperados o ausentes');
  if (audit?.schema_version !== AUDIT_SCHEMA_VERSION) errors.push('audit.schema_version: fuera del contrato');
  if (!/^commercial-identity-audit-[a-z0-9.-]+$/.test(audit?.audit_id ?? '')) errors.push('audit.audit_id: formato inválido');
  if (!/^commercial-identity-catalog-[a-z0-9.-]+$/.test(audit?.catalog_id ?? '')) errors.push('audit.catalog_id: formato inválido');
  if (!Array.isArray(audit?.entries)) { errors.push('audit.entries: debe ser arreglo'); return errors; }
  const seen = new Set();
  for (const [index, value] of audit.entries.entries()) { const at = `audit.entries[${index}]`;
    if (!exact(value, entry)) { errors.push(`${at}: campos inesperados o ausentes`); continue; }
    if (!/^est_[a-f0-9]{24}$/.test(value.establishment_id ?? '')) errors.push(`${at}.establishment_id: formato inválido`);
    if (!/^[a-f0-9]{64}$/.test(value.entry_sha256 ?? '')) errors.push(`${at}.entry_sha256: hash inválido`);
    if (seen.has(value.establishment_id)) errors.push(`${at}.establishment_id: duplicado`); seen.add(value.establishment_id);
    if (!['publishable_candidate', 'random_sample', 'risk_sample'].includes(value.selection_reason)) errors.push(`${at}.selection_reason: fuera del catálogo`);
    if (!text(value.reviewer) || !iso(value.reviewed_at) || !['verified', 'incorrect', 'pending'].includes(value.result)) errors.push(`${at}: reviewer, fecha o resultado inválido`);
  } return [...new Set(errors)];
}
export function loadValidatedCommercialAudit(path) { const audit = JSON.parse(fs.readFileSync(path, 'utf8')); const errors = validateCommercialAudit(audit); if (errors.length) throw new Error(`Auditoría comercial fuera de contrato:\n- ${errors.join('\n- ')}`); return audit; }
export function commercialPublicationCheck(catalog, audit) {
  const targets = catalog.entries.filter(isPublicCommercialEntry);
  const summary = { required: targets.length, selected: 0, reviewed: 0, incorrect_links: null };
  if (!targets.length) return Object.freeze({ status: 'not_required', reason: 'catalog_empty_or_pending', ...summary });
  if (!audit || audit.catalog_id !== catalog.catalog_id) return Object.freeze({ status: 'pending', reason: 'audit_missing_or_catalog_mismatch', ...summary });
  const byAnchor = new Map(audit.entries.map((row) => [row.establishment_id, row]));
  const rows = targets.map((target) => ({ target, row: byAnchor.get(target.establishment_id) })).filter(({ row }) => row);
  const fresh = rows.filter(({ target, row }) => commercialEntrySha256(target) === row.entry_sha256);
  const reviewed = fresh.filter(({ row }) => row.result !== 'pending');
  const incorrect = fresh.filter(({ row }) => row.result === 'incorrect');
  const current = fresh.filter(({ row }) => row.result === 'verified');
  const base = { ...summary, selected: rows.length, reviewed: reviewed.length, incorrect_links: incorrect.length };
  if (rows.length !== targets.length) return Object.freeze({ status: 'pending', reason: 'audit_missing_entry', ...base });
  if (fresh.length !== targets.length) return Object.freeze({ status: 'pending', reason: 'audit_stale', ...base });
  if (incorrect.length) return Object.freeze({ status: 'pending', reason: 'audit_incorrect', ...base });
  if (current.length !== targets.length) return Object.freeze({ status: 'pending', reason: 'audit_pending', ...base });
  return Object.freeze({ status: 'ready', reason: 'all_publishable_entries_verified', ...base });
}

export function assertCommercialPublicationReady(catalog, audit) {
  const check = commercialPublicationCheck(catalog, audit);
  if (check.status === 'ready' || check.status === 'not_required') return check;
  throw new Error(`Auditoría comercial impide proyectar (${check.reason})`);
}

export function auditCommercialCatalog(catalog, audit) { return commercialPublicationCheck(catalog, audit); }
