/**
 * 16TX.1 — Búsqueda manual de identificador fiscal faltante.
 *
 * Busca un identificador fiscal candidato (NIT/RFC/RUC) para un prospect_candidate
 * que no tiene tax_identifier. Los resultados se guardan como CANDIDATOS en
 * metadata.tax_identifier_lookup — NUNCA se escribe tax_identifier oficial.
 *
 * Fuentes consultadas (en orden):
 * 1. Metadata interna del candidato (import / validation / external)
 * 2. HubSpot read-only (si hay company_id vinculado)
 * 3. No hay búsqueda web abierta ni IA inventando identifiers en este hito.
 *
 * Invariantes de seguridad:
 * - No escribe prospect_candidates.tax_identifier
 * - No crea accounts
 * - No escribe HubSpot
 * - No crea contactos ni deals
 * - No usa Tavily, Apollo ni búsqueda web no autorizada
 * - requires_human_review siempre true
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { colombiaOfficialTaxProvider, checkIsColombiaProviderConfigured, SocrataDebugInfo } from './tax-identifier-providers/colombia';

// ── Types ──────────────────────────────────────────────────────

export type TaxIdentifierLookupStatus =
  | 'not_started'
  | 'searching'
  | 'completed'
  | 'failed'
  | 'no_result';

export type TaxIdentifierSourceType =
  | 'internal_metadata'
  | 'hubspot'
  | 'official'
  | 'public_directory'
  | 'public_registry'
  | 'government_dataset'
  | 'company_website'
  | 'manual'
  | 'ai_assisted';

export type TaxIdentifierConfidence = 'high' | 'medium' | 'low';

export interface TaxIdentifierCandidate {
  tax_identifier: string;
  normalized_tax_identifier: string;
  legal_name: string | null;
  source_name: string;
  source_type: TaxIdentifierSourceType;
  source_url: string | null;
  evidence_text: string | null;
  confidence: TaxIdentifierConfidence;
  match_reason: string;
  risks: string[];
  requires_human_review: true;
}

export interface TaxIdentifierSelectedCandidate {
  tax_identifier: string;
  normalized_tax_identifier: string;
  legal_name: string | null;
  source_name: string;
  source_type: TaxIdentifierSourceType;
  source_url: string | null;
  evidence_text: string | null;
  confidence: TaxIdentifierConfidence;
  approved_at: string;
  approved_by: string;
  approval_method: 'human_review';
  previous_tax_identifier: string | null;
}

export interface TaxIdentifierLookupMetadata {
  status: TaxIdentifierLookupStatus;
  searched_at: string;
  searched_by: string;
  country_code: string;
  input: {
    company_name: string | null;
    legal_name: string | null;
    website: string | null;
    domain: string | null;
    city: string | null;
  };
  candidates: TaxIdentifierCandidate[];
  selected_candidate: TaxIdentifierSelectedCandidate | null;
  warnings: string[];
  error: string | null;
  debug?: unknown;
}

export interface LookupTaxIdentifierResult {
  success: boolean;
  candidate_id: string;
  lookup: TaxIdentifierLookupMetadata;
  message: string;
  error?: string;
}

// ── Normalization ──────────────────────────────────────────────

/**
 * Normaliza un identificador fiscal según el país.
 * Para Colombia: elimina espacios, puntos (no el dígito de verificación).
 * No inventa DV ni completa datos faltantes.
 */
export function normalizeTaxIdentifierByCountry(
  value: string,
  countryCode: string
): string {
  if (!value || typeof value !== 'string') return '';
  const country = countryCode.toUpperCase().trim();
  let normalized = value.trim();

  if (country === 'CO') {
    // NIT Colombia: XXXXXXXXX-D (DV optional)
    // Remove spaces and dots; normalize dash separators; never add DV
    normalized = normalized.replace(/\s+/g, '').replace(/\./g, '');
    normalized = normalized.replace(/[–—]/g, '-');
  } else if (country === 'MX') {
    normalized = normalized.toUpperCase().replace(/\s+/g, '');
  } else if (country === 'CL') {
    normalized = normalized.trim();
  } else if (country === 'PE' || country === 'EC' || country === 'PY') {
    normalized = normalized.replace(/\s+/g, '').replace(/[.-]/g, '');
  } else {
    normalized = normalized.trim();
  }

  return normalized;
}

