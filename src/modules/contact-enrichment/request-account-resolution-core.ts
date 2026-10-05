// Agente 2A — Cuenta SellUp al crear la request (AGENT2A-HUBSPOT-ID-RESOLUTION)
//
// Problema: una empresa confirmada desde HubSpot (con Company ID pero sin cuenta
// SellUp) creaba la request con `account_id = null`. La búsqueda de contactos corría,
// pero la cuenta no aparecía en Empresas, Lusha no podía ejecutarse (exige
// `account_id`) y la cuenta solo se creaba al APROBAR el primer candidato.
//
// Ahora la cuenta se resuelve ANTES de crear la request, con la misma lógica que ya
// usaba la aprobación (`resolveOrCreateAccountForHubSpotCandidate`):
//   1. cuenta SellUp por hubspot_company_id,
//   2. cuenta SellUp por dominio (y se le vincula el ID si no lo tenía),
//   3. cuenta nueva con los datos de HubSpot.
//
// Garantías:
//   · NUNCA bloquea el enriquecimiento: cualquier fallo devuelve el `account_id`
//     original (null) y la búsqueda sigue como antes.
//   · Solo CREA cuentas para empresas confirmadas por HubSpot (`source: 'hubspot'`).
//     Una empresa «manual» con un ID tecleado solo se vincula a una cuenta que ya
//     exista: no se crea una cuenta cuyo nombre sea un número sin verificar.
//   · Sin red de proveedores: solo lecturas/escrituras en `accounts`.

import {
  resolveOrCreateAccountForHubSpotCandidate,
  type AccountResolutionOutcome,
  type HubSpotAccountResolutionDeps,
} from './hubspot-account-resolver';

export interface RequestAccountResolutionInput {
  source: 'sellup' | 'hubspot' | 'manual';
  sellupAccountId?: string | null;
  hubspotCompanyId?: string | null;
  name: string;
  domain?: string | null;
  countryCode?: string | null;
}

export type RequestAccountResolution =
  | { accountId: string | null; outcome: 'already_linked' | 'not_applicable' }
  | { accountId: string; outcome: AccountResolutionOutcome }
  | { accountId: null; outcome: 'failed'; reason: string };

export const ACCOUNT_CREATION_NOT_ALLOWED = 'account_creation_not_allowed';

/** ISO-2 válido o null — la columna `country_code` no admite texto libre («Chile»). */
function isoCountryOrNull(code: string | null | undefined): string | null {
  const c = code?.trim().toUpperCase() ?? '';
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

export async function resolveAccountForEnrichmentRequest(
  input: RequestAccountResolutionInput,
  deps: HubSpotAccountResolutionDeps,
): Promise<RequestAccountResolution> {
  if (input.sellupAccountId) {
    return { accountId: input.sellupAccountId, outcome: 'already_linked' };
  }
  const hubspotCompanyId = input.hubspotCompanyId?.trim();
  if (!hubspotCompanyId) {
    return { accountId: null, outcome: 'not_applicable' };
  }

  const allowCreate = input.source === 'hubspot';
  const effectiveDeps: HubSpotAccountResolutionDeps = allowCreate
    ? deps
    : { ...deps, createAccount: async () => ({ error: ACCOUNT_CREATION_NOT_ALLOWED }) };

  try {
    const resolved = await resolveOrCreateAccountForHubSpotCandidate(
      {
        hubspot_company_id: hubspotCompanyId,
        company_name: input.name,
        company_domain: input.domain ?? null,
        run_id: null,
        country_code: isoCountryOrNull(input.countryCode),
      },
      effectiveDeps,
    );
    if ('error' in resolved) {
      return { accountId: null, outcome: 'failed', reason: resolved.error };
    }
    return { accountId: resolved.accountId, outcome: resolved.outcome };
  } catch (err) {
    return {
      accountId: null,
      outcome: 'failed',
      reason: err instanceof Error ? err.message : 'unknown_error',
    };
  }
}
