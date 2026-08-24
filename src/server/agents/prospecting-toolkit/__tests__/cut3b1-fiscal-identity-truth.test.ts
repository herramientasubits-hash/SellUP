/**
 * AGENT1-CUT3B1-FISCAL-IDENTITY-TRUTH - matriz de pruebas § 12.
 *
 * Prueba UNA sola cosa: que la identidad fiscal de Agente 1 sea VERDADERA
 * - país + identificador canónico, compatible entre `tax_id` y `tax_identifier`,
 * cerrada ante conflicto y ante país ausente.
 *
 * NO prueba (ni introduce) registro de identidad entre capas, supresión por
 * nombre, escalonado por dominio/proveedor ni atomicidad de concurrencia.
 *
 * Todo con dobles locales. Sin red, sin Apollo, sin Lusha, sin HubSpot,
 * sin créditos, sin writes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  canonicalizeFiscalIdentifier,
  buildFiscalIdentityKey,
  buildFiscalIdentityKeyFromRaw,
  resolveStoredFiscalIdentity,
  buildFiscalLookupNeedles,
  MIN_CANONICAL_FISCAL_LENGTH,
} from '../fiscal-identity';
import {
  buildTaxIdNoveltyIndex,
  evaluateTaxIdNovelty,
  normalizeTaxId,
} from '../tax-id-novelty-checker';

// --- Doble de Supabase ------------------------------------------------------
//
// Modela lo único que importa aquí: un filtro `.in(columna, valores)` sobre el
// valor CRUDO almacenado, exactamente como se comporta PostgREST. Si el código
// bajo prueba pretendiera que la base de datos canonicaliza por su cuenta, este
// doble lo delataría.

type CandidateRowFixture = {
  id: string;
  name?: string | null;
  tax_id?: string | null;
  tax_identifier?: string | null;
  country_code?: string | null;
  batch_id?: string | null;
  review_status?: string | null;
  status?: string | null;
  duplicate_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type AccountRowFixture = {
  id: string;
  name?: string | null;
  tax_identifier: string;
  country_code?: string | null;
  pipeline_status?: string | null;
  created_at?: string | null;
};

type QueryLog = { table: string; column: string; values: readonly string[] }[];

function makeFakeSupabase(
  fixtures: { candidates?: CandidateRowFixture[]; accounts?: AccountRowFixture[] },
  log: QueryLog = [],
): SupabaseClient {
  const candidates = fixtures.candidates ?? [];
  const accounts = fixtures.accounts ?? [];

  function builder(table: string, rows: Record<string, unknown>[]) {
    let filtered = rows;
    const chain = {
      select() {
        return chain;
      },
      in(column: string, values: readonly string[]) {
        log.push({ table, column, values: [...values] });
        // Igualdad CRUDA de texto: es lo que hace la base de datos.
        filtered = filtered.filter((r) => {
          const stored = r[column];
          return typeof stored === 'string' && values.includes(stored);
        });
        return chain;
      },
      eq(column: string, value: unknown) {
        filtered = filtered.filter((r) => r[column] === value);
        return chain;
      },
      neq(column: string, value: unknown) {
        filtered = filtered.filter((r) => r[column] !== value);
        return chain;
      },
      then(resolve: (v: { data: unknown; error: null }) => unknown) {
        return Promise.resolve(resolve({ data: filtered, error: null }));
      },
    };
    return chain;
  }

  return {
    from(table: string) {
      if (table === 'prospect_candidates') {
        return builder(table, candidates as unknown as Record<string, unknown>[]);
      }
      if (table === 'accounts') {
        return builder(table, accounts as unknown as Record<string, unknown>[]);
      }
      throw new Error(`tabla no simulada: ${table}`);
    },
  } as unknown as SupabaseClient;
}

const CO = 'CO';

/** Candidato activo y reciente: si el índice lo ve, la decisión será skip. */
function activeCandidate(over: CandidateRowFixture): CandidateRowFixture {
  const nowIso = new Date().toISOString();
  return {
    country_code: CO,
    name: 'Empresa Fixture',
    review_status: null,
    status: 'needs_review',
    duplicate_status: 'unchecked',
    created_at: nowIso,
    updated_at: nowIso,
    ...over,
  };
}

