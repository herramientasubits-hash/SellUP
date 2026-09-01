/**
 * AGENT1-ACTIVE-CANDIDATE-DOMAIN-CANONICALIZATION — el eje FUERTE de la guarda de
 * candidatos activos vuelve a ver el MISMO dominio cuando una de las dos caras
 * lleva `www.`.
 *
 * ── El defecto que cierra, tal como ocurrió en Producción ────────────────────
 *
 * Lote `26f49596-1c89-4da4-a769-8838fe4baf06` (primer despacho REAL de Lusha
 * Prospecting). Cinco candidatas PAGADAS se persistieron como
 * `possible_duplicate` y CONTARON para el objetivo, teniendo cada una un
 * `prospect_candidate` ACTIVO anterior con el MISMO dominio:
 *
 *   EPM                      www.une.com.co                 (dd570862…)
 *   ETB                      www.etb.com                    (7e126f65…)
 *   RCN TV                   www.canalrcn.com               (51249a5b…)
 *   Controles Empresariales  www.controlesempresariales.com  (963673ad…)
 *   Avantel S.A              www.avantel.co                 (7dbaba69…)
 *
 * Quien llama construye `input.domain` con el dominio ya canonicalizado por la
 * autoridad compartida (`normalizeDomain`, que quita `www.`); la fila existente
 * llega con su dominio TAL CUAL se persistió, que en Producción es `www.…`. La
 * comparación era `c.domain === input.domain`, así que:
 *
 *     'une.com.co' === 'www.une.com.co'   →   false
 *
 * El eje fuerte se PERDÍA y la guarda caía al eje de NOMBRE, que CUT-L7
 * debilitó A PROPÓSITO. Resultado: `same_inferred_identity` → `possible_duplicate`
 * → persistida → cuenta para el objetivo. El defecto NO es la política de
 * CUT-L7: es asimetría de canonicalización de dominio en la frontera de la
 * guarda.
 *
 * ── Lo que esta suite defiende, dicho como defecto ──────────────────────────
 *
 *   M1. que `www.` vuelva a partir en dos la identidad de un dominio;
 *   M2. que el protocolo o una barra final la partan;
 *   M3. que las mayúsculas la partan;
 *   M4. que dos dominios DISTINTOS se fusionen por el eje fuerte;
 *   M5. que un dominio ausente o inválido funde igualdad de dominio;
 *   M6. que un histórico `discarded`/`duplicate` vuelva a bloquear;
 *   M7. que el motivo de igualdad de dominio deje de ser FUERTE;
 *   M8. que el pre-writer y el writer clasifiquen la MISMA igualdad distinto;
 *   M9. que la guarda deje de usar la autoridad compartida (segundo normalizador
 *       o recorte de `www.` a mano dentro de la guarda).
 *
 * 0 proveedores, 0 créditos, 0 Producción, 0 escrituras, 0 red, 0 migraciones.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  checkActiveCandidateDuplicate,
  type ActiveCandidateRecord,
  type DuplicateGuardInput,
} from '../active-candidate-identity-guard';
import { isStrongActiveGuardReason, isWeakActiveGuardReason } from '../strong-identity-duplicate-match';
import { normalizeDomain } from '../normalization';
import { evaluateCandidatePreWriterAdmission } from '../apollo-pre-writer-target-conditions';
import { writeProspectingCandidates } from '../candidate-writer';
import type { CandidateWriterInput, ProspectingPipelineCandidate } from '../types';
import { preM126Rpc } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';

// ─── Las cinco parejas VIVAS del lote 26f49596 ────────────────────────────────

const LIVE_BATCH_ID = '26f49596-1c89-4da4-a769-8838fe4baf06';

/**
 * Nombre, dominio canónico que la ruta de pago construyó, y el dominio TAL CUAL
 * está persistido en la fila activa anterior. Los ids son los reales de
 * Producción: si alguien reescribe el fixture con datos inventados, la
 * trazabilidad contra el lote se pierde y se nota.
 */
