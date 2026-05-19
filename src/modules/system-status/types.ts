// ============================================================
// Types: Estado del sistema y auditoría administrativa
// ============================================================
// Este módulo agrega datos de salud operativa de los módulos
// de configuración existentes y normaliza eventos de las tablas
// de auditoría (access_audit, ai_provider_audit, integration_audit)
// en una vista administrativa unificada.
// ============================================================

/** Estado derivado de un componente de configuración */
export type ComponentStatus = 'ok' | 'warning' | 'attention' | 'not_configured';

// ----------------------------------------------------------------
// Resumen ejecutivo — tarjetas superiores
// ----------------------------------------------------------------

export interface SystemHealthSummary {
  /** Componentes con configuración activa y sin errores */
  configured_components: number;
  /** Componentes con error, sin probar o sin configurar */
  components_with_issues: number;
  /** Automatizaciones en modo automático */
  automatic_automations: number;
  /** Solicitudes de acceso pendientes de aprobación */
  pending_access_requests: number;
}

// ----------------------------------------------------------------
// Salud detallada por componente
// ----------------------------------------------------------------

export interface AIProviderHealth {
  key: string;
  name: string;
  /** true si credentials_status === 'configured' en ai_providers */
  has_credential: boolean;
  /** not_configured | not_tested | connected | error | disconnected */
  connection_status: string;
  last_tested_at: string | null;
  /** true si este proveedor está en ai_active_config */
  is_active_provider: boolean;
}

export interface HubSpotHealth {
  credentials_status: 'stored' | 'missing';
  connection_status: 'not_tested' | 'connected' | 'error' | 'disconnected';
  last_tested_at: string | null;
  hub_id: number | null;
  last_connection_error: string | null;
}

export interface ConfigurationHealthDetails {
  ai_providers: AIProviderHealth[];
  active_ai: {
    provider_name: string | null;
    model_name: string | null;
    updated_at: string | null;
  } | null;
  hubspot: HubSpotHealth;
  prospecting: {
    total: number;
    prepared: number;
    active_provider: string | null;
  };
  automations: {
    total: number;
    manual: number;
    suggested: number;
    automatic: number;
  };
}

// ----------------------------------------------------------------
// Riesgos y pendientes administrativos
// ----------------------------------------------------------------

export type RiskSeverity = 'attention' | 'pending' | 'ok';

export interface AdminRisk {
  id: string;
  severity: RiskSeverity;
  message: string;
  action_href: string;
}

// ----------------------------------------------------------------
// Feed de actividad administrativa unificada
// ----------------------------------------------------------------

export type AdminActivitySource = 'users' | 'integrations' | 'ai';

export interface AdminActivityEvent {
  id: string;
  source: AdminActivitySource;
  event_type: string;
  /** Etiqueta legible en español */
  label: string;
  /** Contexto adicional (nombre del recurso afectado, transición de estado, etc.) */
  description: string | null;
  created_at: string;
}
