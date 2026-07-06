/**
 * Helpers semánticos para decidir visibilidad de paneles de conexión en el
 * Source Catalog (drawer y full page).
 *
 * Centraliza la lógica en un único lugar para evitar divergencia entre ambas vistas.
 */

interface SourceConnectionFields {
  operationalStatus?: string;
  aiFlowStatus?: string;
  connectionMode?: string;
}

/**
 * Devuelve true solo para fuentes de referencia manual pura:
 *   operationalStatus = manual_signal_only
 *   connectionMode    = not_applicable
 *
 * Excluye sv_comprasal (signal_connected_read_only + read_only_signal) y cualquier
 * fuente con un connection mode activo aunque su operationalStatus sea manual_signal_only.
 */
export function isManualSignalOnly(source: SourceConnectionFields): boolean {
  return (
    source.operationalStatus === 'manual_signal_only' &&
    source.connectionMode === 'not_applicable'
  );
}

/**
 * Devuelve true para fuentes que NO necesitan paneles genéricos de conexión
 * (SourceCredentialPanel, TestConnectionPanel, ConnectionTestHistory).
 *
 * Connection modes cubiertos:
 *   - not_applicable      → referencia manual pura (hn_ccic, hn_ccit)
 *   - read_only_signal    → señal read-only con revisión humana (sv_comprasal)
 *   - read_only_snapshot  → snapshot persistido (hn_contrataciones_abiertas, etc.)
 *   - dry_run + not_persisted → fuentes en validación dry-run
 */
export function shouldSkipGenericConnectionPanels(source: SourceConnectionFields): boolean {
  const cm = source.connectionMode;
  return (
    cm === 'not_applicable' ||
    cm === 'read_only_signal' ||
    cm === 'read_only_snapshot' ||
    (source.aiFlowStatus === 'dry_run_validated' && cm === 'not_persisted')
  );
}