const LIVE_FALSE_WEAK_PAIRS = [
  { name: 'EPM', inputDomain: 'une.com.co', persistedDomain: 'www.une.com.co', priorId: 'dd570862-613a-4696-90b8-028ff0b5aed2' },
  { name: 'ETB', inputDomain: 'etb.com', persistedDomain: 'www.etb.com', priorId: '7e126f65-88de-43a9-86e2-7a41e84481f2' },
  { name: 'RCN TV', inputDomain: 'canalrcn.com', persistedDomain: 'www.canalrcn.com', priorId: '51249a5b-a4ba-42ba-aebe-8abb952557f7' },
  { name: 'Controles Empresariales', inputDomain: 'controlesempresariales.com', persistedDomain: 'www.controlesempresariales.com', priorId: '963673ad-285a-44e2-9308-11a0cf083726' },
  { name: 'Avantel S.A', inputDomain: 'avantel.co', persistedDomain: 'www.avantel.co', priorId: '7dbaba69-cd62-45f5-b772-833cccd8a30c' },
] as const;

function activeRecord(overrides: Partial<ActiveCandidateRecord> = {}): ActiveCandidateRecord {
  return {
    id: 'prior-1',
    name: 'Empresa Anterior',
    domain: 'www.ejemplo.com',
    inferredCompanyName: null,
    normalizedName: null,
    status: 'needs_review',
    ...overrides,
  };
}

function guardInput(overrides: Partial<DuplicateGuardInput> = {}): DuplicateGuardInput {
  return {
    name: 'Empresa Anterior',
    domain: 'ejemplo.com',
    website: 'https://ejemplo.com',
    inferredCompanyName: 'Empresa Anterior',
    normalizedName: 'empresa anterior',
    ...overrides,
  };
}

/**
 * La comparación EXACTA que había antes del corte, reimplantada aquí para que la
 * mutación quede probada sin tocar el producto: si alguien vuelve a comparar en
 * crudo, el eje fuerte se pierde y el defecto resucita.
 */
function legacyRawDomainAxisMatches(
  input: DuplicateGuardInput,
  existing: ActiveCandidateRecord,
): boolean {
  return Boolean(input.domain) && existing.domain === input.domain;
}

// ─── M1–M3 · la igualdad de dominio sobrevive a `www.`, protocolo y caja ──────

