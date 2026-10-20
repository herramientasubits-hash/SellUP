/**
 * AGENT1-AUDIT-WS1 — la revalidación de una importación pasa el usuario INTERNO.
 *
 * `validateImportedCandidatesBatch` escribe `prospect_enrichment_jobs.user_id`
 * (FK a `internal_users(id)`). La ruta le pasaba el id de AUTH: la FK fallaba y
 * los trabajos de enriquecimiento no se encolaban, en silencio.
 *
 * Guarda estática (la ruta usa la sesión por cookies).
 *
 * Correr: node --import tsx --test src/app/api/prospect-batches/revalidate-candidates/__tests__/revalidate-candidates-internal-user-static.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const route = readFileSync(
  path.join(process.cwd(), 'src/app/api/prospect-batches/revalidate-candidates/route.ts'),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('revalidate-candidates — usuario interno', () => {
  it('resuelve el usuario interno ACTIVO por auth_user_id', () => {
    assert.match(
      route,
      /from\('internal_users'\)[\s\S]*?\.eq\('auth_user_id', user\.id\)[\s\S]*?\.eq\('access_status', 'active'\)/,
    );
    assert.match(route, /status: 403/);
  });

  it('pasa internalUser.id, nunca el id de auth', () => {
    assert.match(route, /validateImportedCandidatesBatch\(batchId, internalUser\.id, supabase\)/);
    assert.doesNotMatch(route, /validateImportedCandidatesBatch\(batchId, user\.id/);
  });
});