async function decideFor(
  fixtures: { candidates?: CandidateRowFixture[]; accounts?: AccountRowFixture[] },
  needle: { taxId: string | null; countryCode: string | null },
) {
  const index = await buildTaxIdNoveltyIndex({
    supabase: makeFakeSupabase(fixtures),
    taxIds: [needle.taxId],
    countryCode: needle.countryCode,
  });
  return {
    index,
    decision: evaluateTaxIdNovelty({
      name: 'Empresa Evaluada',
      taxId: needle.taxId,
      countryCode: needle.countryCode,
      index,
    }),
  };
}

// === A - misma identidad fiscal, representación distinta ====================

describe('§ 12(A) - representación distinta, misma identidad fiscal canónica', () => {
  it('puntuación, espaciado y etiqueta son sólo representación', () => {
    const expected = '900123456';
    for (const raw of [
      '900123456',
      '900.123.456',
      ' 900 123 456 ',
      'NIT 900.123.456',
      'NIT900123456',
      'nit-900.123.456',
    ]) {
      assert.equal(
        canonicalizeFiscalIdentifier(raw, CO),
        expected,
        `"${raw}" debería canonicalizar a ${expected}`,
      );
    }
  });

  it('en CO el dígito de verificación separado por guion es derivado, no identidad', () => {
    // Misma regla que ya aplica normalizeSiisNIT (siis-snapshot-etl.ts).
    assert.equal(canonicalizeFiscalIdentifier('900123456-7', CO), '900123456');
    assert.equal(canonicalizeFiscalIdentifier('900.123.456-7', CO), '900123456');
    assert.equal(canonicalizeFiscalIdentifier('NIT 900.123.456-7', CO), '900123456');
  });

  it('sin guion NO se adivina un DV: el repositorio sólo recorta el separado', () => {
    assert.equal(canonicalizeFiscalIdentifier('9001234567', CO), '9001234567');
    assert.notEqual(
      canonicalizeFiscalIdentifier('9001234567', CO),
      canonicalizeFiscalIdentifier('900123456', CO),
    );
  });

  it('una razón social que empieza por una etiqueta fiscal no se mutila', () => {
    // "NITROGENO" no es "NIT" + "ROGENO": la etiqueta exige separador o dígito.
    assert.equal(canonicalizeFiscalIdentifier('NITROGENO SA', CO), 'nitrogenosa');
  });

  it('es determinística: misma entrada -> misma salida', () => {
    assert.equal(
      canonicalizeFiscalIdentifier('900.123.456-7', CO),
      canonicalizeFiscalIdentifier('900.123.456-7', CO),
    );
  });

  it('no fabrica identidad: la salida sale de los caracteres de la entrada', () => {
    assert.equal(canonicalizeFiscalIdentifier('NIT 900.123.456-7', CO), '900123456');
  });
});

// === B - mismo identificador, país distinto ================================

