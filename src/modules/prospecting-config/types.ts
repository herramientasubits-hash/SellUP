// ============================================================
// Tipos: Proveedores de prospección y enriquecimiento
// ============================================================
// Extensión futura:
//   - Agregar ProspectingProviderConnection cuando se implemente
//     la conexión real con el proveedor activo.
//   - Agregar ActiveProspectingConfig cuando se seleccione un
//     proveedor activo para automatizaciones y batch jobs.
// ============================================================

export type ProviderType =
  | 'prospecting'
  | 'enrichment'
  | 'prospecting_and_enrichment';

export type LifecycleStatus =
  | 'planned'    // Contemplado, sin evaluación de integración
  | 'prepared'   // Arquitectura lista, pendiente decisión de negocio
  | 'connected'  // Conectado y operativo (uso futuro)
  | 'inactive';  // Deshabilitado tras haber estado activo (uso futuro)

export interface ProspectingProvider {
  id: string;
  provider_key: string;
  name: string;
  description: string | null;
  provider_type: ProviderType;
  lifecycle_status: LifecycleStatus;
  is_available_for_selection: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProspectingStats {
  total: number;
  prepared: number;         // lifecycle_status IN ('prepared', 'connected')
  active_provider: string | null;  // provider_key del proveedor activo, null si ninguno
}
