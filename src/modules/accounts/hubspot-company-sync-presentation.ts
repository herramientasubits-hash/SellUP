/**
 * Lo que la ficha de una EMPRESA dice sobre HubSpot, en un solo sitio (puro).
 *
 * Lo leen la página de detalle de la empresa y el recorrido del Pipeline:
 * extraído para que las dos superficies no puedan contradecirse.
 *
 * El estado vive en `accounts.hubspot_company_id` + `metadata.hubspot_sync_status`
 * (escrito al aprobar el prospecto y por la revisión de coincidencias).
 */

export type HubSpotCompanyPresentationStatus =
  | 'active'
  | 'inactive'
  | 'pending'
  | 'completed'
  | 'warning'
  | 'error'
  | 'info'
  | 'neutral';

export interface HubSpotCompanyPresentation {
  label: string;
  status: HubSpotCompanyPresentationStatus;
}

/** Por qué una empresa sin ficha en HubSpot todavía no la tiene. */
export const HUBSPOT_SYNC_STATUS: Record<string, HubSpotCompanyPresentation> = {
  blocked_duplicate: { label: 'No se creó: ya existe en HubSpot', status: 'warning' },
  blocked_inactive_or_liquidation: {
    label: 'No se envió: la empresa parece inactiva o en liquidación',
    status: 'warning',
  },
  failed_create: { label: 'No se pudo crear en HubSpot', status: 'error' },
  failed_lookup: { label: 'No se pudo comprobar en HubSpot', status: 'error' },
  skipped_flag_off: { label: 'El envío a HubSpot está desactivado', status: 'neutral' },
  skipped_no_connection: { label: 'HubSpot no está conectado', status: 'neutral' },
  skipped_missing_write_scope: { label: 'Falta permiso para escribir en HubSpot', status: 'neutral' },
  skipped_rollback: { label: 'No se envía: la empresa no está operativa', status: 'neutral' },
};

export const HUBSPOT_COMPANY_SYNCED_LABEL = 'Sincronizada' as const;
export const HUBSPOT_COMPANY_NOT_YET_LABEL = 'Aún no está en HubSpot' as const;

export function resolveHubSpotPresentation(
  hubspotCompanyId: string | null | undefined,
  metadata: Record<string, unknown>,
): HubSpotCompanyPresentation {
  if (hubspotCompanyId) return { label: HUBSPOT_COMPANY_SYNCED_LABEL, status: 'active' };
  const syncStatus = metadata.hubspot_sync_status;
  const known = typeof syncStatus === 'string' ? HUBSPOT_SYNC_STATUS[syncStatus] : undefined;
  return known ?? { label: HUBSPOT_COMPANY_NOT_YET_LABEL, status: 'neutral' };
}

/**
 * ¿Está la empresa sincronizada con HubSpot? Exige las dos cosas: la ficha
 * vinculada Y el estado `synced`. Una empresa con ficha pero con estado
 * `pending_match_review` reclama atención igual.
 */
export function isAccountHubSpotSynced(
  hubspotCompanyId: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!hubspotCompanyId) return false;
  const syncStatus = metadata?.hubspot_sync_status;
  // Fichas vinculadas antes de que existiera el estado: sin estado escrito, el vínculo basta.
  if (syncStatus === undefined || syncStatus === null) return true;
  return syncStatus === 'synced';
}

/** La `metadata` de una cuenta como objeto plano, o `{}` si no lo es. */
export function safeAccountMetadata(metadata: unknown): Record<string, unknown> {
  return metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}