describe('§ 1 · igualdad de dominio CANÓNICA en la guarda de activos', () => {
  test('REGRESIÓN 1 — `une.com.co` contra `www.une.com.co` activo ⇒ same_active_domain', () => {
    const match = checkActiveCandidateDuplicate(
      guardInput({ name: 'EPM', domain: 'une.com.co', inferredCompanyName: 'EPM', normalizedName: 'epm' }),
      [activeRecord({ id: 'dd570862-613a-4696-90b8-028ff0b5aed2', name: 'EPM', domain: 'www.une.com.co', status: 'needs_review' })],
    );

    assert.equal(match.matched, true);
    assert.equal(match.reason, 'same_active_domain');
    assert.equal(match.matchedCandidateId, 'dd570862-613a-4696-90b8-028ff0b5aed2');
    // El dominio devuelto es el PERSISTIDO, no el canónico: la guarda informa lo
    // que hay en la fila, no una versión limpiada que el revisor no podría buscar.
    assert.equal(match.matchedDomain, 'www.une.com.co');
  });

  test('REGRESIÓN 2 — `WWW.ETB.COM` contra `https://www.etb.com/` activo ⇒ same_active_domain', () => {
    const match = checkActiveCandidateDuplicate(
      guardInput({ name: 'ETB', domain: 'WWW.ETB.COM', inferredCompanyName: 'ETB', normalizedName: 'etb' }),
      [activeRecord({ id: 'prior-etb', name: 'ETB', domain: 'https://www.etb.com/' })],
    );

    assert.equal(match.matched, true);
    assert.equal(match.reason, 'same_active_domain');
    assert.equal(match.matchedCandidateId, 'prior-etb');
  });

  test('las CINCO parejas vivas del lote se cierran por dominio, no por nombre', () => {
    for (const pair of LIVE_FALSE_WEAK_PAIRS) {
      const match = checkActiveCandidateDuplicate(
        guardInput({
          name: pair.name,
          domain: pair.inputDomain,
          inferredCompanyName: pair.name,
          normalizedName: pair.name.toLowerCase(),
        }),
        [activeRecord({ id: pair.priorId, name: pair.name, domain: pair.persistedDomain })],
      );

      assert.equal(match.matched, true, `${pair.name}: debe coincidir`);
      assert.equal(
        match.reason,
        'same_active_domain',
        `${pair.name}: el eje debe ser DOMINIO (vivo: ${LIVE_BATCH_ID} lo resolvió por nombre)`,
      );
      assert.equal(
        isStrongActiveGuardReason(match.reason),
        true,
        `${pair.name}: REGRESIÓN 6 — el motivo debe ser FUERTE`,
      );
    }
  });

  test('M9 (mutación) — con la comparación CRUDA anterior las cinco NO coinciden por dominio', () => {
    for (const pair of LIVE_FALSE_WEAK_PAIRS) {
      const input = guardInput({ name: pair.name, domain: pair.inputDomain });
      const existing = activeRecord({ id: pair.priorId, name: pair.name, domain: pair.persistedDomain });

      assert.equal(
        legacyRawDomainAxisMatches(input, existing),
        false,
        `${pair.name}: la comparación cruda es exactamente el defecto`,
      );

      // Y con el eje fuerte perdido, la guarda cae al eje de NOMBRE, que CUT-L7
      // dejó DÉBIL: es la cadena completa del falso `possible_duplicate` vivo.
      const nameOnly = checkActiveCandidateDuplicate(
        guardInput({ name: pair.name, domain: null, inferredCompanyName: pair.name, normalizedName: pair.name.toLowerCase() }),
        [activeRecord({ id: pair.priorId, name: pair.name, domain: pair.persistedDomain, inferredCompanyName: pair.name })],
      );
      assert.equal(nameOnly.reason, 'same_inferred_identity');
      assert.equal(isWeakActiveGuardReason(nameOnly.reason), true);
      assert.equal(isStrongActiveGuardReason(nameOnly.reason), false);
    }
  });
});

// ─── M4–M6 · lo que NO debe fundirse ni bloquear ──────────────────────────────

