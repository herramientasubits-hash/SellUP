/**
 * Benchmark — Candidate Validator (Hito 16AB.23.1)
 *
 * Orquesta las fases de verificación por candidato:
 *   1. Clasificación de entidad (entity-verifier)
 *   2. Resolución de identidad si es necesario (identity-resolver)
 *   3. Validación de LinkedIn (linkedin-validator)
 *   4. Normalización de sitio oficial
 *   5. Validación de campos obligatorios de selección final
 *
 * Produce listas separadas de candidatos verificados y rechazados.
 * Sin llamadas externas. Determinístico.
 */

import { classifyEntity, isRedditUrl } from './entity-verifier';
import { resolveIdentity, normalizeToRootUrl, extractHostname } from './identity-resolver';
import { validateLinkedIn } from './linkedin-validator';
import { normalizeCompanyName, mergeNotes } from './name-normalizer';
import type {
  BenchmarkCandidate,
  CandidatePhaseResult,
  EntityType,
  LinkedInStatus,
  RejectedCandidate,
  VerifiedBenchmarkCandidate,
} from './types';

// ─── Códigos de rechazo ───────────────────────────────────────────────────────

export const REJECTION_CODES = {
  NOT_COMPANY: 'NOT_COMPANY',
  UNRESOLVABLE_IDENTITY: 'UNRESOLVABLE_IDENTITY',
  NO_OFFICIAL_SITE: 'NO_OFFICIAL_SITE',
  REDDIT_URL: 'REDDIT_URL',
  DIRECTORY_URL: 'DIRECTORY_URL',
  NON_COMPANY_ENTITY: 'NON_COMPANY_ENTITY',
  ARTICLE_AS_COMPANY: 'ARTICLE_AS_COMPANY',
  ALT_TEXT_NAME: 'ALT_TEXT_NAME',
  FORUM_POST: 'FORUM_POST',
  ASSOCIATION: 'ASSOCIATION',
  INVALID_FINAL_ROW: 'INVALID_FINAL_ROW',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  EXTERNAL_DUPLICATE: 'EXTERNAL_DUPLICATE',
} as const;

// ─── Tipos que nunca pueden ser prospectos ────────────────────────────────────

const AUTO_REJECT_TYPES = new Set<EntityType>([
  'forum_post',
  'social_post',
  'event',
  'government_entity',
]);

const CONTENT_TYPES = new Set<EntityType>([
  'article',
  'blog_post',
]);

// ─── Hosts que nunca son sitios corporativos oficiales ────────────────────────

const NON_CORPORATE_HOSTS = new Set([
  'google.com', 'google.com.co',
  'bing.com',
  'wikipedia.org', 'es.wikipedia.org',
  'linkedin.com', 'www.linkedin.com',
  'twitter.com', 'x.com',
  'facebook.com', 'www.facebook.com',
  'instagram.com', 'www.instagram.com',
  'youtube.com', 'www.youtube.com',
  'reddit.com', 'www.reddit.com',
  'latamfintech.co', 'www.latamfintech.co',
  'colombiafintech.co', 'www.colombiafintech.co',
]);

// ─── Campos obligatorios para selección final ─────────────────────────────────

function hasTooManyMissingCriticalFields(c: BenchmarkCandidate): boolean {
  const missing = [
    !c.linkedin,
    !c.city,
    !c.estimated_size,
    !c.description,
  ].filter(Boolean).length;
  // Reject if all four critical enrichment fields are missing
  return missing >= 4;
}

// ─── Pipeline de validación ───────────────────────────────────────────────────