describe('§ 12(B) - país distinto NO es igualdad automática', () => {
  it('la clave fiscal está acotada por país', () => {
    assert.equal(
      buildFiscalIdentityKeyFromRaw({ value: '900123456', countryCode: 'CO' }),
      'CO:900123456',
    );
    assert.equal(
      buildFiscalIdentityKeyFromRaw({ value: '900123456', countryCode: 'MX' }),
      'MX:900123456',
    );
    assert.notEqual(
      buildFiscalIdentityKeyFromRaw({ value: '900123456', countryCode: 'CO' }),
      buildFiscalIdentityKeyFromRaw({ value: '900123456', countryCode: 'MX' }),
    );
  });

  it('un identificador desnudo sin país NO produce clave', () => {
    assert.equal(buildFiscalIdentityKey({ canonical: '900123456', countryCode: null }), null);
    assert.equal(buildFiscalIdentityKey({ canonical: '900123456', countryCode: '   ' }), null);
  });

  it('una fila de MX con el mismo número no suprime a un candidato de CO', async () => {
    const { decision } = await decideFor(
      { candidates: [activeCandidate({ id: 'mx-1', tax_id: '900123456', country_code: 'MX' })] },
      { taxId: '900123456', countryCode: CO },
    );
    assert.equal(decision.shouldSkip, false);
    assert.equal(decision.status, 'new_candidate');
    assert.equal(decision.fiscalIdentity.key, 'CO:900123456');
  });

  it('un índice acotado a un país no decide sobre un candidato de otro', async () => {
    const index = await buildTaxIdNoveltyIndex({
      supabase: makeFakeSupabase({
        candidates: [activeCandidate({ id: 'co-1', tax_id: '900123456', country_code: CO })],
      }),
      taxIds: ['900123456'],
      countryCode: CO,
    });
    assert.equal(index.countryNamespace, 'CO');

    const decision = evaluateTaxIdNovelty({
      name: 'Empresa MX',
      taxId: '900123456',
      countryCode: 'MX',
      index,
    });
    assert.equal(decision.shouldSkip, false);
    assert.equal(decision.status, 'new_candidate');
  });
});

// === C - compatibilidad de columnas ========================================

describe('§ 12(C) - tax_id, tax_identifier, o ambas', () => {
  it('sólo tax_id poblado (escritor gratuito histórico) se reconoce', () => {
    const r = resolveStoredFiscalIdentity({ tax_id: '900.123.456', tax_identifier: null }, CO);
    assert.equal(r.kind, 'resolved');
    assert.equal(r.kind === 'resolved' && r.canonical, '900123456');
    assert.equal(r.kind === 'resolved' && r.source, 'tax_id');
  });

  it('sólo tax_identifier poblado (escritor de PAGO) se reconoce', () => {
    const r = resolveStoredFiscalIdentity({ tax_id: null, tax_identifier: '900123456-7' }, CO);
    assert.equal(r.kind, 'resolved');
    assert.equal(r.kind === 'resolved' && r.canonical, '900123456');
    assert.equal(r.kind === 'resolved' && r.source, 'tax_identifier');
  });

  it('ambas pobladas y equivalentes tras canonicalizar -> source both', () => {
    const r = resolveStoredFiscalIdentity(
      { tax_id: '900.123.456', tax_identifier: '900123456-7' },
      CO,
    );
    assert.equal(r.kind, 'resolved');
    assert.equal(r.kind === 'resolved' && r.canonical, '900123456');
    assert.equal(r.kind === 'resolved' && r.source, 'both');
  });

  it('el índice consulta LAS DOS columnas compatibles de prospect_candidates', async () => {
    const log: QueryLog = [];
    await buildTaxIdNoveltyIndex({
      supabase: makeFakeSupabase({}, log),
      taxIds: ['900123456'],
      countryCode: CO,
    });
    const candidateColumns = log
      .filter((q) => q.table === 'prospect_candidates')
      .map((q) => q.column)
      .sort();
    assert.deepEqual(candidateColumns, ['tax_id', 'tax_identifier']);
  });

  it('el prefiltro lleva el valor CRUDO y el canónico (superconjunto acotado)', () => {
    const needles = buildFiscalLookupNeedles(['NIT 900.123.456-7'], CO);
    assert.deepEqual(needles.canonical, ['900123456']);
    assert.ok(needles.lookupValues.includes('NIT 900.123.456-7'));
    assert.ok(needles.lookupValues.includes('900123456'));
  });
});

// === D - conflicto de columnas duales ======================================