// ── Helpers internos ───────────────────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

async function getHubSpotToken(): Promise<string | null> {
  try {
    const admin = getAdminClient();
    const { data, error } = await admin.rpc('get_vault_secret_decrypted', {
      p_name: 'sellup_integration_hubspot',
    });
    if (error) return null;
    return (data as string | null) ?? null;
  } catch {
    return null;
  }
}

async function isHubSpotConnected(): Promise<boolean> {
  try {
    const admin = getAdminClient();
    const { data: integration } = await admin
      .from('external_integrations')
      .select('id')
      .eq('integration_key', 'hubspot')
      .single();
    if (!integration?.id) return false;
    const { data: connection } = await admin
      .from('external_integration_connections')
      .select('connection_status, credentials_status')
      .eq('integration_id', integration.id)
      .eq('credentials_status', 'stored')
      .neq('connection_status', 'disconnected')
      .single();
    return !!connection;
  } catch {
    return false;
  }
}

const HS_FISCAL_PROPERTIES = [
  'name',
  'identificacion_fiscal',
  'nit',
  'rfc',
  'ruc',
  'tax_id',
  'identificacion_fiscal_nit_rfc_ruc',
  'domain',
  'website',
];

interface HsCompanyFiscalProps {
  identificacion_fiscal?: string | null;
  nit?: string | null;
  rfc?: string | null;
  ruc?: string | null;
  tax_id?: string | null;
  identificacion_fiscal_nit_rfc_ruc?: string | null;
  name?: string | null;
  domain?: string | null;
  website?: string | null;
}

/**
 * Lee propiedades fiscales de una empresa en HubSpot por su companyId (read-only).
 * NO escribe ni modifica nada en HubSpot.
 */
