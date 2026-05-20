// ============================================================
// Tipos: Proveedores de prospección y enriquecimiento
// ============================================================

export type ProviderType =
  | 'prospecting'
  | 'enrichment'
  | 'prospecting_and_enrichment';

export type LifecycleStatus =
  | 'planned'    // Contemplado, sin evaluación de integración
  | 'prepared'   // Arquitectura lista, pendiente decisión de negocio
  | 'connected'  // Conectado y operativo
  | 'inactive';  // Deshabilitado tras haber estado activo

export type CredentialsStatus = 'missing' | 'stored';

export type ConnectionStatus =
  | 'not_connected'
  | 'not_tested'
  | 'connected'
  | 'error'
  | 'disconnected';

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

export interface ProspectingProviderConnection {
  id: string;
  provider_id: string;
  vault_secret_id: string | null;
  credentials_status: CredentialsStatus;
  connection_status: ConnectionStatus;
  last_tested_at: string | null;
  last_connected_at: string | null;
  last_connection_error: string | null;
  configured_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProspectingStats {
  total: number;
  prepared: number;         // lifecycle_status IN ('prepared', 'connected')
  active_provider: string | null;  // provider_key del proveedor activo, null si ninguno
}