describe('§ 12(D) - columnas duales en conflicto: FAIL CLOSED', () => {
  it('dos identificadores distintos NO eligen uno arbitrariamente', () => {
    const r = resolveStoredFiscalIdentity(
      { tax_id: '900123456', tax_identifier: '800555111' },
      CO,
    );
    assert.equal(r.kind, 'conflict');
    assert.equal(r.canonical, null);
    assert.equal(r.source, null);
    assert.equal(r.kind === 'conflict' && r.taxIdCanonical, '900123456');
    assert.equal(r.kind === 'conflict' && r.taxIdentifierCanonical, '800555111');
  });

  it('una fila en conflicto NO suprime al candidato y queda registrada', async () => {
    const { index, decision } = await decideFor(
      {
        candidates: [
          activeCandidate({ id: 'conflict-1', tax_id: '900123456', tax_identifier: '800555111' }),
        ],
      },
      { taxId: '900123456', countryCode: CO },
    );

    assert.equal(decision.shouldSkip, false, 'no se suprime por una fila ambigua');
    assert.equal(decision.status, 'new_candidate');
    assert.equal(index.columnConflicts.length, 1);
    assert.deepEqual(index.columnConflicts[0], {
      table: 'prospect_candidates',
      id: 'conflict-1',
      taxIdCanonical: '900123456',
      taxIdentifierCanonical: '800555111',
    });
  });

  it('la fila en conflicto tampoco entra por su OTRA columna', async () => {
    const { index, decision } = await decideFor(
      {
        candidates: [
          activeCandidate({ id: 'conflict-2', tax_id: '900123456', tax_identifier: '800555111' }),
        ],
      },
      { taxId: '800555111', countryCode: CO },
    );
    assert.equal(decision.shouldSkip, false);
    assert.equal(index.columnConflicts.length, 1);
    assert.equal(index.byFiscalKey.get('CO:800555111')?.candidates.length, 0);
  });
});

// === E - nulos y valores inutilizables =====================================

describe('§ 12(E) - nulo/vacío/inutilizable NO produce clave de identidad', () => {
  it('null, undefined y cadena vacía', () => {
    assert.equal(canonicalizeFiscalIdentifier(null, CO), null);
    assert.equal(canonicalizeFiscalIdentifier(undefined, CO), null);
    assert.equal(canonicalizeFiscalIdentifier('', CO), null);
    assert.equal(canonicalizeFiscalIdentifier('   ', CO), null);
  });

  it('sólo puntuación', () => {
    assert.equal(canonicalizeFiscalIdentifier('---', CO), null);
    assert.equal(canonicalizeFiscalIdentifier('...', CO), null);
  });

  it(`por debajo de ${MIN_CANONICAL_FISCAL_LENGTH} caracteres canónicos no hay identidad`, () => {
    assert.equal(canonicalizeFiscalIdentifier('12', CO), null);
    assert.equal(canonicalizeFiscalIdentifier('1234', CO), null);
    assert.equal(canonicalizeFiscalIdentifier('12345', CO), '12345');
  });

  it('sólo la etiqueta, sin número, no es identidad', () => {
    assert.equal(canonicalizeFiscalIdentifier('NIT ', CO), null);
  });

  it('un candidato sin identificador fiscal se permite y se marca', async () => {
    const { decision } = await decideFor({}, { taxId: null, countryCode: CO });
    assert.equal(decision.status, 'new_candidate_no_tax_id');
    assert.equal(decision.shouldSkip, false);
    assert.equal(decision.fiscalIdentity.canonical, null);
    assert.equal(decision.fiscalIdentity.key, null);
  });

  it('sin país el índice queda INERTE y no hay igualdad automática', async () => {
    const { index, decision } = await decideFor(
      { candidates: [activeCandidate({ id: 'co-1', tax_id: '900123456' })] },
      { taxId: '900123456', countryCode: null },
    );
    assert.equal(index.countryNamespace, null);
    assert.equal(index.byFiscalKey.size, 0);
    assert.equal(decision.shouldSkip, false);
    assert.equal(decision.status, 'new_candidate');
    assert.equal(decision.fiscalIdentity.countryScoped, false);
    assert.equal(decision.fiscalIdentity.canonical, '900123456');
  });
});

