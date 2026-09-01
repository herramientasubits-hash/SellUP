/**
 * Prospecting Toolkit — sellup_duplicate_checker
 *
 * Verifica si una empresa candidata ya existe en la tabla accounts de SellUp.
 * Solo lectura. Usa service_role para bypasear RLS (tool de agente, no de usuario).
 * No crea ni modifica ningún registro.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { DuplicateCheckInput, DuplicateMatch, DuplicateStatus } from './types';
import { buildCompanySearchTerms, normalizeCompanyName } from './normalization';
import { buildFiscalLookupNeedles, resolveFiscalCountryScope } from './fiscal-identity';
import { classifyFiscalDuplicateIdentity } from './fiscal-duplicate-classification';

// ============================================================
// Admin client — service_role bypasea RLS
// ============================================================

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

// ============================================================
// Tipos internos
// ============================================================

interface AccountRow {
  id: string;
  name: string;
  normalized_name: string | null;
  domain: string | null;
  website: string | null;
  country_code: string | null;
  tax_identifier: string | null;
}

// ============================================================
// checkSellUpDuplicates
// ============================================================

/**
 * Consulta accounts en SellUp por múltiples criterios de deduplicación.
 *
 * Prioridad:
 *   1. domain exacto          → existing_in_sellup (95)
 *   2. tax_identifier exacto  → existing_in_sellup (92)
 *   3. normalized_name + countryCode exacto → existing_in_sellup (88)
 *   4. nombre es contenido en o contiene el nombre existente → possible_duplicate (65)
 *
 * Retorna un array de DuplicateMatch (puede ser vacío si no hay matches).
 */
