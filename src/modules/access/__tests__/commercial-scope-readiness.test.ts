// Preparación de ENABLE_COMMERCIAL_SCOPE y la ruta que la publica.
// La ruta llama a createClient() (cookies de next/headers): el cálculo se prueba en
// el helper puro y el control de acceso con una guarda estática sobre route.ts.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { computeCommercialScopeReadiness } from '../commercial-scope-readiness';

describe('computeCommercialScopeReadiness', () => {
  it('clasifica a cada usuario activo como quedaría con la bandera encendida', () => {
    const report = computeCommercialScopeReadiness([
      { id: 'a', roleKey: 'admin', groupId: null, managerId: null },
      { id: 'l1', roleKey: 'commercial_lead', groupId: 'g1', managerId: null },
      { id: 'l2', roleKey: 'commercial_lead', groupId: null, managerId: null },
      { id: 'l3', roleKey: 'commercial_lead', groupId: null, managerId: null },
      { id: 'v1', roleKey: 'seller', groupId: 'g1', managerId: 'l3' },
      { id: 'x', roleKey: null, groupId: null, managerId: null },
    ]);
    assert.equal(report.active_users, 6);
    assert.equal(report.admins, 1);
    // l1 tiene grupo; l3 tiene un reporte directo; l2 no tiene ni grupo ni reportes.
    assert.equal(report.leaders_with_team, 2);
    assert.equal(report.leaders_without_team, 1);
    assert.equal(report.self_only, 2);
    assert.equal(report.without_role, 1);
    assert.equal(report.non_admin_without_group, 3);
  });

  it('sin usuarios, todo en cero', () => {
    const report = computeCommercialScopeReadiness([]);
    assert.deepEqual(Object.values(report), [0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('GET /api/debug/commercial-scope-config — contrato estático', () => {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');
  const source = readFileSync(
    path.join(repoRoot, 'src/app/api/debug/commercial-scope-config/route.ts'),
    'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('exige sesión (401) y admin (403) antes de leer nada', () => {
    const authAt = code.indexOf('status: 401');
    const adminAt = code.indexOf('status: 403');
    const readAt = code.indexOf('computeCommercialScopeReadiness(await loadActiveUsers())');
    assert.ok(code.includes("supabase.rpc('is_admin'"));
    assert.ok(authAt > 0 && adminAt > authAt && readAt > adminAt);
  });

  it('nunca devuelve el valor crudo de la variable ni datos personales', () => {
    assert.doesNotMatch(code, /value:\s*process\.env/);
    assert.doesNotMatch(code, /email|full_name/);
    assert.match(code, /configured: isEnvFlagConfigured\(process\.env\[COMMERCIAL_SCOPE_FLAG\]\)/);
    assert.match(code, /enabled: isCommercialScopeEnabled\(\)/);
  });

  it('no se cachea y no escribe', () => {
    assert.match(code, /'Cache-Control': 'no-store'/);
    assert.doesNotMatch(code, /\.(insert|update|upsert|delete)\(/);
  });
});