// === F - visibilidad entre capas gratuita <-> pago =========================

describe('§ 12(F) - gratuito <-> pago: la identidad fiscal es descubrible', () => {
  it('PAGO->GRATUITO: fila previa con SÓLO tax_identifier ya es visible', async () => {
    // Antes de CUT-3B1 el checker leía sólo `tax_id`, así que esta fila de PAGO
    // era invisible y el candidato gratuito se volvía a persistir.
    const { index, decision } = await decideFor(
      {
        candidates: [
          activeCandidate({ id: 'paid-1', tax_id: null, tax_identifier: '900123456-7' }),
        ],
      },
      { taxId: '900.123.456', countryCode: CO },
    );

    assert.equal(index.byFiscalKey.get('CO:900123456')?.candidates.length, 1);
    assert.equal(
      index.byFiscalKey.get('CO:900123456')?.candidates[0]?.fiscalIdentitySource,
      'tax_identifier',
    );
    assert.equal(decision.shouldSkip, true);
    assert.equal(decision.status, 'existing_candidate');
    assert.deepEqual(decision.matchedCandidateIds, ['paid-1']);
  });

  it('GRATUITO->GRATUITO: fila previa con AMBAS columnas sigue reconociéndose', async () => {
    const { decision } = await decideFor(
      {
        candidates: [
          activeCandidate({ id: 'free-1', tax_id: '900123456', tax_identifier: '900123456' }),
        ],
      },
      { taxId: '900123456', countryCode: CO },
    );
    assert.equal(decision.shouldSkip, true);
    assert.equal(decision.status, 'existing_candidate');
  });

  it('GRATUITO->PAGO: fila previa SIN DV es visible para una aguja CON DV', async () => {
    const { index, decision } = await decideFor(
      {
        candidates: [
          activeCandidate({ id: 'free-2', tax_id: '900123456', tax_identifier: '900123456' }),
        ],
      },
      { taxId: '900123456-7', countryCode: CO },
    );
    assert.equal(index.byFiscalKey.get('CO:900123456')?.candidates.length, 1);
    assert.equal(decision.shouldSkip, true);
    assert.equal(decision.status, 'existing_candidate');
    assert.deepEqual(decision.matchedCandidateIds, ['free-2']);
  });

  it('el prefiltro alcanza la representación con DV separado por guion', () => {
    const needles = buildFiscalLookupNeedles(['900.123.456'], CO);
    assert.deepEqual(needles.canonical, ['900123456']);
    for (let digit = 0; digit <= 9; digit += 1) {
      assert.ok(
        needles.lookupValues.includes(`900123456-${digit}`),
        `falta la variante 900123456-${digit}`,
      );
    }
  });

  it('fuera de CO no se generan variantes de DV (no se inventa representación)', () => {
    const needles = buildFiscalLookupNeedles(['ABC123456AB1'], 'MX');
    assert.deepEqual(needles.canonical, ['abc123456ab1']);
    assert.ok(!needles.lookupValues.some((v) => /-\d$/.test(v)));
  });

  it('una cuenta existente se reconoce por identidad fiscal canónica', async () => {
    const { decision } = await decideFor(
      { accounts: [{ id: 'acc-1', tax_identifier: '900123456', country_code: CO }] },
      { taxId: '900123456', countryCode: CO },
    );
    assert.equal(decision.status, 'existing_account');
    assert.equal(decision.shouldSkip, true);
    assert.deepEqual(decision.matchedAccountIds, ['acc-1']);
  });

  it('la igualdad NO se acepta sin verificación canónica en memoria', async () => {
    // El doble devuelve la fila porque el prefiltro crudo coincide, pero su
    // identidad canónica es OTRA: el índice debe rechazarla.
    const index = await buildTaxIdNoveltyIndex({
      supabase: makeFakeSupabase({
        candidates: [activeCandidate({ id: 'other-1', tax_id: '900123456' })],
      }),
      taxIds: ['900123456', '800555111'],
      countryCode: CO,
    });
    assert.equal(index.byFiscalKey.get('CO:900123456')?.candidates.length, 1);
    assert.equal(index.byFiscalKey.get('CO:800555111')?.candidates.length, 0);
  });
});

