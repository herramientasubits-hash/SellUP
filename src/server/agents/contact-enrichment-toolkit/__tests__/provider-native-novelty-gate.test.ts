/**
 * Tests — Pre-Paid Provider-Native Novelty Gate (pure core)
 * AGENT2A-PROVIDER-NOVELTY-AND-REUSE-GATE-1
 *
 * Sin red, sin Supabase, sin Apollo, sin Lusha, 0 créditos. Todo lo que se
 * ejercita aquí es lógica pura más un loader inyectado en memoria.
 *
 * Cubre del matriz del hito: scope determinista de empresa (20, 21, 22, 23),
 * semántica de estados (6, 7, 8, 9, 16), seguridad de identidad cruzada
 * (12, 17), y contadores de observabilidad (24, 26, 27, 28).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  KNOWN_PROVIDER_IDENTITY_CANDIDATE_STATUSES,
  applyProviderNativeNoveltyGate,
  hasDeterministicCompanyKey,
  matchesDeterministicCompanyScope,
  partitionByProviderNativeNovelty,
  resolveStrongestCompanyScopeKind,
  selectKnownNativeIdsForCompanyScope,
  type CompanyIdentityKeysV1,
  type KnownProviderIdentityLoaderV1,
  type ProviderIdentityCandidateRowV1,
} from '../provider-native-novelty-gate';

const ACCOUNT_A = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_B = '22222222-2222-2222-2222-222222222222';

function keys(overrides: Partial<CompanyIdentityKeysV1> = {}): CompanyIdentityKeysV1 {
  return { accountId: null, hubspotCompanyId: null, companyDomain: null, ...overrides };
}

/** Quita comentarios de bloque y de línea para inspeccionar solo el CÓDIGO. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function row(
  nativeId: string,
  provider: string,
  company: Partial<CompanyIdentityKeysV1>,
): ProviderIdentityCandidateRowV1 {
  return { nativeId, provider, company: keys(company) };
}

/** Loader en memoria: nunca toca red ni base de datos. */
function loaderFor(rows: ProviderIdentityCandidateRowV1[]): {
  load: KnownProviderIdentityLoaderV1;
  calls: () => number;
  lastIds: () => readonly string[];
} {
  let calls = 0;
  let lastIds: readonly string[] = [];
  return {
    load: async ({ provider, nativeIds }) => {
      calls += 1;
      lastIds = nativeIds;
      return { rows: rows.filter((r) => r.provider === provider), lookupError: null };
    },
    calls: () => calls,
    lastIds: () => lastIds,
  };
}

// ── Company scope contract ──────────────────────────────────────