describe('§ 2 · los límites del eje fuerte', () => {
  test('REGRESIÓN 3 — dominios DISTINTOS con el mismo nombre inferido ⇒ same_inferred_identity', () => {
    const match = checkActiveCandidateDuplicate(
      guardInput({
        name: 'Servicios Integrales S.A.S.',
        domain: 'serviciosintegrales.com.co',
        inferredCompanyName: 'Servicios Integrales',
        normalizedName: 'servicios integrales',
      }),
      [
        activeRecord({
          id: 'prior-homonimo',
          name: 'Servicios Integrales S.A.S.',
          // Otro dominio REAL y distinto: dos empresas homónimas de Colombia.
          domain: 'www.servicios-integrales.co',
          inferredCompanyName: 'Servicios Integrales',
        }),
      ],
    );

    assert.equal(match.matched, true);
    assert.equal(match.reason, 'same_inferred_identity', 'nunca same_active_domain');
    assert.notEqual(match.reason, 'same_active_domain');
    assert.equal(isStrongActiveGuardReason(match.reason), false, 'CUT-L7 intacto: el nombre es DÉBIL');
  });

  test('REGRESIÓN 4 — dominio ausente o inválido: la ruta DÉBIL de nombre no cambia', () => {
    const invalidDomains: Array<string | null> = [null, '', '   ', 'localhost', '10.0.0.7', 'sinpunto', 'a.b'];

    for (const domain of invalidDomains) {
      const match = checkActiveCandidateDuplicate(
        guardInput({
          name: 'Empresa Sin Web',
          domain,
          inferredCompanyName: 'Empresa Sin Web',
          normalizedName: 'empresa sin web',
        }),
        [
          activeRecord({
            id: 'prior-sin-web',
            name: 'Empresa Sin Web',
            // MISMO valor a los dos lados: antes del corte, `localhost === localhost`
            // habría fundado igualdad de DOMINIO. La autoridad lo rechaza, así que
            // aquí sólo puede quedar la evidencia DÉBIL de nombre.
            domain: typeof domain === 'string' && domain.trim() !== '' ? domain : null,
            inferredCompanyName: 'Empresa Sin Web',
          }),
        ],
      );

      assert.equal(match.matched, true, `${String(domain)}: el nombre sigue dando evidencia`);
      assert.equal(
        match.reason,
        'same_inferred_identity',
        `${String(domain)}: un valor que no es dominio de empresa NO funda el eje fuerte`,
      );
      assert.equal(normalizeDomain(String(domain ?? '')), null, `${String(domain)}: la autoridad lo rechaza`);
    }
  });

  test('REGRESIÓN 5 — un histórico descartado/duplicado con el MISMO dominio no bloquea', () => {
    const reconsiderableStatuses = ['discarded', 'duplicate', 'rejected', 'qa_cleanup', 'archived'];

    for (const status of reconsiderableStatuses) {
      const match = checkActiveCandidateDuplicate(
        guardInput({ name: 'EPM', domain: 'une.com.co', inferredCompanyName: 'EPM', normalizedName: 'epm' }),
        [activeRecord({ id: 'prior-historico', name: 'EPM', domain: 'www.une.com.co', inferredCompanyName: 'EPM', normalizedName: 'epm', status })],
      );

      assert.equal(
        match.matched,
        false,
        `${status}: la política de reconsideración no cambia — canonicalizar el dominio no puede resucitar un bloqueo`,
      );
      assert.equal(match.reason, null);
    }
  });

  test('la PRIORIDAD no cambia: con dominio igual Y nombre igual, gana el dominio', () => {
    const match = checkActiveCandidateDuplicate(
      guardInput({ name: 'EPM', domain: 'une.com.co', inferredCompanyName: 'EPM', normalizedName: 'epm' }),
      [
        activeRecord({ id: 'prior-nombre', name: 'EPM', domain: 'www.otra-cosa.com', inferredCompanyName: 'EPM', normalizedName: 'epm' }),
        activeRecord({ id: 'prior-dominio', name: 'Une', domain: 'www.une.com.co', inferredCompanyName: 'Une', normalizedName: 'une' }),
      ],
    );
    assert.equal(match.reason, 'same_active_domain');
    assert.equal(match.matchedCandidateId, 'prior-dominio');
  });
});

// ─── M8 · paridad pre-writer / writer ─────────────────────────────────────────

const PARITY_BATCH_ID = 'batch-active-domain-canon-0000-000000000001';
const PARITY_USER_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';

/**
 * La fila activa anterior, TAL CUAL la devuelve la base: dominio con `www.`.
 *
 * 🔴 El nombre y el dominio NO son los de una de las cinco parejas vivas a
 * propósito: `EPM` cae antes por el gate de propiedad («Grupo EPM») y
 * `Controles Empresariales` por el de identidad canónica, así que la paridad se
 * habría probado sobre un descarte de OTRA causa. Lo que esta pareja tiene que
 * reproducir es la FORMA del defecto —canónico a un lado, `www.` al otro— sobre
 * un candidato que supera los ocho gates deterministas del writer.
 */
const PRIOR_ACTIVE_ROW = {
  id: 'prior-active-www-row',
  name: 'Supermercados Andinos S.A.',
  domain: 'www.supermercadosandinos.com.co',
  normalized_name: 'supermercados andinos',
  metadata: {},
  status: 'needs_review',
};

class Chain {
  constructor(private readonly value: unknown) {}
  eq(): Chain { return this; }
  neq(): Chain { return this; }
  in(): Chain { return this; }
  not(): Chain { return this; }
  gte(): Chain { return this; }
  limit(): Chain { return this; }
  select(): Chain { return this; }
  then<T>(onFulfilled: (v: unknown) => T | PromiseLike<T>): Promise<T> {
    return Promise.resolve(this.value).then(onFulfilled);
  }
}

/**
 * Doble de cliente admin: 0 red, 0 Supabase real, 0 escrituras.
 *
 * `prospect_candidates.select` devuelve la fila ACTIVA anterior con su dominio
 * `www.…`, que es exactamente lo que Producción tiene. Ésa es la única razón por
 * la que este doble existe: el defecto sólo se ve cuando la fila llega cruda.
 */