// === G - sin efecto colateral por NOMBRE ===================================

describe('§ 12(G) - el nombre NO gana poder de supresión en este corte', () => {
  it('mismo nombre sin identidad fiscal compartida -> comportamiento inalterado', async () => {
    const { decision } = await decideFor(
      {
        candidates: [
          activeCandidate({ id: 'name-1', name: 'Empresa Evaluada', tax_id: '800555111' }),
        ],
      },
      { taxId: '900123456', countryCode: CO },
    );
    assert.equal(decision.shouldSkip, false);
    assert.equal(decision.status, 'new_candidate');
    assert.deepEqual(decision.matchedCandidateIds, []);
  });

  it('nombre idéntico y NINGÚN identificador fiscal en la fila previa -> no suprime', async () => {
    const { decision } = await decideFor(
      {
        candidates: [
          activeCandidate({
            id: 'name-2',
            name: 'Empresa Evaluada',
            tax_id: null,
            tax_identifier: null,
          }),
        ],
      },
      { taxId: '900123456', countryCode: CO },
    );
    assert.equal(decision.shouldSkip, false);
  });

  it('la autoridad fiscal es función SÓLO del valor y el país', () => {
    assert.equal(canonicalizeFiscalIdentifier('900123456', CO), '900123456');
    assert.equal(
      buildFiscalIdentityKeyFromRaw({ value: '900123456', countryCode: CO }),
      'CO:900123456',
    );
  });
});

// === H - sin efecto colateral por DOMINIO ==================================

describe('§ 12(H) - el dominio NO gana poder de supresión en este corte', () => {
  it('el índice fiscal no consulta ni por dominio ni por nombre ni por identity_key', async () => {
    const log: QueryLog = [];
    await buildTaxIdNoveltyIndex({
      supabase: makeFakeSupabase({}, log),
      taxIds: ['900123456'],
      countryCode: CO,
    });
    const columns = log.map((q) => q.column);
    assert.ok(!columns.includes('domain'));
    assert.ok(!columns.includes('website'));
    assert.ok(!columns.includes('normalized_name'));
    assert.ok(!columns.includes('identity_key'));
  });

  it('mismo dominio sin identidad fiscal compartida -> no suprime', async () => {
    const { decision } = await decideFor(
      { candidates: [activeCandidate({ id: 'dom-1', tax_id: null, tax_identifier: null })] },
      { taxId: '900123456', countryCode: CO },
    );
    assert.equal(decision.shouldSkip, false);
    assert.equal(decision.status, 'new_candidate');
  });
});

// === Compatibilidad de superficie pública ==================================

describe('normalizeTaxId - alias de compatibilidad delegado a la autoridad', () => {
  it('conserva el comportamiento histórico documentado', () => {
    assert.equal(normalizeTaxId('900.123.456-7'), '9001234567');
    assert.equal(normalizeTaxId(' 900 123 456 '), '900123456');
    assert.equal(normalizeTaxId('NIT 900.123.456'), '900123456');
    assert.equal(normalizeTaxId(''), null);
    assert.equal(normalizeTaxId(null), null);
  });

  it('sin país NO aplica la regla de DV colombiana (ámbito obligatorio)', () => {
    // El alias no recibe país: por eso no puede recortar el DV. La autoridad sí.
    assert.equal(normalizeTaxId('900123456-7'), '9001234567');
    assert.equal(canonicalizeFiscalIdentifier('900123456-7', CO), '900123456');
  });
});