describe('company scope — solo claves deterministas', () => {
  it('prioridad: account_id > hubspot_company_id > dominio normalizado', () => {
    assert.equal(
      resolveStrongestCompanyScopeKind(
        keys({ accountId: ACCOUNT_A, hubspotCompanyId: 'hs-1', companyDomain: 'x.com' }),
      ),
      'account_id',
    );
    assert.equal(
      resolveStrongestCompanyScopeKind(keys({ hubspotCompanyId: 'hs-1', companyDomain: 'x.com' })),
      'hubspot_company_id',
    );
    assert.equal(resolveStrongestCompanyScopeKind(keys({ companyDomain: 'x.com' })), 'company_domain');
    assert.equal(resolveStrongestCompanyScopeKind(keys()), 'none');
  });

  it('TEST 20 — account_id distinto NO es la misma empresa aunque el dominio coincida', () => {
    const match = matchesDeterministicCompanyScope(
      keys({ accountId: ACCOUNT_A, companyDomain: 'acme.com' }),
      keys({ accountId: ACCOUNT_B, companyDomain: 'acme.com' }),
    );
    assert.equal(match.matched, false);
    assert.equal(match.matchedBy, 'account_id');
  });

  it('TEST 21 — HubSpot company id distinto NO es la misma empresa aunque el dominio coincida', () => {
    const match = matchesDeterministicCompanyScope(
      keys({ hubspotCompanyId: 'hs-1', companyDomain: 'acme.com' }),
      keys({ hubspotCompanyId: 'hs-2', companyDomain: 'acme.com' }),
    );
    assert.equal(match.matched, false);
    assert.equal(match.matchedBy, 'hubspot_company_id');
  });

  it('el nombre de la empresa NUNCA es clave de scope', () => {
    // Mismo nombre comercial, cero claves deterministas compartidas.
    const match = matchesDeterministicCompanyScope(keys(), keys());
    assert.equal(match.matched, false);
    assert.equal(match.matchedBy, 'none');
  });

  it('TEST 22 — normalización de dominio: https://www.example.com/path === example.com', () => {
    const match = matchesDeterministicCompanyScope(
      keys({ companyDomain: 'https://www.example.com/path' }),
      keys({ companyDomain: 'example.com' }),
    );
    assert.equal(match.matched, true);
    assert.equal(match.matchedBy, 'company_domain');
  });

  it('TEST 3/4 — cae a la clave más fuerte que AMBOS lados tienen', () => {
    // El run actual tiene account_id, el histórico no: se compara por HubSpot id.
    assert.equal(
      matchesDeterministicCompanyScope(
        keys({ accountId: ACCOUNT_A, hubspotCompanyId: 'hs-9', companyDomain: 'acme.com' }),
        keys({ hubspotCompanyId: 'hs-9', companyDomain: 'acme.com' }),
      ).matchedBy,
      'hubspot_company_id',
    );
    // Ninguno tiene account_id ni HubSpot id: se compara por dominio.
    assert.equal(
      matchesDeterministicCompanyScope(
        keys({ companyDomain: 'acme.com' }),
        keys({ companyDomain: 'https://acme.com' }),
      ).matched,
      true,
    );
  });

  it('TEST 23 — sin ninguna clave determinista el gate no puede suprimir', async () => {
    const loader = loaderFor([row('apollo-1', 'apollo', { accountId: ACCOUNT_A })]);
    assert.equal(hasDeterministicCompanyKey(keys()), false);

    const result = await applyProviderNativeNoveltyGate({
      provider: 'apollo',
      items: [{ id: 'apollo-1' }],
      getNativeId: (i) => i.id,
      company: keys(),
      excludeRunId: 'run-now',
      loadKnownIdentities: loader.load,
    });

    assert.equal(result.novel.length, 1);
    assert.equal(result.skippedKnown.length, 0);
    assert.equal(result.observability.gate_applied, false);
    assert.equal(result.observability.gate_skipped_reason, 'no_deterministic_company_key');
    // Y ni siquiera se consulta la base de datos: no hay scope que consultar.
    assert.equal(loader.calls(), 0);
  });

  it('TEST 5/15 — la misma identidad en OTRA empresa determinista sigue siendo elegible', () => {
    const { knownNativeIds } = selectKnownNativeIdsForCompanyScope(
      'apollo',
      keys({ accountId: ACCOUNT_B }),
      [row('person-1', 'apollo', { accountId: ACCOUNT_A })],
    );
    assert.equal(knownNativeIds.size, 0);
  });
});

// ── Status semantics ────────────────────────────────────────────

describe('semántica de estados — todo estado cuenta como ya visto', () => {
  it('la lista declarada cubre los cuatro estados del check de la tabla', () => {
    assert.deepEqual([...KNOWN_PROVIDER_IDENTITY_CANDIDATE_STATUSES].sort(), [
      'approved',
      'discarded',
      'duplicate',
      'pending_review',
    ]);
  });

  it('TEST 6/7/8/16 — la lectura batch NO filtra por status', () => {
    // Contrato verificado sobre la fuente: si algún día apareciera un
    // .eq('status', …) en la consulta del gate, un candidato rechazado
    // volvería a ser pagable. Se comprueba estáticamente porque el filtro
    // vive en la query, no en una rama observable desde fuera.
    const source = readFileSync(
      path.join(__dirname, '..', 'provider-native-novelty-gate.ts'),
      'utf8',
    );
    const queryBlock = source.slice(source.indexOf("from('contact_enrichment_candidates')"));
    const untilEnd = queryBlock.slice(0, queryBlock.indexOf('.neq('));
    assert.equal(untilEnd.includes(".eq('status'"), false);
    assert.equal(untilEnd.includes('status'), false);
  });

  it('TEST 9 — una identidad conocida con datos incompletos sigue omitida del pago automático', () => {
    // El gate solo conoce provider + native id + empresa: no hay ninguna rama
    // que consulte email/teléfono, así que "le falta el email" no la reabre.
    const { knownNativeIds } = selectKnownNativeIdsForCompanyScope(
      'apollo',
      keys({ accountId: ACCOUNT_A }),
      [row('person-incomplete', 'apollo', { accountId: ACCOUNT_A })],
    );
    assert.equal(knownNativeIds.has('person-incomplete'), true);
  });
});

// ── Cross-provider identity safety ──────────────────────────────

