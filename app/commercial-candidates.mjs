import { officialAnchorFromRegistration } from './official-anchor.mjs';

const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const iso = (value) => text(value) && Number.isFinite(Date.parse(value));
const discovery = (value) => exact(value, ['address', 'coordinates', 'name', 'internal_code'])
  && [value.address, value.name, value.internal_code].every((item) => item === null || text(item))
  && (value.coordinates === null || (exact(value.coordinates, ['latitude', 'longitude']) && Number.isFinite(value.coordinates.latitude) && Number.isFinite(value.coordinates.longitude)));
const commercialIdentity = (value) => value === null || (exact(value, ['brand', 'public_site_name'])
  && [value.brand, value.public_site_name].every((item) => item === null || text(item))
  && (value.brand !== null || value.public_site_name !== null));
const observation = (value) => exact(value, ['commercial_identity_claim', 'legal_entity_claim', 'source_locator', 'method', 'observed_at', 'responsible', 'discovery'])
  && commercialIdentity(value.commercial_identity_claim) && (value.legal_entity_claim === null || text(value.legal_entity_claim))
  && (value.commercial_identity_claim !== null || value.legal_entity_claim !== null)
  && text(value.source_locator) && text(value.method) && iso(value.observed_at) && text(value.responsible) && discovery(value.discovery);
export function validateCommercialCandidates(batch) {
  const errors = []; if (!exact(batch, ['schema_version', 'batch_id', 'entries']) || batch?.schema_version !== '1.0.0' || !/^commercial-identity-candidates-[a-z0-9.-]+$/.test(batch?.batch_id ?? '') || !Array.isArray(batch?.entries)) return ['batch fuera del contrato'];
  const seen = new Set(); const verifiedRegistrations = new Set(); const verifiedAnchors = new Set();
  for (const [index, item] of batch.entries.entries()) { const at = `entries[${index}]`; if (!exact(item, ['candidate_id', 'status', 'observation', 'official_link', 'reviewer'])) { errors.push(`${at}: campos inesperados`); continue; }
    if (!/^candidate_[a-z0-9-]+$/.test(item.candidate_id) || seen.has(item.candidate_id)) errors.push(`${at}: candidate_id inválido o duplicado`); seen.add(item.candidate_id);
    if (!['unmatched', 'candidate', 'conflict', 'verified'].includes(item.status) || !observation(item.observation) || !text(item.reviewer) || !exact(item.official_link, ['registration_code', 'establishment_id', 'commercial_identity_evidence', 'reviewed_at'])) { errors.push(`${at}: estado, observación, reviewer o forma inválida`); continue; }
    const { registration_code: registration, establishment_id: anchor, commercial_identity_evidence: commercialEvidence, reviewed_at: reviewedAt } = item.official_link;
    const hasOfficialAnchor = text(registration) && /^est_[a-f0-9]{24}$/.test(anchor ?? '');
    if ((registration === null) !== (anchor === null) || (registration !== null && !hasOfficialAnchor)) { errors.push(`${at}: Registro y establishment_id deben aparecer juntos y ser exactos`); continue; }
    if (registration !== null && anchor !== officialAnchorFromRegistration(registration)) errors.push(`${at}: establishment_id debe derivarse exactamente del Registro oficial`);
    if (item.status === 'unmatched' && registration !== null) errors.push(`${at}: unmatched no conserva vínculo oficial`);
    if ((commercialEvidence === null) !== (reviewedAt === null) || (commercialEvidence !== null && (!text(commercialEvidence) || !iso(reviewedAt)))) errors.push(`${at}: evidencia comercial y revisión deben ser coherentes`);
    const exactCommercialLink = hasOfficialAnchor && text(commercialEvidence) && iso(reviewedAt) && item.observation.commercial_identity_claim !== null;
    if (item.status === 'verified' && !exactCommercialLink) { errors.push(`${at}: verified exige identidad comercial, anchor, evidencia comercial específica y revisión`); continue; }
    if (item.status === 'verified') {
      if (verifiedRegistrations.has(registration)) errors.push(`${at}: Registro oficial verificado duplicado`); verifiedRegistrations.add(registration);
      if (verifiedAnchors.has(anchor)) errors.push(`${at}: establishment_id verificado duplicado`); verifiedAnchors.add(anchor);
    }
  } return errors;
}
export function reconcileCommercialCandidates(batch) { const errors = validateCommercialCandidates(batch); if (errors.length) throw new Error(`Candidatos comerciales inválidos: ${errors.join('; ')}`); return Object.freeze({ verified: batch.entries.filter((entry) => entry.status === 'verified').map((entry) => ({ establishment_id: entry.official_link.establishment_id, candidate_id: entry.candidate_id })), pending: batch.entries.filter((entry) => entry.status !== 'verified').length }); }
