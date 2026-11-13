/**
 * Migración 166 (RLS por alcance): los lugares que DEBEN leer o escribir fuera del alcance
 * de quien pide lo hacen con el cliente de servicio, después de comprobar el alcance.
 * Con la sesión, la RLS nueva los dejaría ciegos (duplicados, «no contactar») o los haría
 * fallar (reasignar a alguien de fuera). Auditoría del 13-11.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

/** El cuerpo de una función (hasta la siguiente función de primer nivel). */
function body(src: string, signature: string): string {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `no encuentro ${signature}`);
  const next = src.slice(start + signature.length).search(/\n(export )?(async )?function /);
  return next < 0 ? src.slice(start) : src.slice(start, start + signature.length + next);
}

describe('166 — aprobar no duplica la empresa de otro equipo', () => {
  const fn = body(read('src/modules/prospect-batches/actions.ts'), 'async function convertClaimedCandidate(');

  it('🔴 la cuenta existente se busca, se lee y se actualiza con el cliente de servicio', () => {
    assert.match(fn, /const accountsDb = createSupabaseAdminClient\(\);/);
    assert.match(fn, /findExistingAccountForCandidate\(accountsDb, \{/);
    assert.equal((fn.match(/await accountsDb\s*\n\s*\.from\('accounts'\)/g) ?? []).length, 3);
    assert.doesNotMatch(fn, /await supabase\s*\n\s*\.from\('accounts'\)\s*\n\s*\.(select|update)/);
  });

  it('la cuenta NUEVA se sigue creando con la sesión (created_by = quien aprueba)', () => {
    assert.match(fn, /supabase\.from\('accounts'\)\.insert\(payload\)/);
  });
});

describe('166 — duplicados contra todo SellUp', () => {
  const src = read('src/modules/prospect-batches/actions.ts');
  it('🔴 «Duplicidad revisada» e importación buscan duplicados con el cliente de servicio', () => {
    const calls = src.split('detectCandidateDuplicates({').slice(1);
    assert.equal(calls.length, 2);
    for (const call of calls) assert.match(call.slice(0, 400), /supabase: createSupabaseAdminClient\(\),/);
  });

  it('🔴 la capa gratuita mide la novedad fiscal con el cliente de servicio', () => {
    const persist = read('src/server/prospect-batches/country-source-discovery/persist-country-source-candidates.ts');
    assert.match(persist, /noveltyReader: resolveNoveltyReader\(client\)/);
    assert.match(body(persist, 'function resolveNoveltyReader('), /return createSupabaseAdminClient\(\);/);
    const writer = read('src/server/agents/prospecting-toolkit/structured-source-candidate-writer.ts');
    assert.match(writer, /supabase: input\.noveltyReader \?\? supabase,/);
  });

  it('el árbol lee el ID de HubSpot y «ya está en SellUp» de todo SellUp', () => {
    assert.match(
      read('src/server/prospect-batches/corporate-tree/corporate-tree-run.server.ts'),
      /await createSupabaseAdminClient\(\)\s*\n\s*\.from\('accounts'\)\s*\n\s*\.select\('id, hubspot_company_id'\)/,
    );
    assert.match(
      read('src/modules/prospect-batches/corporate-tree/corporate-tree-relationships.server.ts'),
      /const everyone = createSupabaseAdminClient\(\);/,
    );
  });
});

describe('166 — reasignar a cualquiera (decisión 12-11) sigue funcionando', () => {
  it('🔴 empresas: «Asignar a…» y el cambio de responsable escriben con servicio tras comprobar', () => {
    const src = read('src/modules/accounts/actions.ts');
    assert.match(src, /await createSupabaseAdminClient\(\)\s*\n\s*\.from\('accounts'\)\s*\n\s*\.update\(\{ owner_id: target\.id/);
    assert.match(src, /const writer = ownerChanged \? createSupabaseAdminClient\(\) : supabase;/);
  });

  it('🔴 candidatas: la asignación escribe con servicio tras filtrar por alcance', () => {
    const src = read('src/modules/prospect-review/assign-actions.ts');
    const filter = src.indexOf('isVisibleToScope(row, visibleUserIds)');
    const write = src.indexOf("await createSupabaseAdminClient()\n        .from('prospect_candidates')");
    assert.ok(filter > 0 && write > filter, 'primero el alcance, después la escritura');
  });
});

describe('166 — contactos de una empresa que pasó a otro equipo', () => {
  it('🔴 «no contactar» se lee de todos los contactos de la empresa (no se paga un teléfono vetado)', () => {
    assert.match(
      read('src/modules/contact-enrichment/phone-reveal-actions.ts'),
      /await createSupabaseAdminClient\(\)\s*\n\s*\.from\('contacts'\)\s*\n\s*\.select\('id, email, linkedin_url, contact_status'\)/,
    );
  });

  it('aprobar y fusionar deduplican contra todos los contactos de la empresa', () => {
    const src = read('src/modules/contact-enrichment/actions.ts');
    assert.equal(
      (src.match(/loadExistingContacts: async \(accountId\)[\s\S]{0,300}?await createSupabaseAdminClient\(\)/g) ?? []).length,
      2,
    );
    assert.match(body(src, 'export async function getDuplicateCandidateMergeOffer('), /await createSupabaseAdminClient\(\)\s*\n\s*\.from\('contacts'\)/);
  });

  it('el origen de una empresa propia se lee aunque su candidata esté en otra búsqueda', () => {
    assert.match(body(read('src/modules/pipeline/actions.ts'), 'async function loadOriginCandidate('), /const supabase = createSupabaseAdminClient\(\);/);
  });
});