describe('seguridad de identidad entre proveedores', () => {
  it('TEST 12 — un contactId de Lusha conocido NO suprime un person_id de Apollo', async () => {
    const loader = loaderFor([row('shared-id', 'lusha', { accountId: ACCOUNT_A })]);
    const result = await applyProviderNativeNoveltyGate({
      provider: 'apollo',
      items: [{ id: 'shared-id' }],
      getNativeId: (i) => i.id,
      company: keys({ accountId: ACCOUNT_A }),
      excludeRunId: 'run-now',
      loadKnownIdentities: loader.load,
    });
    assert.equal(result.skippedKnown.length, 0);
    assert.equal(result.novel.length, 1);
  });

  it('TEST 17 — un person_id de Apollo conocido NO suprime un contactId de Lusha', async () => {
    const loader = loaderFor([row('shared-id', 'apollo', { accountId: ACCOUNT_A })]);
    const result = await applyProviderNativeNoveltyGate({
      provider: 'lusha',
      items: [{ id: 'shared-id' }],
      getNativeId: (i) => i.id,
      company: keys({ accountId: ACCOUNT_A }),
      excludeRunId: 'run-now',
      loadKnownIdentities: loader.load,
    });
    assert.equal(result.skippedKnown.length, 0);
    assert.equal(result.novel.length, 1);
  });

  it('selectKnownNativeIds descarta filas de otro proveedor incluso si la lectura las trajera', () => {
    const { knownNativeIds } = selectKnownNativeIdsForCompanyScope(
      'apollo',
      keys({ accountId: ACCOUNT_A }),
      [
        row('a-1', 'apollo', { accountId: ACCOUNT_A }),
        row('l-1', 'lusha', { accountId: ACCOUNT_A }),
      ],
    );
    assert.deepEqual([...knownNativeIds], ['a-1']);
  });
});

// ── Partition + fail-open ───────────────────────────────────────

describe('partición por novedad', () => {
  it('separa conocidas de novedosas conservando el orden de las novedosas', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const partition = partitionByProviderNativeNovelty(
      items,
      (i) => i.id,
      new Set(['a', 'c']),
    );
    assert.deepEqual(partition.novel.map((i) => i.id), ['b', 'd']);
    assert.deepEqual(partition.skippedKnown.map((s) => s.nativeId), ['a', 'c']);
  });

  it('un resultado sin identidad nativa se trata como NOVEDOSO (falla abierto)', () => {
    const partition = partitionByProviderNativeNovelty(
      [{ id: null as string | null }, { id: '  ' }, { id: 'x' }],
      (i) => i.id,
      new Set(['x']),
    );
    assert.equal(partition.withoutNativeIdCount, 2);
    assert.equal(partition.novel.length, 2);
    assert.equal(partition.skippedKnown.length, 1);
  });

  it('un error de lectura no suprime nada y queda registrado', async () => {
    const result = await applyProviderNativeNoveltyGate({
      provider: 'lusha',
      items: [{ id: 'l-1' }, { id: 'l-2' }],
      getNativeId: (i) => i.id,
      company: keys({ accountId: ACCOUNT_A }),
      excludeRunId: 'run-now',
      loadKnownIdentities: async () => ({ rows: [], lookupError: 'connection reset' }),
    });
    assert.equal(result.novel.length, 2);
    assert.equal(result.skippedKnown.length, 0);
    assert.equal(result.observability.gate_applied, false);
    assert.equal(result.observability.gate_skipped_reason, 'lookup_error');
    assert.equal(result.observability.lookup_error, 'connection reset');
  });

  it('la lectura es BATCH: una sola llamada con todos los ids del run', async () => {
    const loader = loaderFor([row('l-2', 'lusha', { accountId: ACCOUNT_A })]);
    const items = Array.from({ length: 25 }, (_, i) => ({ id: `l-${i}` }));
    const result = await applyProviderNativeNoveltyGate({
      provider: 'lusha',
      items,
      getNativeId: (i) => i.id,
      company: keys({ accountId: ACCOUNT_A }),
      excludeRunId: 'run-now',
      loadKnownIdentities: loader.load,
    });
    assert.equal(loader.calls(), 1);
    assert.equal(loader.lastIds().length, 25);
    assert.equal(result.skippedKnown.length, 1);
  });
});

// ── Observability ───────────────────────────────────────────────