function makeFakeAdmin(activeRows: readonly Record<string, unknown>[]): SupabaseClient {
  let seq = 0;
  return {
    rpc: preM126Rpc,
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select() {
            return {
              eq(column: string) {
                if (column === 'source') return new Chain({ data: [], error: null });
                return {
                  single: async () => ({
                    data: {
                      id: PARITY_BATCH_ID,
                      status: 'draft',
                      source: 'agent_1',
                      created_by: PARITY_USER_ID,
                      owner_id: PARITY_USER_ID,
                      metadata: { request_source: 'chat_wizard' },
                      client_request_id: 'req-active-domain-canon',
                    },
                    error: null,
                  }),
                };
              },
            };
          },
          update() {
            return new Chain({ error: null });
          },
        };
      }
      if (table === 'prospect_candidates') {
        return {
          select() {
            return new Chain({ data: [...activeRows], error: null });
          },
          insert() {
            const index = seq++;
            return {
              select() {
                return {
                  single: async () => ({ data: { id: `cand-${index + 1}` }, error: null }),
                };
              },
            };
          },
        };
      }
      if (table === 'prospect_candidate_audit') {
        return { insert: async () => ({ data: null, error: null }) };
      }
      throw new Error(`tabla no simulada: ${table}`);
    },
  } as unknown as SupabaseClient;
}

function pipelineCandidate(overrides: Record<string, unknown> = {}): ProspectingPipelineCandidate {
  return {
    name: 'Supermercados Andinos S.A.',
    website: 'https://www.supermercadosandinos.com.co',
    domain: 'supermercadosandinos.com.co',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Retail y Consumo',
    sourceUrl: 'https://www.supermercadosandinos.com.co/',
    sourceTitle: 'Supermercados Andinos — Cadena de supermercados en Colombia',
    sourceSnippet:
      'Supermercados Andinos opera una cadena de supermercados e hipermercados en Colombia.',
    inferredNameSource: null,
    searchTrace: null,
    llmEvaluation: null,
    websiteVerification: null,
    duplicateCheck: {
      status: 'new_candidate',
      confidence: 1,
      input: { name: 'Supermercados Andinos S.A.', website: null, domain: null },
      checkedSources: ['sellup'],
      summary: 'No match',
      matches: [],
    },
    scoring: {
      qualityLabel: 'high_quality_new',
      confidenceScore: 0.9,
      fitScore: 0.88,
      dataCompletenessScore: 0.82,
      recommendedAction: 'approve_for_review',
      breakdown: {
        existenceSignals: 1,
        websiteSignals: 1,
        duplicateSignals: 1,
        sourceSignals: 1,
        fitSignals: 1,
        completenessSignals: 1,
        penalties: 0,
      },
      reasons: [],
      warnings: [],
      blockers: [],
    },
    ...overrides,
  } as unknown as ProspectingPipelineCandidate;
}

function writerInput(candidates: readonly ProspectingPipelineCandidate[]): CandidateWriterInput {
  return {
    pipelineOutput: {
      input: {
        country: 'Colombia',
        countryCode: 'CO',
        industry: 'Retail y Consumo',
        subindustries: [],
        maxResults: candidates.length,
      },
      candidates: [...candidates],
      summary: {
        requested: candidates.length,
        returned: candidates.length,
        highQualityNew: candidates.length,
        needsReview: 0,
        duplicates: 0,
        insufficientData: 0,
        discarded: 0,
      },
      metadata: { provider: 'tavily', pipelineVersion: 'test' },
      warnings: [],
      catalogContext: null,
    },
    triggeredByUserId: PARITY_USER_ID,
    ownerId: PARITY_USER_ID,
    source: 'agent_1',
    dryRun: false,
    existingBatchId: PARITY_BATCH_ID,
  } as unknown as CandidateWriterInput;
}

