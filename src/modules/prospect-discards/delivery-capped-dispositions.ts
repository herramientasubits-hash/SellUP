/**
 * delivery-capped-dispositions.ts — lo que el tope de ENTREGA dejó fuera queda en
 * «Descartadas», y por tanto LIBRE.
 *
 * AGENT1-DELIVERY-CAP-STAYS-FREE-1. Defecto de #521 encontrado en Producción
 * (01-10, Chile × Salud, lote `34eeac5a`: 12 elegibles, 10 entregadas, 2
 * recortadas): lo recortado no se persistía en ningún sitio, pero Apollo ya lo
 * había registrado en `provider_seen_entities`; la exclusión de la siguiente
 * búsqueda sólo libera lo que en SellUp está DESCARTADO, así que esas empresas
 * quedaban ocultas ~30 días para TODOS los vendedores. El tope prometía «queda
 * libre para otro vendedor» y hacía lo contrario.
 *
 * Ahora se registran como `target_cap_reached` (motivo `delivery_cap`): el
 * vendedor puede verlas y enviarlas a revisión, y la exclusión de Apollo las
 * libera igual que libera un descarte.
 *
 * Puro: sin env, sin I/O.
 */

import type { DeliveryCappedCompany } from '@/server/agents/prospecting-toolkit/types';
import type { CreateDiscardedDispositionInput } from './types';

export const DELIVERY_CAP_DISPOSITION = 'target_cap_reached' as const;
export const DELIVERY_CAP_REASON_CODE = 'delivery_cap';

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

export function buildDeliveryCappedDispositionRows(input: {
  batchId: string;
  sourcePrimary: 'apollo' | 'tavily' | 'lusha' | 'public_source';
  requestedCountryCode: string | null;
  requestedIndustry: string | null;
  companies: readonly DeliveryCappedCompany[];
}): CreateDiscardedDispositionInput[] {
  const rows: CreateDiscardedDispositionInput[] = [];
  const seen = new Set<string>();
  for (const company of input.companies) {
    const name = company.name?.trim();
    if (!name) continue;
    const identity = company.domain ? normalizeKeyPart(company.domain) : `name:${name.toLowerCase()}`;
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    rows.push({
      batchId: input.batchId,
      providerIdentifier: null,
      sourceKey: `delivery_cap:${identity}`,
      name,
      domain: company.domain ? normalizeKeyPart(company.domain) : null,
      countryCode: company.countryCode ?? input.requestedCountryCode,
      industry: input.requestedIndustry,
      sourcePrimary: input.sourcePrimary,
      roundOrigin: null,
      disposition: DELIVERY_CAP_DISPOSITION,
      reasonCode: DELIVERY_CAP_REASON_CODE,
      reasonDetail: 'Fuera por el tope de empresas por vendedor; queda libre para otro vendedor.',
      evidence: {
        provider_raw_name: name,
        ...(company.linkedinUrl ? { linkedin_url: company.linkedinUrl } : {}),
      },
    });
  }
  return rows;
}