describe('observabilidad del gate', () => {
  it('TEST 24/26/27 — contadores del skip; el gate nunca produce créditos ni USD', async () => {
    const loader = loaderFor([
      row('a-1', 'apollo', { accountId: ACCOUNT_A }),
      row('a-3', 'apollo', { accountId: ACCOUNT_A }),
    ]);
    const result = await applyProviderNativeNoveltyGate({
      provider: 'apollo',
      items: [{ id: 'a-1' }, { id: 'a-2' }, { id: 'a-3' }, { id: 'a-4' }],
      getNativeId: (i) => i.id,
      company: keys({ accountId: ACCOUNT_A }),
      excludeRunId: 'run-now',
      loadKnownIdentities: loader.load,
    });

    const obs = result.observability;
    assert.equal(obs.gate_applied, true);
    assert.equal(obs.company_scope_kind, 'account_id');
    assert.equal(obs.evaluated_provider_identity_count, 4);
    assert.equal(obs.known_provider_identity_ids_count, 2);
    assert.equal(obs.novel_provider_identity_count, 2);
    assert.equal(obs.skipped_known_provider_identity_count, 2);
    assert.equal(obs.lookup_error, null);

    // El bloque de observabilidad no tiene NINGÚN campo de crédito/costo:
    // un skip no puede convertirse en un cargo por accidente.
    const fields = Object.keys(obs).join(' ');
    assert.equal(/credit|cost|usd/i.test(fields), false);
  });

  it('TEST 28 — el gate no escribe ninguna fila de uso de proveedor', () => {
    // Código, no comentarios: el módulo documenta explícitamente por qué NO
    // escribe en provider_usage_logs, y esa frase no debe hacer fallar el test.
    const code = stripComments(
      readFileSync(path.join(__dirname, '..', 'provider-native-novelty-gate.ts'), 'utf8'),
    );
    assert.equal(code.includes('logProviderUsage'), false);
    assert.equal(code.includes('provider_usage_logs'), false);
  });

  it('el gate no llama a ningún proveedor ni revela teléfonos', () => {
    // Se inspecciona el CÓDIGO, no los comentarios: la documentación del módulo
    // nombra `people/match` y `/v3/contacts/enrich` justamente para explicar
    // qué llamada se evita.
    const code = stripComments(
      readFileSync(path.join(__dirname, '..', 'provider-native-novelty-gate.ts'), 'utf8'),
    );

    for (const forbidden of [
      'apollo-client',
      'lusha-client',
      'people/match',
      'contacts/enrich',
      'revealCandidatePhone',
      'phone_reveal',
      'fetch(',
    ]) {
      assert.equal(code.includes(forbidden), false, `no debe referenciar ${forbidden}`);
    }
    // Tampoco escribe: ninguna mutación sobre tablas de SellUp.
    for (const write of ['.insert(', '.update(', '.upsert(', '.delete(']) {
      assert.equal(code.includes(write), false, `no debe escribir (${write})`);
    }
  });

  it('no expone ids crudos del proveedor en la observabilidad', async () => {
    const loader = loaderFor([row('secret-apollo-id', 'apollo', { accountId: ACCOUNT_A })]);
    const result = await applyProviderNativeNoveltyGate({
      provider: 'apollo',
      items: [{ id: 'secret-apollo-id' }],
      getNativeId: (i) => i.id,
      company: keys({ accountId: ACCOUNT_A }),
      excludeRunId: 'run-now',
      loadKnownIdentities: loader.load,
    });
    assert.equal(JSON.stringify(result.observability).includes('secret-apollo-id'), false);
  });
});

// ── PR #315 correction: no unproved cost-avoidance claim ─────────
//
// The generic gate runs BEFORE Apollo relevance classification and BEFORE
// the Lusha maxCandidates cap / revealability check, so "skipped a known
// identity" does not prove "avoided a paid provider call". The previous
// `avoided_paid_provider_calls_count` counter equated the two and could
// overstate savings. These tests prove it cannot come back.

describe('PR #315 — sin métrica de ahorro no demostrada', () => {
  it('TEST-CORRECTION-5 — el módulo no declara avoided_paid_provider_calls_count', () => {
    const code = stripComments(
      readFileSync(path.join(__dirname, '..', 'provider-native-novelty-gate.ts'), 'utf8'),
    );
    assert.equal(code.includes('avoided_paid_provider_calls_count'), false);
  });

  it('TEST-CORRECTION-6 — no se introduce ninguna métrica de ahorro monetario/de llamadas no probada', () => {
    const code = stripComments(
      readFileSync(path.join(__dirname, '..', 'provider-native-novelty-gate.ts'), 'utf8'),
    );
    for (const forbidden of [
      'avoided_credits',
      'avoided_cost_usd',
      'savings_usd',
      'estimated_saved_calls',
    ]) {
      assert.equal(code.includes(forbidden), false, `no debe introducir ${forbidden}`);
    }
  });

  it('el bloque de observabilidad en tiempo de ejecución no expone la clave retirada', async () => {
    const loader = loaderFor([row('a-1', 'apollo', { accountId: ACCOUNT_A })]);
    const result = await applyProviderNativeNoveltyGate({
      provider: 'apollo',
      items: [{ id: 'a-1' }],
      getNativeId: (i) => i.id,
      company: keys({ accountId: ACCOUNT_A }),
      excludeRunId: 'run-now',
      loadKnownIdentities: loader.load,
    });
    assert.equal('avoided_paid_provider_calls_count' in result.observability, false);
    // El contador veraz sigue presente: un skip real se sigue contando.
    assert.equal(result.observability.skipped_known_provider_identity_count, 1);
  });
});