describe('§ 3 · paridad pre-writer / writer sobre la MISMA igualdad canónica', () => {
  test('PRE-WRITER: la igualdad canónica ↔ `www.` falla active_duplicate_guard', () => {
    const admission = evaluateCandidatePreWriterAdmission({
      candidateKey: 'lusha:andinos',
      candidate: pipelineCandidate(),
      context: { targetCountryCode: 'CO', subindustries: [] },
      dbContext: {
        coveredDomains: new Set(['supermercadosandinos.com.co']),
        noveltyIndex: new Map(),
        recentIdentityKeys: new Set<string>(),
        activeCandidates: [
          {
            id: PRIOR_ACTIVE_ROW.id,
            name: PRIOR_ACTIVE_ROW.name,
            domain: PRIOR_ACTIVE_ROW.domain,
            normalizedName: PRIOR_ACTIVE_ROW.normalized_name,
            inferredCompanyName: null,
            status: 'needs_review',
          },
        ],
        degraded: false,
      },
      batchContext: { intraBatchIdentityWinners: new Map(), targetCapAdmittedKeys: new Set() },
    });

    const guardCheck = admission.checks.find((c) => c.check === 'active_duplicate_guard');
    assert.ok(guardCheck, 'la comprobación debe existir');
    assert.equal(guardCheck.state, 'failed', 'el pre-writer NO puede creer que hay cupo libre');
    assert.equal(guardCheck.reason, 'duplicate_guard:same_active_domain');
    assert.ok(admission.failedChecks.includes('active_duplicate_guard'));
  });

  test('WRITER: el mismo candidato se descarta con `duplicate_guard:same_active_domain`', async () => {
    const result = await writeProspectingCandidates(
      writerInput([pipelineCandidate()]),
      makeFakeAdmin([PRIOR_ACTIVE_ROW]),
    );

    assert.equal(result.candidatesCreated, 0, 'no puede llegar a prospect_candidates');
    const skip = result.skipped.find((s) => s.name === PRIOR_ACTIVE_ROW.name);
    assert.ok(skip, 'debe aparecer en los descartes');
    assert.equal(
      skip.reason,
      'duplicate_guard:same_active_domain',
      'PARIDAD: el writer y el pre-writer nombran la MISMA causa',
    );
  });

  test('WRITER: sin la fila activa anterior, el MISMO candidato sí se persiste', async () => {
    // El control que impide que la prueba anterior pase por una razón distinta
    // (un gate cualquiera bloqueando el fixture).
    const result = await writeProspectingCandidates(
      writerInput([pipelineCandidate()]),
      makeFakeAdmin([]),
    );
    assert.equal(result.candidatesCreated, 1, 'el fixture base no puede estar bloqueado');
  });
});

// ─── M9 · autoridad única, verificada sobre el código ─────────────────────────

const ROOT = path.resolve(__dirname, '../../../../..');

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

describe('§ 4 · una sola autoridad de dominio (guarda estática)', () => {
  const GUARD = 'src/server/agents/prospecting-toolkit/active-candidate-identity-guard.ts';

  test('la guarda importa `normalizeDomain` de la autoridad compartida', () => {
    const code = stripComments(read(GUARD));
    assert.match(
      code,
      /import\s*\{\s*normalizeDomain\s*\}\s*from\s*'\.\/normalization'/,
      'la canonicalización tiene que venir de normalization.ts',
    );
  });

  test('M9 — la comparación CRUDA de dominio ya no existe en la guarda', () => {
    const code = stripComments(read(GUARD));
    assert.doesNotMatch(
      code,
      /c\.domain\s*===\s*input\.domain/,
      'volver a comparar en crudo resucita el defecto www-vs-no-www',
    );
  });

  test('M9 — la guarda NO recorta `www.` por su cuenta ni define otro normalizador', () => {
    const code = stripComments(read(GUARD));
    assert.doesNotMatch(code, /\^www\\?\./, 'recortar `www.` a mano crea un segundo normalizador');
    assert.doesNotMatch(code, /function\s+normalizeDomain\b/, 'no puede haber un segundo normalizeDomain');
  });

  test('las DOS caras pasan por la autoridad antes de compararse', () => {
    const code = stripComments(read(GUARD));
    assert.match(code, /normalizeDomain\(input\.domain\)/, 'la cara de ENTRADA');
    assert.match(code, /normalizeDomain\(c\.domain\)/, 'la cara PERSISTIDA');
  });
});