export async function checkSellUpDuplicates(
  input: DuplicateCheckInput
): Promise<DuplicateMatch[]> {
  // `normalizedTaxId` (derivación legacy `normalizeTaxIdentifier`) ya NO se
  // consume aquí: dejó de ser la autoridad de igualdad fiscal (CUT-3B1).
  const { normalizedName, domain, countryCode } = buildCompanySearchTerms(input);

  const isInsufficient =
    !input.name?.trim() && !domain && !input.country && !input.countryCode;

  if (isInsufficient) {
    return [
      {
        source: 'sellup',
        status: 'insufficient_data',
        confidence: 0,
        reason: 'Sin nombre, dominio ni país — no se puede evaluar',
      },
    ];
  }

  const admin = getAdminClient();
  const matches: DuplicateMatch[] = [];

  const SELECT =
    'id, name, normalized_name, domain, website, country_code, tax_identifier';

  // ── 1. Domain exacto ─────────────────────────────────────────
  if (domain) {
    const { data } = await admin
      .from('accounts')
      .select(SELECT)
      .eq('domain', domain)
      .is('archived_at', null)
      .limit(5);

    if (data && data.length > 0) {
      for (const row of data as AccountRow[]) {
        matches.push({
          source: 'sellup',
          status: 'existing_in_sellup',
          confidence: 95,
          matchedId: row.id,
          matchedName: row.name,
          matchedDomain: row.domain,
          matchedWebsite: row.website,
          matchedTaxIdentifier: row.tax_identifier,
          reason: `Dominio exacto coincide: ${domain}`,
        });
      }
      return matches;
    }
  }

  // ── 2. Identidad fiscal con ÁMBITO DE PAÍS ────────────────
  //
  // AGENT1-SHARED-FISCAL-IDENTITY-COUNTRY-SCOPE-CORRECTION.
  //
  // Antes: la igualdad se decidía con un normalizador legacy en línea
  // (`toLowerCase().replace(/[\s.\-_]/g,'')`) y SIN mirar `country_code`. Eso
  // producía los dos defectos a la vez: un `123456789` colombiano igualaba a un
  // `123456789` mexicano (falso POSITIVO transfronterizo, y con confianza 92 —
  // FUERTE para el lector de CUT-L7), mientras que `900123456-7` no igualaba al
  // mismo NIT almacenado sin DV porque el guion se borraba en vez de recortarse
  // (falso NEGATIVO colombiano).
  //
  // Ahora la autoridad es CUT-3B1: PAÍS + IDENTIFICADOR FISCAL CANÓNICO. La
  // consulta sigue siendo un PREFILTRO respaldado por índice; quien decide la
  // identidad es la comparación canónica en memoria.
  const candidateFiscalScope = resolveFiscalCountryScope(countryCode);
  const fiscalNeedles = buildFiscalLookupNeedles([input.taxIdentifier], countryCode);

  // Fail-closed: sin ámbito de país o sin canónico utilizable NO puede existir
  // identidad fiscal automática, así que no se gasta ni una lectura. La evidencia
  // débil sigue disponible por los ejes de nombre de más abajo.
  if (candidateFiscalScope && fiscalNeedles.canonical.length > 0) {
    // El prefiltro busca por SUBSTRING del canónico. Es deliberadamente amplio
    // —alcanza `900123456`, `900123456-7`, `NIT 900123456`— y no puede producir
    // falsos positivos porque toda fila leída se revalida canónicamente abajo.
    // Las variantes `<canónico>-<dígito>` que `buildFiscalLookupNeedles` enumera
    // para Colombia ya quedan cubiertas por ese substring, así que no se añaden
    // términos redundantes al filtro.
    let query = admin.from('accounts').select(SELECT).is('archived_at', null).limit(5);

    query =
      fiscalNeedles.canonical.length === 1
        ? query.ilike('tax_identifier', `%${fiscalNeedles.canonical[0]}%`)
        : query.or(
            fiscalNeedles.canonical
              .map((needle) => `tax_identifier.ilike.%${needle}%`)
              .join(','),
          );

    const { data } = await query;

    if (data && data.length > 0) {
      for (const row of data as AccountRow[]) {
        // AUTORIDAD: país del candidato == país de la fila, Y canónico == canónico.
        // `row.country_code` entra aquí como post-filtro y no como filtro de
        // consulta: un país almacenado con otra representación debe degradar la
        // evidencia, nunca ocultar la fila.
        const verdict = classifyFiscalDuplicateIdentity({
          candidateCountryCode: countryCode,
          candidateTaxId: input.taxIdentifier,
          matchedCountryCode: row.country_code,
          matchedTaxId: row.tax_identifier,
        });

        if (!verdict.proven) continue;

        matches.push({
          source: 'sellup',
          status: 'existing_in_sellup',
          confidence: 92,
          matchedId: row.id,
          matchedName: row.name,
          matchedDomain: row.domain,
          matchedWebsite: row.website,
          matchedTaxIdentifier: row.tax_identifier,
          reason: `Identificador fiscal exacto coincide (${verdict.namespace})`,
        });
      }
      if (matches.length > 0) return matches;
    }
  }

  // ── 3. normalized_name + countryCode exacto ──────────────────
  if (normalizedName && normalizedName.length >= 3) {
    let query = admin
      .from('accounts')
      .select(SELECT)
      .eq('normalized_name', normalizedName)
      .is('archived_at', null)
      .limit(5);

    if (countryCode) {
      query = query.eq('country_code', countryCode);
    }

    const { data } = await query;

    if (data && data.length > 0) {
      for (const row of data as AccountRow[]) {
        matches.push({
          source: 'sellup',
          status: 'existing_in_sellup',
          confidence: 88,
          matchedId: row.id,
          matchedName: row.name,
          matchedDomain: row.domain,
          matchedWebsite: row.website,
          matchedTaxIdentifier: row.tax_identifier,
          reason: `Nombre normalizado exacto coincide${countryCode ? ` + país ${countryCode}` : ''}`,
        });
      }
      return matches;
    }
  }

  // ── 4. Nombre parcial / contenido ────────────────────────────
  if (normalizedName && normalizedName.length >= 4) {
    const { data } = await admin
      .from('accounts')
      .select(SELECT)
      .ilike('name', `%${input.name.trim()}%`)
      .is('archived_at', null)
      .limit(10);

    if (data && data.length > 0) {
      for (const row of data as AccountRow[]) {
        const rowNorm = normalizeCompanyName(row.name);
        const isContained =
          rowNorm.includes(normalizedName) ||
          normalizedName.includes(rowNorm);

        if (isContained && rowNorm.length >= 3 && normalizedName.length >= 3) {
          matches.push({
            source: 'sellup',
            status: 'possible_duplicate',
            confidence: 65,
            matchedId: row.id,
            matchedName: row.name,
            matchedDomain: row.domain,
            matchedWebsite: row.website,
            matchedTaxIdentifier: row.tax_identifier,
            reason: `Nombre similar por contenido: "${row.name}"`,
          });
        }
      }
    }
  }

  return matches;
}

// ============================================================
// resolveStatus — traduce matches a status consolidado
// ============================================================

export function resolveSellUpStatus(matches: DuplicateMatch[]): {
  status: DuplicateStatus;
  confidence: number;
} {
  if (matches.length === 0) {
    return { status: 'new_candidate', confidence: 85 };
  }

  const exact = matches.find((m) => m.status === 'existing_in_sellup');
  if (exact) return { status: 'existing_in_sellup', confidence: exact.confidence };

  const insufficient = matches.find((m) => m.status === 'insufficient_data');
  if (insufficient) return { status: 'insufficient_data', confidence: 0 };

  const possible = matches.find((m) => m.status === 'possible_duplicate');
  if (possible) return { status: 'possible_duplicate', confidence: possible.confidence };

  return { status: 'new_candidate', confidence: 85 };
}