function validateSingleCandidate(
  raw: BenchmarkCandidate,
): { verified: VerifiedBenchmarkCandidate | null; rejected: RejectedCandidate | null } {
  const name = raw.name ?? '';
  const url = raw.website ?? raw.evidence_url ?? null;

  // 1. Reddit immediate rejection
  if (isRedditUrl(url)) {
    return {
      verified: null,
      rejected: {
        rejection_code: REJECTION_CODES.REDDIT_URL,
        rejection_reason: 'Discovery URL is Reddit — not a valid company source',
        original_name: name,
        original_url: url,
        entity_type: 'forum_post',
      },
    };
  }

  // 2. Entity classification
  const classification = classifyEntity(name, url, raw.description);

  // Hard reject: auto-reject types
  if (AUTO_REJECT_TYPES.has(classification.entity_type)) {
    return {
      verified: null,
      rejected: {
        rejection_code: REJECTION_CODES.FORUM_POST,
        rejection_reason: classification.reason,
        original_name: name,
        original_url: url,
        entity_type: classification.entity_type,
      },
    };
  }

  // Hard reject: association (no resolution attempted)
  if (classification.entity_type === 'association' && !classification.send_to_identity_resolution) {
    return {
      verified: null,
      rejected: {
        rejection_code: REJECTION_CODES.ASSOCIATION,
        rejection_reason: `Entity classified as association/trade body: ${classification.reason}`,
        original_name: name,
        original_url: url,
        entity_type: 'association',
      },
    };
  }

  // 3. Identity resolution for content/directory/unknown types
  let resolvedName = name;
  let resolvedUrl = url;
  let identityResolution = null;
  let entityType = classification.entity_type;

  const needsResolution =
    classification.send_to_identity_resolution ||
    CONTENT_TYPES.has(classification.entity_type) ||
    classification.entity_type === 'unknown'; // alt-text names → try to resolve from URL

  if (needsResolution) {
    const resResult = resolveIdentity(name, url);

    if (!resResult.resolved || !resResult.resolution?.resolved_company_name) {
      // Cannot resolve → reject
      const isArticle = CONTENT_TYPES.has(classification.entity_type) || classification.entity_type === 'article';
      return {
        verified: null,
        rejected: {
          rejection_code: isArticle ? REJECTION_CODES.ARTICLE_AS_COMPANY : REJECTION_CODES.UNRESOLVABLE_IDENTITY,
          rejection_reason: resResult.rejection_reason ?? `Could not resolve underlying company for: "${name}"`,
          original_name: name,
          original_url: url,
          entity_type: classification.entity_type,
        },
      };
    }

    // Resolved successfully
    identityResolution = resResult.resolution;
    resolvedName = resResult.resolution.resolved_company_name;
    resolvedUrl = resResult.normalized_official_url;
    entityType = 'company';
  }

  // 4. Directory as final entity (no resolution) → reject
  if (classification.entity_type === 'directory' && !identityResolution) {
    return {
      verified: null,
      rejected: {
        rejection_code: REJECTION_CODES.DIRECTORY_URL,
        rejection_reason: `URL is a directory listing without resolvable company identity: ${classification.reason}`,
        original_name: name,
        original_url: url,
        entity_type: 'directory',
      },
    };
  }

  // 5. Determine official website URL
  const officialHostname = resolvedUrl ? extractHostname(resolvedUrl) : null;
  const discoveryUrl = url;

  // Normalize website to root if it's on the official domain
  let officialWebsite: string | null = resolvedUrl;
  if (raw.website && officialHostname) {
    const websiteHostname = extractHostname(raw.website);
    if (websiteHostname === officialHostname) {
      // It's on the correct domain — normalize to root
      officialWebsite = normalizeToRootUrl(raw.website) ?? resolvedUrl;
    }
  }

  // 6. LinkedIn validation — pass company name to enable http_unverified vs url_format_valid
  const linkedInVal = validateLinkedIn(raw.linkedin, resolvedName);
  const linkedInStatus: LinkedInStatus = linkedInVal.status;

  // 7. Colombia and sector evidence (from existing fields)
  const colombiaEvidence = (raw.country ?? '').toLowerCase().includes('colombia')
    ? `Field country="${raw.country}"`
    : null;
  const sectorEvidence = raw.sector ? `Field sector="${raw.sector}"` : null;

  // 8. Verified company check — official website must not be a known non-corporate host
  const officialWebsiteHost = officialWebsite ? extractHostname(officialWebsite) ?? '' : '';
  const hasRealOfficialSite = !!officialWebsite && !NON_CORPORATE_HOSTS.has(officialWebsiteHost);
  const isVerified = entityType === 'company' && (hasRealOfficialSite || !!identityResolution);

  // 9. Normalize company name (strip informal parentheticals → move to notes)
  const normResult = normalizeCompanyName(resolvedName);
  const finalName = normResult.cleanName;
  const mergedNotes = mergeNotes(raw.notes, normResult.extractedNotes);

  // 10. Build verified candidate
  const verified: VerifiedBenchmarkCandidate = {
    ...raw,
    name: finalName,
    notes: mergedNotes,
    website: officialWebsite,
    linkedin: linkedInVal.normalized_url ?? raw.linkedin,
    entity_type: entityType,
    identity_resolution: identityResolution,
    official_website_url: officialWebsite,
    discovery_url: discoveryUrl,
    linkedin_status: linkedInStatus,
    colombia_evidence: colombiaEvidence,
    sector_evidence: sectorEvidence,
    is_verified_company: isVerified,
  };

  return { verified, rejected: null };
}

// ─── Runner del pipeline de candidatos ────────────────────────────────────────

export function runCandidateValidationPipeline(
  rawCandidates: BenchmarkCandidate[],
): CandidatePhaseResult {
  const verified: VerifiedBenchmarkCandidate[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const raw of rawCandidates) {
    const { verified: v, rejected: r } = validateSingleCandidate(raw);
    if (v) verified.push(v);
    if (r) rejected.push(r);
  }

  // Final selection: apply Baja confidence and missing-fields rules
  const finalCandidates: VerifiedBenchmarkCandidate[] = [];
  for (const v of verified) {
    if (v.confidence === 'Baja') {
      rejected.push({
        rejection_code: REJECTION_CODES.LOW_CONFIDENCE,
        rejection_reason: 'Confianza Baja — no puede entrar al resultado final',
        original_name: v.name,
        original_url: v.website,
        entity_type: v.entity_type,
      });
    } else if (hasTooManyMissingCriticalFields(v)) {
      rejected.push({
        rejection_code: REJECTION_CODES.INVALID_FINAL_ROW,
        rejection_reason: 'Candidate has all four critical enrichment fields empty (linkedin, city, size, description) — cannot enter final results',
        original_name: v.name,
        original_url: v.website,
        entity_type: v.entity_type,
      });
    } else {
      finalCandidates.push(v);
    }
  }

  return {
    raw_discovered_candidates: rawCandidates,
    verified_candidates: verified,
    rejected_candidates: rejected,
    final_candidates: finalCandidates,
  };
}
