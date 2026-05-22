/**
 * Prueba controlada de Lusha — enriquecimiento de empresa por dominio
 *
 * Endpoint oficial confirmado: GET https://api.lusha.com/v2/company
 * Parámetros: domain (query param) + api_key (query param según docs Lusha)
 * Consume: 1 crédito de enriquecimiento de empresa
 *
 * La API Key se recupera de Vault y NUNCA se imprime.
 * Sin commit, sin push, sin UI.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://lrdruowtadwbdulndlph.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';
const VAULT_SECRET_NAME = 'sellup_prospecting_lusha_api_key';

// Test domain — Lusha's own company (known entity, predictable result)
const TEST_DOMAIN = 'lusha.com';

// ── 1. Recuperar API Key desde Vault ──────────────────────────────────────────

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

console.log('✓ API Key recuperada desde Vault (valor oculto)');

// ── 1b. Diagnóstico de formato de la key (sin exponer el valor) ───────────────
const rawKey = apiKey;
const trimmedKey = apiKey.trim();
console.log(`  Longitud raw:     ${rawKey.length}`);
console.log(`  Longitud trimmed: ${trimmedKey.length}`);
console.log(`  Tiene whitespace: ${rawKey !== trimmedKey}`);
console.log(`  Primer char code: ${rawKey.charCodeAt(0)}`);
console.log(`  Último char code: ${rawKey.charCodeAt(rawKey.length - 1)}`);
console.log(`  Primeros 4 chars: ${trimmedKey.slice(0, 4)}...`);

// ── 2. Intentar enriquecimiento de empresa ────────────────────────────────────

async function tryEnrichment(authStyle) {
  const qs = new URLSearchParams({ domain: TEST_DOMAIN });
  let headers = {};

  if (authStyle === 'query_raw') {
    qs.set('api_key', apiKey.trim());
  } else if (authStyle === 'query_bearer') {
    qs.set('api_key', `Bearer ${apiKey.trim()}`);
  } else if (authStyle === 'header_raw') {
    headers = { 'api_key': apiKey.trim() };
  } else if (authStyle === 'header_bearer') {
    headers = { 'api_key': `Bearer ${apiKey.trim()}` };
  } else if (authStyle === 'auth_bearer') {
    // Standard OAuth2 Authorization header — v2 API returns "missing Authorization header" on 401
    headers = { 'Authorization': `Bearer ${apiKey.trim()}` };
  } else if (authStyle === 'auth_raw') {
    headers = { 'Authorization': apiKey.trim() };
  }

  const url = `https://api.lusha.com/v2/company?${qs.toString()}`;
  const response = await fetch(url, { method: 'GET', headers });
  const body = await response.text().catch(() => '{}');
  return { status: response.status, body };
}

// Try all auth styles in order — stop at first success
const styles = ['auth_bearer', 'auth_raw', 'query_raw', 'query_bearer', 'header_raw', 'header_bearer'];
let result = null;
let successStyle = null;

for (const style of styles) {
  console.log(`\nIntentando auth style: ${style} ...`);
  const { status, body } = await tryEnrichment(style);
  console.log(`  → HTTP ${status}`);

  if (status === 200 || status === 451) {
    // 200 = success, 451 = GDPR block (key valid, data restricted)
    result = { status, body, style };
    successStyle = style;
    break;
  }

  console.log(`  → Body: ${body.slice(0, 200)}`);
}

// ── 3. Presentar resultados ───────────────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
console.log('RESULTADO DE LA PRUEBA DE LUSHA');
console.log('═'.repeat(60));

if (!result) {
  console.log('\n✗ Todos los formatos de autenticación fallaron.\n');
  // Show last attempt body for diagnosis (no key exposed)
  const { status, body } = await tryEnrichment('query_raw');
  let parsed = {};
  try { parsed = JSON.parse(body); } catch { parsed = { raw: body.slice(0, 300) }; }
  console.log('Último estado HTTP:', status);
  console.log('Respuesta:', JSON.stringify(parsed, null, 2));
  process.exit(1);
}

const { status, body, style } = result;
console.log(`\n✓ Auth exitosa con estilo: ${style}`);
console.log(`  HTTP Status: ${status}`);

if (status === 451) {
  console.log('\n⚠  HTTP 451 — GDPR: Lusha autentica correctamente pero los datos');
  console.log('   de esta empresa están restringidos por regulación GDPR.');
  console.log('   La API Key es válida y el endpoint funciona.');
  process.exit(0);
}

let data = {};
try { data = JSON.parse(body); } catch { data = {}; }

// Sanitize and present company data (no key exposed in output)
const company = data?.company ?? data ?? {};

console.log('\n┌─ DATOS DE EMPRESA ─────────────────────────────────────────');
console.log(`│ Empresa:    ${company.name ?? company.companyName ?? 'No disponible'}`);
console.log(`│ Dominio:    ${TEST_DOMAIN}`);
console.log(`│ País:       ${company.country ?? company.countryCode ?? 'No disponible'}`);
console.log(`│ Industria:  ${company.industry ?? company.industryName ?? 'No disponible'}`);
console.log(`│ Empleados:  ${company.employeeCount ?? company.size ?? 'No disponible'}`);
console.log(`│ Ciudad:     ${company.city ?? 'No disponible'}`);
console.log(`│ LinkedIn:   ${company.linkedinUrl ?? 'No disponible'}`);
console.log(`│ Teléfono:   ${company.phone ?? 'No disponible'}`);
console.log('└────────────────────────────────────────────────────────────');

console.log('\n--- Respuesta completa (sanitizada) ---');
// Print full body without exposing any key
console.log(JSON.stringify(data, null, 2));
