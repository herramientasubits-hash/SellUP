/**
 * Prueba controlada de Apollo.io — búsqueda de organizaciones
 *
 * Reutiliza el mismo patrón de Vault de apollo-connection.ts.
 * Límite: 3 resultados. Sin paginación. Sin commit/push.
 * La API Key se recupera de Vault y NUNCA se imprime.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://lrdruowtadwbdulndlph.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';
const VAULT_SECRET_NAME = 'sellup_prospecting_apollo_api_key';

// ── 1. Recuperar API Key desde Vault (mismo patrón que getApolloApiKey()) ──

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const { data: apiKey, error: vaultError } = await admin.rpc(
  'get_vault_secret_decrypted',
  { p_name: VAULT_SECRET_NAME }
);

if (vaultError || !apiKey) {
  console.error('ERROR: No se pudo recuperar la API Key desde Vault.');
  console.error('Código:', vaultError?.code ?? 'NO_KEY');
  process.exit(1);
}

// Confirmar recuperación sin exponer el valor
console.log('✓ API Key recuperada desde Vault (longitud:', apiKey.length, 'chars)');

// ── 2. Búsqueda controlada — máx. 3 resultados ────────────────────────────
// Endpoint: POST https://api.apollo.io/api/v1/mixed_companies/search
// Parámetros conservadores: país Colombia, página 1, per_page 3.

const searchPayload = {
  page: 1,
  per_page: 3,
  organization_locations: ['Colombia'],
};

console.log('\nEjecutando búsqueda controlada...');
console.log('Endpoint: POST https://api.apollo.io/api/v1/mixed_companies/search');
console.log('Filtros:', JSON.stringify(searchPayload));

let response;
try {
  response = await fetch('https://api.apollo.io/api/v1/mixed_companies/search', {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(searchPayload),
  });
} catch (netErr) {
  console.error('ERROR DE RED:', netErr.message);
  process.exit(1);
}

const statusCode = response.status;
console.log('\nHTTP Status:', statusCode);

// ── 3. Procesar respuesta ─────────────────────────────────────────────────

if (!response.ok) {
  const rawBody = await response.text().catch(() => '');
  // Sanitizar: no exponer la key si aparece en el cuerpo del error
  const sanitized = rawBody.replace(apiKey, '[REDACTED]').slice(0, 500);

  console.error('\n=== BÚSQUEDA FALLÓ ===');
  console.error('Status:', statusCode);
  console.error('Body (sanitizado):', sanitized);

  // Clasificación del error
  if (statusCode === 401) {
    console.error('CLASIFICACIÓN: API Key válida para health check pero no autorizada para este endpoint.');
  } else if (statusCode === 403) {
    console.error('CLASIFICACIÓN: Endpoint no permitido por plan o tipo de key.');
  } else if (statusCode === 422) {
    console.error('CLASIFICACIÓN: Error de payload/parámetros.');
  } else if (statusCode === 429) {
    console.error('CLASIFICACIÓN: Rate limit alcanzado.');
  } else {
    console.error('CLASIFICACIÓN: Otro error técnico — HTTP', statusCode);
  }

  process.exit(0);
}

const data = await response.json();
// mixed_companies/search returns `accounts` (not `organizations`) for basic plans
const organizations = data?.accounts ?? data?.organizations ?? [];
const total = data?.pagination?.total_entries ?? data?.total_entries ?? '?';

console.log('\n=== BÚSQUEDA EXITOSA ===');
console.log('Total disponible en Apollo:', total);
console.log('Resultados recibidos:', organizations.length);

// ── 4. Tabla sanitizada ───────────────────────────────────────────────────

const rows = organizations.slice(0, 3).map((org) => ({
  empresa: org.name ?? 'No disponible',
  sitio_web: org.website_url ?? org.primary_domain ?? 'No disponible',
  pais: org.country ?? org.hq_location?.country ?? 'No disponible',
  industria: org.industry ?? 'No disponible',
  empleados: org.estimated_num_employees ?? org.employee_count ?? 'No disponible',
}));

console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
console.log('│ Empresa         │ Sitio web            │ País      │ Industria     │ Empleados │');
console.log('├─────────────────────────────────────────────────────────────────────┤');
for (const r of rows) {
  const e = String(r.empresa).slice(0, 22).padEnd(22);
  const w = String(r.sitio_web).slice(0, 22).padEnd(22);
  const c = String(r.pais).slice(0, 12).padEnd(12);
  const i = String(r.industria).slice(0, 18).padEnd(18);
  const emp = String(r.empleados).slice(0, 10).padEnd(10);
  console.log(`│ ${e} │ ${w} │ ${c} │ ${i} │ ${emp} │`);
}
console.log('└─────────────────────────────────────────────────────────────────────┘');

// ── 5. Diagnóstico de créditos ────────────────────────────────────────────
const creditsConsumed = response.headers.get('x-monthly-usage') ??
  response.headers.get('x-rate-limit-remaining') ??
  null;

console.log('\nHeader de uso de créditos:', creditsConsumed ?? 'No reportado por Apollo en headers');
console.log('\nNOTA: Organization Search puede consumir créditos según el plan Apollo.');
console.log('      Verificar en Apollo dashboard → Settings → API Usage.\n');