async function readHubSpotCompanyFiscalProperties(
  companyId: string
): Promise<HsCompanyFiscalProps | null> {
  const token = await getHubSpotToken();
  if (!token) return null;

  try {
    const propsParam = HS_FISCAL_PROPERTIES.join(',');
    const url = `https://api.hubapi.com/crm/v3/objects/companies/${companyId}?properties=${propsParam}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return (data?.properties ?? null) as HsCompanyFiscalProps | null;
  } catch {
    return null;
  }
}

function extractFiscalFromHsProps(
  props: HsCompanyFiscalProps,
  countryCode: string
): string | null {
  const candidates = [
    props.identificacion_fiscal,
    props.nit,
    props.rfc,
    props.ruc,
    props.tax_id,
    props.identificacion_fiscal_nit_rfc_ruc,
  ];
  for (const val of candidates) {
    if (val && typeof val === 'string' && val.trim().length > 0) {
      const normalized = normalizeTaxIdentifierByCountry(val.trim(), countryCode);
      if (normalized.length > 0) return normalized;
    }
  }
  return null;
}

// ── Lookup por fuentes internas del candidato ──────────────────

interface InternalFiscalResult {
  tax_identifier: string;
  source_field: string;
  evidence: string;
}

function extractFromInternalMetadata(
  candidate: Record<string, unknown>
): InternalFiscalResult | null {
  const meta = candidate.metadata as Record<string, unknown> | undefined;
  if (!meta) return null;

  const countryCode = (candidate.country_code as string | null | undefined) ?? 'XX';

  // 1. metadata.validation.hubspot_duplicate_check.matched_tax_identifier
  const validation = meta.validation as Record<string, unknown> | undefined;
  const hsDup = validation?.hubspot_duplicate_check as Record<string, unknown> | undefined;
  if (hsDup?.matched_tax_identifier && typeof hsDup.matched_tax_identifier === 'string') {
    const v = hsDup.matched_tax_identifier.trim();
    if (v.length > 0) {
      return {
        tax_identifier: normalizeTaxIdentifierByCountry(v, countryCode),
        source_field: 'metadata.validation.hubspot_duplicate_check.matched_tax_identifier',
        evidence: `Identificador fiscal encontrado en validación HubSpot previa: ${v}`,
      };
    }
  }

  // 2. metadata.import.tax_identifier
  const importMeta = meta.import as Record<string, unknown> | undefined;
  if (importMeta?.tax_identifier && typeof importMeta.tax_identifier === 'string') {
    const v = (importMeta.tax_identifier as string).trim();
    if (v.length > 0) {
      return {
        tax_identifier: normalizeTaxIdentifierByCountry(v, countryCode),
        source_field: 'metadata.import.tax_identifier',
        evidence: `Identificador fiscal encontrado en datos de importación: ${v}`,
      };
    }
  }

  // 3. metadata.external.tax_identifier
  const externalMeta = meta.external as Record<string, unknown> | undefined;
  if (externalMeta?.tax_identifier && typeof externalMeta.tax_identifier === 'string') {
    const v = (externalMeta.tax_identifier as string).trim();
    if (v.length > 0) {
      return {
        tax_identifier: normalizeTaxIdentifierByCountry(v, countryCode),
        source_field: 'metadata.external.tax_identifier',
        evidence: `Identificador fiscal encontrado en datos externos del candidato: ${v}`,
      };
    }
  }

  // 4. candidate.source_evidence — busca patrones de NIT/RFC/RUC explícitos
  const sourceEvidence = candidate.source_evidence as string | null | undefined;
  if (sourceEvidence && typeof sourceEvidence === 'string') {
    // Colombia NIT pattern: 9 digits optionally followed by -digit
    const nitMatch = sourceEvidence.match(/\bNIT[:\s#]*([0-9]{7,10}(?:-[0-9])?)\b/i);
    if (nitMatch?.[1] && countryCode.toUpperCase() === 'CO') {
      const v = normalizeTaxIdentifierByCountry(nitMatch[1], 'CO');
      return {
        tax_identifier: v,
        source_field: 'source_evidence',
        evidence: `NIT extraído de evidencia de fuente: ${sourceEvidence.slice(0, 200)}`,
      };
    }
    // RFC pattern (Mexico)
    const rfcMatch = sourceEvidence.match(/\bRFC[:\s#]*([A-Z]{3,4}[0-9]{6}[A-Z0-9]{3})\b/i);
    if (rfcMatch?.[1] && countryCode.toUpperCase() === 'MX') {
      return {
        tax_identifier: normalizeTaxIdentifierByCountry(rfcMatch[1], 'MX'),
        source_field: 'source_evidence',
        evidence: `RFC extraído de evidencia de fuente: ${sourceEvidence.slice(0, 200)}`,
      };
    }
  }

  return null;
}

// ── Función principal ──────────────────────────────────────────

export async function lookupTaxIdentifierForCandidate({
  candidateId,
  userId,
  supabase,
}: {
  candidateId: string;
  userId: string;
  supabase: SupabaseClient;
}): Promise<LookupTaxIdentifierResult> {
  const searchedAt = new Date().toISOString();

  // ── 1. Cargar candidato ──────────────────────────────────────
  const { data: candidate, error: fetchError } = await supabase
    .from('prospect_candidates')
    .select('*')
    .eq('id', candidateId)
    .single();

  if (fetchError || !candidate) {
    return {
      success: false,
      candidate_id: candidateId,
      lookup: buildFailedLookup(searchedAt, userId, 'XX', 'Candidato no encontrado'),
      message: 'Candidato no encontrado',
      error: 'CANDIDATE_NOT_FOUND',
    };
  }

  // ── 2. Validar que falta tax_identifier ──────────────────────
  if (candidate.tax_identifier && candidate.tax_identifier.trim().length > 0) {
    const emptyLookup: TaxIdentifierLookupMetadata = {
      status: 'no_result',
      searched_at: searchedAt,
      searched_by: userId,
      country_code: candidate.country_code ?? 'XX',
      input: buildInput(candidate),
      candidates: [],
      selected_candidate: null,
      warnings: ['El candidato ya tiene identificador fiscal. No se realizó búsqueda.'],
      error: null,
    };
    return {
      success: false,
      candidate_id: candidateId,
      lookup: emptyLookup,
      message: 'El candidato ya tiene identificador fiscal. No se requiere búsqueda.',
      error: 'TAX_IDENTIFIER_ALREADY_PRESENT',
    };
  }

  const countryCode = (candidate.country_code as string | null | undefined) ?? 'XX';
  const warnings: string[] = [];
  const foundCandidates: TaxIdentifierCandidate[] = [];

  // ── 3. Buscar en metadata interna ───────────────────────────
  const internalResult = extractFromInternalMetadata(candidate);
  if (internalResult) {
    foundCandidates.push({
      tax_identifier: internalResult.tax_identifier,
      normalized_tax_identifier: internalResult.tax_identifier,
      legal_name: (candidate.legal_name as string | null) ?? (candidate.name as string | null),
      source_name: 'Datos internos del candidato',
      source_type: 'internal_metadata',
      source_url: null,
      evidence_text: internalResult.evidence,
      confidence: 'medium',
      match_reason: `Identificador fiscal encontrado en campo interno: ${internalResult.source_field}`,
      risks: [
        'Dato proveniente de importación o validación previa — requiere confirmación con fuente oficial.',
      ],
      requires_human_review: true,
    });
  }

  // ── 4. Buscar en HubSpot read-only ───────────────────────────
  const meta = (candidate.metadata ?? {}) as Record<string, unknown>;
  const validationMeta = meta.validation as Record<string, unknown> | undefined;
  const hsDupCheck = validationMeta?.hubspot_duplicate_check as Record<string, unknown> | undefined;
  const hsCompanyId =
    (hsDupCheck?.matched_company_id as string | null | undefined) ??
    (hsDupCheck?.matched_hubspot_company_id as string | null | undefined) ??
    (candidate.matched_hubspot_company_id as string | null | undefined) ??
    null;

  if (hsCompanyId) {
    const hsConnected = await isHubSpotConnected();
    if (hsConnected) {
      const hsFiscalProps = await readHubSpotCompanyFiscalProperties(hsCompanyId);
      if (hsFiscalProps) {
        const hsTaxId = extractFiscalFromHsProps(hsFiscalProps, countryCode);
        if (hsTaxId) {
          const alreadyFound = foundCandidates.some(
            (c) => c.normalized_tax_identifier === hsTaxId
          );
          if (!alreadyFound) {
            const hsCompanyName = hsFiscalProps.name ?? null;
            foundCandidates.push({
              tax_identifier: hsTaxId,
              normalized_tax_identifier: hsTaxId,
              legal_name: hsCompanyName,
              source_name: 'HubSpot CRM (read-only)',
              source_type: 'hubspot',
              source_url: `https://app.hubspot.com/contacts/companies/${hsCompanyId}`,
              evidence_text: `Identificador fiscal leído de empresa HubSpot ID ${hsCompanyId}${hsCompanyName ? `: ${hsCompanyName}` : ''}.`,
              confidence: 'medium',
              match_reason: `Empresa vinculada en HubSpot (ID: ${hsCompanyId}) tiene identificador fiscal registrado.`,
              risks: [
                'Dato proveniente del CRM — verificar que corresponde exactamente a este candidato.',
                'HubSpot puede tener registros desactualizados.',
              ],
              requires_human_review: true,
            });
          }
        } else {
          warnings.push(
            `La empresa vinculada en HubSpot (ID: ${hsCompanyId}) no tiene identificador fiscal registrado en sus propiedades.`
          );
        }
      }
    } else {
      warnings.push('HubSpot no está configurado. No se pudo consultar el CRM.');
    }
  }

  let lookupError: string | null = null;
  const context: { debug?: SocrataDebugInfo } = {};

  // ── 5. Verificar fuente oficial por país ─────────────────────
  if (countryCode.toUpperCase() === 'CO') {
    const isConfigured = await checkIsColombiaProviderConfigured();
    if (!isConfigured) {
      warnings.push('No hay fuente fiscal oficial de Colombia configurada.');
      warnings.push('Fuente oficial Colombia no configurada.');
    } else {
      try {
        const officialCandidates = await colombiaOfficialTaxProvider.lookup({
          company_name: (candidate.name as string | null) ?? null,
          legal_name: (candidate.legal_name as string | null) ?? null,
          website: (candidate.website as string | null) ?? null,
          domain: (candidate.domain as string | null) ?? null,
          city: (candidate.city as string | null) ?? null,
          country_code: countryCode,
        }, context);

        if (officialCandidates.length > 0) {
          for (const c of officialCandidates) {
            const alreadyFound = foundCandidates.some(
              (f) => f.normalized_tax_identifier === c.normalized_tax_identifier
            );
            if (!alreadyFound) {
              foundCandidates.push({
                tax_identifier: c.tax_identifier,
                normalized_tax_identifier: c.normalized_tax_identifier,
                legal_name: c.legal_name ?? null,
                source_name: c.source_name,
                source_type: c.source_type,
                source_url: c.source_url ?? null,
                evidence_text: c.evidence_text ?? null,
                confidence: c.confidence,
                match_reason: c.match_reason,
                risks: c.risks,
                requires_human_review: true,
              });
            }
          }
        } else {
          warnings.push('Fuente oficial Colombia consultada sin resultados.');
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Error desconocido';
        if (errMsg === 'DATASET_MISSING_NIT') {
          warnings.push('Fuente oficial Colombia consultada, pero no expone identificador fiscal.');
        } else {
          warnings.push('Fuente oficial Colombia no disponible temporalmente.');
          lookupError = errMsg;
        }
      }
    }
  } else if (foundCandidates.length === 0) {
    warnings.push(
      `No hay fuente fiscal oficial configurada para el país ${countryCode}. ` +
      'La búsqueda se limitó a datos internos y HubSpot.'
    );
  }

  // ── 6. Construir y guardar resultado ─────────────────────────
  const lookupStatus: TaxIdentifierLookupStatus =
    foundCandidates.length > 0 ? 'completed' : 'no_result';

  const lookup: TaxIdentifierLookupMetadata = {
    status: lookupStatus,
    searched_at: searchedAt,
    searched_by: userId,
    country_code: countryCode,
    input: buildInput(candidate),
    candidates: foundCandidates,
    selected_candidate: null,
    warnings,
    error: lookupError,
  };

  if (process.env.NODE_ENV !== 'production' && context.debug) {
    lookup.debug = context.debug;
  }

  // Guardar en metadata — ÚNICAMENTE en tax_identifier_lookup, nunca en tax_identifier
  const existingMetadata = (candidate.metadata as Record<string, unknown>) ?? {};
  const updatedMetadata = {
    ...existingMetadata,
    tax_identifier_lookup: lookup,
  };

  const { error: updateError } = await supabase
    .from('prospect_candidates')
    .update({ metadata: updatedMetadata })
    .eq('id', candidateId);

  if (updateError) {
    return {
      success: false,
      candidate_id: candidateId,
      lookup,
      message: 'No se pudo guardar el resultado de la búsqueda.',
      error: 'SAVE_FAILED',
    };
  }

  const message =
    foundCandidates.length > 0
      ? `Búsqueda completada. Se encontraron ${foundCandidates.length} posible(s) identificador(es) fiscal(es). Requieren revisión humana.`
      : 'Búsqueda completada. No se encontró identificador fiscal con las fuentes disponibles.';

  return {
    success: true,
    candidate_id: candidateId,
    lookup,
    message,
  };
}

// ── Helpers de construcción ────────────────────────────────────

function buildInput(candidate: Record<string, unknown>) {
  return {
    company_name: (candidate.name as string | null) ?? null,
    legal_name: (candidate.legal_name as string | null) ?? null,
    website: (candidate.website as string | null) ?? null,
    domain: (candidate.domain as string | null) ?? null,
    city: (candidate.city as string | null) ?? null,
  };
}

function buildFailedLookup(
  searchedAt: string,
  userId: string,
  countryCode: string,
  errorMsg: string
): TaxIdentifierLookupMetadata {
  return {
    status: 'failed',
    searched_at: searchedAt,
    searched_by: userId,
    country_code: countryCode,
    input: { company_name: null, legal_name: null, website: null, domain: null, city: null },
    candidates: [],
    selected_candidate: null,
    warnings: [],
    error: errorMsg,
  };
}
