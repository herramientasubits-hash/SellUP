import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { UnsafeSupabaseEnvironmentError } from '@/lib/supabase/env-guard.server';
import {
  parseStorageUsageReport,
  resolveIncludedDiskGb,
  type StorageUsageReport,
} from './storage-categories';

/**
 * Integraciones › Supabase — la base es la de SellUp, así que «conectar» no es
 * pegar una llave: las credenciales viven en las variables de entorno de
 * Vercel. Aquí se comprueba que respondan y se lee cuánto ocupa cada tabla.
 * Sólo lectura.
 */

export type SupabaseConnectionFailure = 'not_configured' | 'unreachable';
export type StorageReportFailure = 'missing_function' | 'error';

export interface SupabaseConnectionCheck {
  ok: boolean;
  latencyMs: number | null;
  failure: SupabaseConnectionFailure | null;
  /** Para el aviso: en palabras, sin la llave ni datos sensibles. */
  message: string | null;
}

export interface SupabaseOverview {
  host: string | null;
  projectRef: string | null;
  connection: SupabaseConnectionCheck;
  report: StorageUsageReport | null;
  reportFailure: StorageReportFailure | null;
  includedGb: number;
  checkedAt: string;
}

/** Código de PostgREST cuando la función no existe (falta aplicar la 162). */
const POSTGREST_FUNCTION_NOT_FOUND = 'PGRST202';

function readHost(): { host: string | null; projectRef: string | null } {
  try {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').host || null;
    const projectRef = host?.endsWith('.supabase.co') ? host.split('.')[0] : null;
    return { host, projectRef };
  } catch {
    return { host: null, projectRef: null };
  }
}

function adminClientOrFailure() {
  try {
    return { client: createSupabaseAdminClient(), failure: null } as const;
  } catch (error) {
    const message =
      error instanceof UnsafeSupabaseEnvironmentError
        ? 'Faltan las variables de Supabase en este entorno (o apuntan a Producción desde un entorno de prueba).'
        : 'No se pudo preparar la conexión con Supabase.';
    return { client: null, failure: message } as const;
  }
}

export async function checkSupabaseConnection(): Promise<SupabaseConnectionCheck> {
  const { client, failure } = adminClientOrFailure();
  if (!client) return { ok: false, latencyMs: null, failure: 'not_configured', message: failure };

  const startedAt = performance.now();
  try {
    const { error } = await client.from('roles').select('key', { head: true, count: 'exact' });
    const latencyMs = Math.round(performance.now() - startedAt);
    if (error) {
      console.error('[storage-usage] la prueba de conexión falló', { code: error.code, message: error.message });
      return { ok: false, latencyMs, failure: 'unreachable', message: 'Supabase respondió con un error. Revisa el estado del proyecto.' };
    }
    return { ok: true, latencyMs, failure: null, message: null };
  } catch (error) {
    console.error('[storage-usage] Supabase no respondió', error);
    return { ok: false, latencyMs: null, failure: 'unreachable', message: 'Supabase no respondió. Puede estar caído o en pausa.' };
  }
}

async function readStorageReport(): Promise<{ report: StorageUsageReport | null; failure: StorageReportFailure | null }> {
  const { client } = adminClientOrFailure();
  if (!client) return { report: null, failure: 'error' };

  const { data, error } = await client.rpc('sellup_storage_usage');
  if (error) {
    if (error.code === POSTGREST_FUNCTION_NOT_FOUND) return { report: null, failure: 'missing_function' };
    console.error('[storage-usage] no se pudo leer el tamaño de la base', { code: error.code, message: error.message });
    return { report: null, failure: 'error' };
  }

  const report = parseStorageUsageReport(data);
  if (!report) {
    console.error('[storage-usage] la función devolvió una forma inesperada');
    return { report: null, failure: 'error' };
  }
  return { report, failure: null };
}

export async function getSupabaseOverview(): Promise<SupabaseOverview> {
  const { host, projectRef } = readHost();
  const connection = await checkSupabaseConnection();
  const { report, failure } = connection.ok
    ? await readStorageReport()
    : { report: null, failure: null };

  return {
    host,
    projectRef,
    connection,
    report,
    reportFailure: failure,
    includedGb: resolveIncludedDiskGb(process.env.SUPABASE_DISK_INCLUDED_GB),
    checkedAt: new Date().toISOString(),
  };
}
