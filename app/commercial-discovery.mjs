export function evaluateNormalizedAddressDiscovery(candidate) {
  if (!candidate?.normalized_address_exact) {
    return Object.freeze({ accepted: false, reason: candidate?.coordinate_match ? 'coordinate_only_not_allowed' : 'normalized_address_not_exact' });
  }
  if (!Number.isInteger(candidate.normalized_address_candidate_count) || candidate.normalized_address_candidate_count !== 1) {
    return Object.freeze({ accepted: false, reason: 'normalized_address_ambiguous' });
  }
  if (candidate.legal_entity_consistent !== true) {
    return Object.freeze({ accepted: false, reason: 'legal_entity_mismatch' });
  }
  return Object.freeze({ accepted: true, reason: 'normalized_address_exact_unique' });
}
