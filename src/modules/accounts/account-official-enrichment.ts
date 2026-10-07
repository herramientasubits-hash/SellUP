// HUBSPOT-ACCOUNT-SYNC-1 — Completar una empresa con las fuentes oficiales del Agente 1
// (núcleo puro)
//
// Lo que ni HubSpot ni la búsqueda trajeron (NIT, razón social, tamaño) se intenta con los
// mismos catálogos oficiales gratuitos que usa el Agente 1 al importar prospectos. Sólo una
// identidad FUERTE completa columnas, y nunca se pisa un valor existente.

export interface AccountForOfficialEnrichment {
  tax_identifier: string | null;
  tax_identifier_type: string | null;
  legal_name: string | null;
  company_size: string | null;
}

export interface OfficialEnrichmentOutcomeLike {
  strongIdentityAvailable: boolean;
  typedColumns: {
    tax_identifier: string | null;
    tax_identifier_type: string | null;
    legal_name: string | null;
  };
  metadata: { workforce?: { workers?: number | null } | null };
}

export type OfficialEnrichmentPatch = Partial<Record<keyof AccountForOfficialEnrichment, string>>;

function isBlank(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

/** ¿Vale la pena consultar las fuentes oficiales? Sólo si falta algo que ellas dan. */
export function needsOfficialEnrichment(
  account: AccountForOfficialEnrichment & { country_code: string | null },
): boolean {
  if (!account.country_code) return false;
  return isBlank(account.tax_identifier) || isBlank(account.legal_name) || isBlank(account.company_size);
}

export function buildOfficialEnrichmentPatch(
  account: AccountForOfficialEnrichment,
  outcome: OfficialEnrichmentOutcomeLike | null,
): OfficialEnrichmentPatch {
  if (!outcome?.strongIdentityAvailable) return {};
  const patch: OfficialEnrichmentPatch = {};
  const { tax_identifier, tax_identifier_type, legal_name } = outcome.typedColumns;
  // El NIT y su tipo viajan juntos: no se completa el tipo de un NIT que no vino de aquí.
  if (isBlank(account.tax_identifier) && tax_identifier) {
    patch.tax_identifier = tax_identifier;
    if (tax_identifier_type) patch.tax_identifier_type = tax_identifier_type;
  }
  if (isBlank(account.legal_name) && legal_name) patch.legal_name = legal_name;
  const workers = outcome.metadata.workforce?.workers;
  if (isBlank(account.company_size) && typeof workers === 'number' && workers > 0) {
    patch.company_size = String(Math.round(workers));
  }
  return patch;
}
