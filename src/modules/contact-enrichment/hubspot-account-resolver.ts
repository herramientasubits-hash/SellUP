// Agente 2A — HubSpot Account Resolver (Hito 17A.9H)
// Lógica pura para resolver o crear una cuenta SellUp a partir de datos de un
// candidato HubSpot-only (run.account_id = null, hubspot_company_id presente).
// Recibe deps inyectadas: sin Supabase directo, testeable en Node sin DB.

export type AccountResolutionOutcome =
  | 'existing_by_hubspot'
  | 'existing_by_domain_linked'
  | 'existing_by_domain'
  | 'created';

export interface HubSpotAccountResolutionInput {
  hubspot_company_id: string;
  company_name: string | null;
  company_domain: string | null;
  run_id: string | null;
  /** Código ISO-2 del país (MX, CO, CL…) resuelto desde el run. */
  country_code: string | null;
}

export interface HubSpotAccountResolutionDeps {
  /** Busca cuenta activa por hubspot_company_id exacto. */
  findByHubspotId: (hubspotId: string) => Promise<{ id: string } | null>;
  /** Busca cuenta activa por domain normalizado. */
  findByDomain: (domain: string) => Promise<{ id: string; hubspot_company_id: string | null } | null>;
  /** Crea una cuenta SellUp mínima. */
  createAccount: (input: {
    name: string;
    domain: string | null;
    website: string | null;
    hubspot_company_id: string;
    run_id: string | null;
    country_code: string | null;
  }) => Promise<{ id: string } | { error: string }>;
  /** Vincula un hubspot_company_id a una cuenta existente. */
  linkHubspotId: (accountId: string, hubspotId: string) => Promise<void>;
  /**
   * Actualiza country_code de una cuenta existente solo si está vacío.
   * La implementación debe usar `WHERE country_code IS NULL` para no sobrescribir.
   */
  updateAccountCountryCode?: (accountId: string, countryCode: string) => Promise<void>;
}

export type AccountResolutionSuccess = {
  accountId: string;
  outcome: AccountResolutionOutcome;
  countryCodeApplied: string | null;
  countryResolutionSource: 'contact_enrichment_run' | 'unknown';
};

/** Normaliza un dominio crudamente extraído de la BD (elimina protocolo/www). */
export function normalizeAccountDomain(raw: string): string | null {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0];
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Resuelve o crea una cuenta SellUp para un candidato HubSpot-only.
 *
 * Prioridad:
 *  1. Cuenta existente por hubspot_company_id.
 *  2. Cuenta existente por dominio normalizado (vincula hubspot_company_id si falta).
 *  3. Crea cuenta SellUp mínima con source=hubspot + metadata de trazabilidad.
 *
 * En todos los casos intenta preservar country_code cuando está disponible en el run.
 * Si la cuenta existente ya tiene country_code, no lo sobrescribe (la dep usa WHERE IS NULL).
 *
 * Devuelve `{ error }` si la creación falla o faltan datos mínimos.
 */
export async function resolveOrCreateAccountForHubSpotCandidate(
  input: HubSpotAccountResolutionInput,
  deps: HubSpotAccountResolutionDeps,
): Promise<AccountResolutionSuccess | { error: string }> {
  const { hubspot_company_id, company_name, company_domain, run_id, country_code } = input;

  const countrySource: AccountResolutionSuccess['countryResolutionSource'] =
    country_code ? 'contact_enrichment_run' : 'unknown';

  // 1. Buscar por hubspot_company_id exacto.
  const byHubspot = await deps.findByHubspotId(hubspot_company_id);
  if (byHubspot) {
    if (country_code && deps.updateAccountCountryCode) {
      await deps.updateAccountCountryCode(byHubspot.id, country_code);
    }
    return {
      accountId: byHubspot.id,
      outcome: 'existing_by_hubspot',
      countryCodeApplied: country_code,
      countryResolutionSource: countrySource,
    };
  }

  // 2. Buscar por dominio normalizado.
  const normDomain = company_domain ? normalizeAccountDomain(company_domain) : null;
  if (normDomain) {
    const byDomain = await deps.findByDomain(normDomain);
    if (byDomain) {
      if (!byDomain.hubspot_company_id) {
        await deps.linkHubspotId(byDomain.id, hubspot_company_id);
      }
      if (country_code && deps.updateAccountCountryCode) {
        await deps.updateAccountCountryCode(byDomain.id, country_code);
      }
      const outcome = byDomain.hubspot_company_id
        ? 'existing_by_domain'
        : 'existing_by_domain_linked';
      return {
        accountId: byDomain.id,
        outcome,
        countryCodeApplied: country_code,
        countryResolutionSource: countrySource,
      };
    }
  }

  // 3. Crear cuenta SellUp mínima.
  if (!company_name?.trim()) {
    return { error: 'No se puede crear cuenta SellUp sin nombre de empresa' };
  }

  const website = normDomain ? `https://${normDomain}` : null;
  const created = await deps.createAccount({
    name: company_name.trim(),
    domain: normDomain,
    website,
    hubspot_company_id,
    run_id,
    country_code,
  });

  if ('error' in created) return { error: created.error };
  return {
    accountId: created.id,
    outcome: 'created',
    countryCodeApplied: country_code,
    countryResolutionSource: countrySource,
  };
}
