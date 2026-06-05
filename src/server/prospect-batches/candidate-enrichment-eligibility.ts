export interface EnrichmentEligibilityResult {
  needs_enrichment: boolean;
  completeness_score: number;
  missing_fields: string[];
  reasons: string[];
  blocking_reason?: string;
}

const DIRECTORY_DOMAINS = new Set([
  'registronit.com',
  'informacolombia.com',
  'datacreditoempresas.com.co',
  'einforma.co',
  'empresite.eleconomistaamerica.co',
  'empresite.com',
  'paginasamarillas.com.co',
  'procolombia.co',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'google.com',
  'gmail.com',
  'youtube.com',
  'wikipedia.org',
]);

const DIRECTORY_KEYWORDS = [
  'paginasamarillas',
  'paginas-amarillas',
  'kompass',
  'opencorporates',
  'zoominfo',
  'clutch.co',
  'crunchbase',
  'emis.com',
  'empresite',
  'registronit',
  'informacolombia',
  'datacreditoempresas',
  'einforma',
  'datospymes',
  'directorioempresas',
  'buscaempresas',
  'rues.gov',
  'rues.org',
  'colombiacompra',
  'secop',
  'procolombia',
  'b2bmarketplace',
];

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const { hostname } = new URL(normalized);
    return hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function isDirectoryOrSocialUrl(url: string | null | undefined): boolean {
  const domain = extractDomain(url);
  if (!domain) return false;
  if (DIRECTORY_DOMAINS.has(domain)) return true;
  if (DIRECTORY_KEYWORDS.some((k) => domain.includes(k))) return true;
  if (/\.gov\.co$/.test(domain) || domain === 'gov.co') return true;
  if (/\.gov\.cl$/.test(domain) || domain === 'gov.cl') return true;
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function evaluateCandidateEnrichmentNeed(candidate: any): EnrichmentEligibilityResult {
  const metadata = candidate.metadata || {};
  const enrichment = metadata.enrichment || {};

  // Rule: If already enriched successfully, no enrichment is needed
  if (enrichment.status === 'completed') {
    return {
      needs_enrichment: false,
      completeness_score: 100,
      missing_fields: [],
      reasons: ['Enriquecimiento completado anteriormente.'],
    };
  }

  // Rule: Block enrichment if the candidate is already approved, discarded, or converted
  const blockedStatuses = ['approved', 'discarded', 'converted_to_account'];
  if (blockedStatuses.includes(candidate.status)) {
    return {
      needs_enrichment: false,
      completeness_score: 80, // arbitrary
      missing_fields: [],
      reasons: [],
      blocking_reason: `El candidato ya está en estado final: ${candidate.status}`,
    };
  }

  let completeness_score = 0;
  const missing_fields: string[] = [];
  const reasons: string[] = [];

  // 1. Name
  if (candidate.name && candidate.name.trim().length > 0) {
    completeness_score += 10;
  } else {
    missing_fields.push('name');
    reasons.push('Falta el nombre del candidato');
  }

  // 2. Country
  const hasCountry = candidate.country_code || candidate.country || metadata.validation?.normalized_keys?.country_code;
  if (hasCountry) {
    completeness_score += 10;
  } else {
    missing_fields.push('country');
    reasons.push('Falta el país de la empresa');
  }

  // 3. Industry
  const hasIndustry = candidate.industry && 
                      candidate.industry.trim().length > 0 && 
                      !['Otro', 'No especificado', 'unknown', 'sector_unknown'].includes(candidate.industry);
  if (hasIndustry) {
    completeness_score += 10;
  } else {
    missing_fields.push('industry');
    reasons.push('Falta el sector o industria');
  }

  // 4. Website / Domain
  const hasWebsite = (candidate.website || candidate.domain) && !isDirectoryOrSocialUrl(candidate.website || candidate.domain);
  if (hasWebsite) {
    completeness_score += 15;
  } else {
    missing_fields.push('website');
    reasons.push('Falta el sitio web corporativo o dominio propio');
  }

  // 5. LinkedIn Url
  const hasLinkedin = metadata.import?.linkedin_url || 
                      metadata.validation?.normalized_keys?.normalized_linkedin_url ||
                      (candidate.website && candidate.website.includes('linkedin.com/company/'));
  if (hasLinkedin) {
    completeness_score += 15;
  } else {
    missing_fields.push('linkedin_url');
    reasons.push('Falta el LinkedIn corporativo de la empresa');
  }

  // 6. City / Region
  const hasCityOrRegion = candidate.city || candidate.region;
  if (hasCityOrRegion) {
    completeness_score += 10;
  } else {
    missing_fields.push('city');
    reasons.push('Falta la ciudad o región');
  }

  // 7. Company Size
  const hasCompanySize = candidate.company_size && 
                         candidate.company_size.trim().length > 0 && 
                         !['unknown', 'size_unknown'].includes(candidate.company_size.toLowerCase());
  if (hasCompanySize) {
    completeness_score += 10;
  } else {
    missing_fields.push('company_size');
    reasons.push('Falta el tamaño estimado de empleados');
  }

  // 8. Description
  // Actually, let's look at the database candidate row itself for description.
  // Wait, does candidate have a description column? No, we saw in types.ts that description is in metadata/enrichment or as review_notes.
  // Let's check metadata?.ai_evaluation?.description or metadata?.enrichment?.summary.
  const anyDesc = candidate.metadata?.enrichment?.company_profile?.business_description ||
                  candidate.metadata?.enrichment?.summary ||
                  candidate.metadata?.ai_evaluation?.description;
  if (anyDesc && anyDesc.trim().length > 0) {
    completeness_score += 10;
  } else {
    missing_fields.push('description');
    reasons.push('Falta la descripción comercial o qué hace la empresa');
  }

  // 9. Source evidence URL / primary source
  const hasSourceEvidence = metadata.import?.source_url || 
                            metadata.import?.source_evidence || 
                            candidate.source_primary;
  if (hasSourceEvidence) {
    completeness_score += 10;
  } else {
    missing_fields.push('source_evidence');
    reasons.push('Falta la evidencia o fuente principal de importación');
  }

  // Override logic for needs_enrichment
  let needs_enrichment = completeness_score < 80;

  // Additional conditions that make enrichment needed (even if score >= 80)
  
  // A. Low or medium confidence
  const confScore = candidate.confidence_score;
  const importConf = metadata.import?.confidence || metadata.validation?.quality_check?.import_confidence;
  const isLowConfidence = (typeof confScore === 'number' && confScore < 70) || 
                          ['baja', 'media', 'low', 'medium'].includes(String(importConf).toLowerCase());
  if (isLowConfidence) {
    needs_enrichment = true;
    reasons.push('Confianza de importación media o baja.');
  }

  // B. Notes or warnings of uncertainty
  const notesText = (candidate.review_notes || '').toLowerCase();
  const warningsList = metadata.validation?.quality_check?.warnings || [];
  const hasUncertainty = notesText.includes('incertidumbre') || 
                         notesText.includes('duda') || 
                         notesText.includes('rebrand') || 
                         notesText.includes('adquirida') || 
                         notesText.includes('acquired') ||
                         warningsList.some((w: string) => w.toLowerCase().includes('incert') || w.toLowerCase().includes('duda'));
  if (hasUncertainty) {
    needs_enrichment = true;
    reasons.push('Se detectó incertidumbre o señales de rebrand en las notas/advertencias.');
  }

  // C. Possible match in CRM checks
  const dupCheck = metadata.validation?.sellup_duplicate_check;
  const hsCheck = metadata.validation?.hubspot_duplicate_check;
  const isPossibleMatch = dupCheck?.status === 'possible_duplicate' || 
                          hsCheck?.status === 'possible_match';
  if (isPossibleMatch) {
    needs_enrichment = true;
    reasons.push('Posible duplicado en SellUp o CRM que requiere validar identidad.');
  }

  // D. Contradictory data
  const hasContradictions = (dupCheck?.status === 'possible_duplicate' && dupCheck?.matched_country_code !== candidate.country_code) ||
                            (hsCheck?.status === 'possible_match' && hsCheck?.matched_country !== candidate.country);
  if (hasContradictions) {
    needs_enrichment = true;
    reasons.push('Hay datos contradictorios entre el candidato importado y los registros del CRM.');
  }

  // E. HubSpot match with missing metadata
  const hsMatchId = candidate.matched_hubspot_company_id || hsCheck?.matched_company_id;
  if (hsMatchId) {
    const hasHsMetadata = hsCheck?.matched_lifecycle_stage || hsCheck?.matched_macro_industry || hsCheck?.matched_description;
    if (!hasHsMetadata) {
      needs_enrichment = true;
      reasons.push('Existe match en HubSpot pero no tiene cargada la metadata enriquecida.');
    }
  }

  // F. Missing fields in validation check
  const validationMissingFields = metadata.validation?.quality_check?.missing_fields || [];
  const relevantMissing = validationMissingFields.filter((f: string) => ['website', 'linkedin', 'sector', 'description'].includes(f));
  if (relevantMissing.length > 0) {
    needs_enrichment = true;
    reasons.push(`Faltan campos relevantes detectados por validación: ${relevantMissing.join(', ')}`);
  }

  return {
    needs_enrichment,
    completeness_score,
    missing_fields,
    reasons,
  };
}

export function isCandidateIncomplete(candidate: Record<string, unknown>): boolean {
  const metadata = (candidate.metadata as Record<string, unknown>) || {};
  const enrichment = (metadata.enrichment as Record<string, unknown>) || {};
  const validation = (metadata.validation as Record<string, unknown>) || {};

  const hasWebsite = !!(candidate.website || candidate.domain) && !isDirectoryOrSocialUrl((candidate.website || candidate.domain) as string);
  
  const hasLinkedin = !!(
    (metadata.import as Record<string, unknown>)?.linkedin_url ||
    metadata.linkedin_url ||
    (validation.normalized_keys as Record<string, unknown>)?.normalized_linkedin_url ||
    (candidate.website && (candidate.website as string).includes('linkedin.com/company/'))
  );

  const hasDescription = !!(
    (enrichment.company_profile as Record<string, unknown>)?.business_description ||
    enrichment.summary ||
    (metadata.ai_evaluation as Record<string, unknown>)?.description ||
    candidate.review_notes
  );

  const hasCityOrRegion = !!(candidate.city || candidate.region);
  
  const hasCompanySize = !!(
    candidate.company_size &&
    !['unknown', 'size_unknown'].includes((candidate.company_size as string).toLowerCase())
  );

  const hasIndustry = !!(
    candidate.industry &&
    !['Otro', 'No especificado', 'unknown', 'sector_unknown'].includes(candidate.industry as string)
  );

  const hasSourceEvidence = !!(
    (metadata.import as Record<string, unknown>)?.source_url ||
    (metadata.import as Record<string, unknown>)?.source_evidence ||
    candidate.source_primary
  );

  const hasConfidence = !!(
    (metadata.import as Record<string, unknown>)?.confidence ||
    (validation.quality_check as Record<string, unknown>)?.import_confidence ||
    candidate.confidence_score
  );

  return !(
    hasWebsite &&
    hasLinkedin &&
    hasDescription &&
    hasCityOrRegion &&
    hasCompanySize &&
    hasIndustry &&
    hasSourceEvidence &&
    hasConfidence
  );
}

export function evaluateAutoEnrichmentEligibility(candidate: Record<string, unknown>): {
  eligible: boolean;
  status: 'pending' | 'skipped_duplicate' | 'skipped_already_complete' | 'no_required';
  reason?: string;
} {
  const status = candidate.status as string;
  const duplicate_status = candidate.duplicate_status as string;
  const metadata = (candidate.metadata as Record<string, unknown>) || {};
  const enrichment = (metadata.enrichment as Record<string, unknown>) || {};
  const flags = (candidate.review_flags as string[]) || [];

  // Exclude final statuses
  const blockedStatuses = ['approved', 'discarded', 'converted_to_account', 'duplicate'];
  if (blockedStatuses.includes(status)) {
    return { eligible: false, status: 'no_required', reason: 'Candidato en estado final.' };
  }

  // Exclude exact duplicates or duplicate status
  if (duplicate_status === 'exact_duplicate' || status === 'duplicate') {
    return { eligible: false, status: 'skipped_duplicate', reason: 'Duplicado exacto.' };
  }
  
  // Exclude possible duplicates or ambiguous match
  if (duplicate_status === 'possible_duplicate') {
    return { eligible: false, status: 'skipped_duplicate', reason: 'Posible duplicado o coincidencia ambigua.' };
  }

  // Exclude confirmed matches in SellUp or HubSpot
  if (candidate.matched_account_id || candidate.matched_hubspot_company_id) {
    return { eligible: false, status: 'skipped_duplicate', reason: 'Coincidencia confirmada en SellUp o CRM.' };
  }

  // Blocked by validation
  if (flags.includes('liquidation_signal') || flags.includes('inactive_company')) {
    return { eligible: false, status: 'no_required', reason: 'Bloqueado por validación (inactiva / liquidación).' };
  }

  // Already enriched or enriching
  if (enrichment.status === 'completed' || enrichment.status === 'completed_partially') {
    return { eligible: false, status: 'no_required', reason: 'Ya enriquecido.' };
  }
  if (enrichment.status === 'enriching') {
    return { eligible: false, status: 'no_required', reason: 'Enriquecimiento en curso.' };
  }

  // Check if it is incomplete
  if (!isCandidateIncomplete(candidate)) {
    return { eligible: false, status: 'skipped_already_complete', reason: 'El candidato ya cuenta con información suficiente.' };
  }

  return { eligible: true, status: 'pending' };
}

