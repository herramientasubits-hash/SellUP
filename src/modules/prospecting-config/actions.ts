'use server';

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { ProspectingProvider, ProspectingStats } from './types';

// ============================================================
// Cliente admin (service role) — solo lectura de catálogo
// ============================================================
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';

function getAdminSupabase() {
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

// ============================================================
// Lectura del catálogo de proveedores
// ============================================================

/**
 * Devuelve todos los proveedores de prospección/enriquecimiento.
 * Ordenados por lifecycle_status desc para mostrar 'prepared' antes que 'planned'.
 *
 * Extensión futura: cuando se implemente conexión real, agregar JOIN con
 * prospecting_provider_connections para mostrar estado operativo.
 */
export async function getAllProspectingProviders(): Promise<ProspectingProvider[]> {
  const admin = getAdminSupabase();

  const { data, error } = await admin
    .from('prospecting_providers')
    .select('*')
    .order('lifecycle_status', { ascending: false }) // 'prepared' antes que 'planned'
    .order('name');

  if (error || !data) return [];

  return data as ProspectingProvider[];
}

/**
 * Devuelve estadísticas agregadas del catálogo de proveedores.
 *
 * Extensión futura: `active_provider` se populará cuando se implemente la
 * selección de proveedor activo en la tabla de configuración global.
 */
export async function getProspectingStats(): Promise<ProspectingStats> {
  const providers = await getAllProspectingProviders();

  const total = providers.length;
  const prepared = providers.filter(
    (p) => p.lifecycle_status === 'prepared' || p.lifecycle_status === 'connected'
  ).length;

  // Extensión futura: consultar tabla de config global para active_provider_key
  const activeProvider = providers.find((p) => p.lifecycle_status === 'connected');

  return {
    total,
    prepared,
    active_provider: activeProvider?.provider_key ?? null,
  };
}

/**
 * Helper para uso futuro por automatizaciones y batch jobs.
 * Retorna la configuración del proveedor activo, o null si no hay ninguno.
 *
 * Cuando se seleccione un proveedor, los flujos de generación de prospectos,
 * enriquecimiento de empresas y búsqueda de decisores usarán este helper
 * para saber qué API invocar — sin lógica quemada en código.
 *
 * TODO (fase futura): implementar cuando negocio defina el proveedor activo.
 */
export async function getActiveProspectingProvider(): Promise<ProspectingProvider | null> {
  const admin = getAdminSupabase();

  const { data } = await admin
    .from('prospecting_providers')
    .select('*')
    .eq('lifecycle_status', 'connected')
    .eq('is_available_for_selection', true)
    .single();

  return (data as ProspectingProvider) ?? null;
}
