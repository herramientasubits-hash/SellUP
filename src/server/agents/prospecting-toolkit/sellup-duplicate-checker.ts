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
  const { normalizedName, domain, normalizedTaxId, countryCode } =
    buildCompanySearchTerms(input);

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

  // ── 2. Tax identifier exacto ──────────────────────────────────
  if (normalizedTaxId && normalizedTaxId.length >= 6) {
    const { data } = await admin
      .from('accounts')
      .select(SELECT)
      .ilike('tax_identifier', `%${normalizedTaxId}%`)
      .is('archived_at', null)
      .limit(5);

    if (data && data.length > 0) {
      for (const row of data as AccountRow[]) {
        if (!row.tax_identifier) continue;
        const rowNormalized = row.tax_identifier
          .toLowerCase()
          .replace(/[\s.\-_]/g, '');
        if (rowNormalized === normalizedTaxId) {
          matches.push({
            source: 'sellup',
            status: 'existing_in_sellup',
            confidence: 92,
            matchedId: row.id,
            matchedName: row.name,
            matchedDomain: row.domain,
            matchedWebsite: row.website,
            matchedTaxIdentifier: row.tax_identifier,
            reason: `Identificador fiscal exacto coincide`,
          });
        }
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
