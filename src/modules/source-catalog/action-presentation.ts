import type { ConnectionMode } from '@/server/agents/prospecting-toolkit/types';

/**
 * Presentación de la columna "Acción" del catálogo de fuentes.
 *
 * Traduce el estado técnico de conexión de una fuente al control de acción que
 * debe mostrar la UI. Es una función pura de presentación: NO dispara ninguna
 * conexión, credencial ni escritura — todos los `kind` abren el mismo detalle
 * de solo lectura en el cliente.
 *
 * Diseñada para extenderse a medida que se añaden estados operativos (p.ej.
 * `backend_connected` para fuentes en expansión limitada manual como EC-SCVS).
 * Añadir un `case` aquí es la forma soportada de introducir una nueva acción
 * visual.
 */
export type SourceActionKind = 'connect' | 'view_signals' | 'view_status' | 'view_detail';

export type SourceActionPresentation = {
  kind: SourceActionKind;
  label: string;
};

export function getSourceActionPresentation(input: {
  connectionMode: ConnectionMode;
}): SourceActionPresentation {
  switch (input.connectionMode) {
    // Sin conexión: única acción que ofrece iniciar una conexión real.
    case 'not_connected':
      return { kind: 'connect', label: 'Conectar' };
    // Señal read-only: revisar señales capturadas.
    case 'read_only_signal':
      return { kind: 'view_signals', label: 'Ver señales' };
    // Backend conectado (snapshot productivo + adapter): revisar estado de la
    // integración sin volver a conectar. No dispara conexión.
    case 'backend_connected':
      return { kind: 'view_status', label: 'Ver estado' };
    default:
      return { kind: 'view_detail', label: 'Ver detalle' };
  }
}
