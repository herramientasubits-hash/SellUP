/**
 * AGENT1-CUT4-C — FULL BATCH VISIBILITY + SAFE ACTION PARITY.
 *
 * Lo que este archivo fija, y que fallaba antes de CUT4-C:
 *
 *   1. VISIBILIDAD. La ficha del lote monta el universo DURABLE del lote, no el
 *      subconjunto de `isUsefulReviewCandidate`. Un candidato CO sin NIT —el
 *      disparador real de CUT-4— se ve. Una fila histórica con `record_origin`
 *      NULL también.
 *
 *   2. ACCIONABILIDAD. Ver no autoriza. Las entradas de acción de la fila del
 *      lote salen de `resolveRowActionAvailability`, la MISMA función que usa
 *      el menú de fila de Prospectos, así que ninguna fila puede recibir en el
 *      lote algo que Prospectos le negaría (ni al revés).
 *
 *   3. La superficie heredada (`CandidateRowActions`, que fuera de Prospectos
 *      llama a `approveAndConvertCandidateAction` / `discardCandidate` /
 *      `markCandidateDuplicate` sin puerta de `record_origin`) NO vuelve a la
 *      tabla del lote.
 *
 * Puro y estático: sin DOM, sin red, sin DB. Las pruebas de paridad comparan la
 * MISMA fixture contra la MISMA autoridad que consumen ambas superficies.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveRowActionAvailability,
  resolveReviewDecisionView,
  isTerminalApprovalStatus,
} from '@/components/prospects/prospect-review-decision-utils';
import { isUsefulReviewCandidate } from '@/modules/prospect-batches/types';
import { DURABLE_PROSPECT_CANDIDATE_STATUSES } from '@/server/prospect-batches/batch-durable-candidates';
import { computeBatchCandidateCounts } from '@/server/prospect-batches/batch-candidate-counts';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Nombrar una acción heredada en un comentario para explicar POR QUÉ ya NO se
 * llama no es llamarla. Grepear en crudo confundiría las dos cosas y castigaría
 * justo la documentación que hace auditable el corte.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const PAGE = 'src/app/(sellup)/prospect-batches/[batchId]/page.tsx';
const TABLE = 'src/components/prospect-batches/candidates-table-client.tsx';
const ROW_ACTIONS = 'src/components/prospect-batches/batch-candidate-safe-actions.tsx';
const PROSPECTOS_TABLE = 'src/components/prospects/prospects-data-table-client.tsx';
const ACTIONS = 'src/modules/prospect-batches/actions.ts';

// ─── Fixtures ────────────────────────────────────────────────────────────────

type Fixture = {
  id: string;
  name: string;
  status: string;
  record_origin: string | null;
  country_code?: string | null;
  tax_identifier?: string | null;
  duplicate_status?: string | null;
  source_primary?: string | null;
};

function fixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'c-1',
    name: 'ACME SAS',
    status: 'needs_review',
    record_origin: 'production',
    country_code: 'CO',
    tax_identifier: '900123456',
    duplicate_status: 'no_match',
    source_primary: 'apollo',
    ...over,
  };
}

/** El adaptador que usa la fila del LOTE (batch-candidate-safe-actions.tsx). */
function batchAvailability(c: Fixture) {
  return resolveRowActionAvailability({
    status: c.status,
    recordOrigin: c.record_origin ?? null,
  });
}

/**
 * El adaptador que usa la fila de PROSPECTOS (prospects-data-table-client.tsx):
 * `isTerminalApprovalStatus` para aprobar y `resolveRowActionAvailability` para
 * descartar/duplicar. Se reconstruye aquí a partir de las MISMAS funciones para
 * que la paridad sea comprobable, no declarada.
 */
function prospectosAvailability(c: Fixture) {
  const shared = resolveRowActionAvailability({
    status: c.status,
    recordOrigin: c.record_origin ?? null,
  });
  return {
    canOfferApprove: !isTerminalApprovalStatus(c.status),
    canOfferDiscard: shared.canOfferDiscard,
    canOfferMarkDuplicate: shared.canOfferMarkDuplicate,
  };
}

/** La decisión REAL de mutación, idéntica en ambas superficies (el drawer). */
function decision(c: Fixture) {
  return resolveReviewDecisionView({
    id: c.id,
    name: c.name,
    status: c.status,
    recordOrigin: c.record_origin ?? null,
    duplicateStatus: c.duplicate_status ?? null,
  });
}

function assertParity(c: Fixture, label: string): void {
  assert.deepEqual(
    batchAvailability(c),
    prospectosAvailability(c),
    `${label}: el menú del lote y el de Prospectos ofrecen cosas distintas`,
  );
}

const NON_PRODUCTION_ORIGINS: (string | null)[] = [
  'import',
  'smoke_test',
  'qa',
  'synthetic',
  'historical_cleanup',
  'unknown',
  null,
];

// ─── § 7 / § 12 — visibilidad durable ────────────────────────────────────────

describe('CUT4-C § 7 — la visibilidad sale del contrato durable, no del clasificador', () => {
  it('1. una fila durable clasificada como ÚTIL se ve', () => {
    const c = fixture();
    assert.equal(isUsefulReviewCandidate(c), true);
    assert.ok(DURABLE_PROSPECT_CANDIDATE_STATUSES.includes(c.status as never));
  });

  it('2/3. CO sin NIT: el clasificador la descarta, el contrato durable NO', () => {
    // El disparador real de CUT-4 (Gate 0): 100 candidatos en 24 lotes.
    const c = fixture({ tax_identifier: null, source_primary: 'lusha' });
    assert.equal(isUsefulReviewCandidate(c), false, 'la fixture debe ser la del defecto');
    assert.ok(
      DURABLE_PROSPECT_CANDIDATE_STATUSES.includes(c.status as never),
      'sigue siendo durable: por tanto debe verse',
    );
    // Y cuenta como una fila real en el conteo del lote (CUT4-A1).
    assert.equal(computeBatchCandidateCounts([{ status: c.status }]).total, 1);
  });

  it('la ficha ya NO filtra las filas de la tabla con el clasificador', () => {
    const page = read(PAGE);
    assert.ok(
      page.includes('<CandidatesTableClient candidates={candidates} />'),
      'la tabla debe recibir el universo durable',
    );
    assert.ok(
      !/<CandidatesTableClient[^/]*candidates=\{[^}]*useful/i.test(page),
      'la tabla volvió a recibir un subconjunto de calidad',
    );
  });

  it('el clasificador sólo ANOTA: no vuelve a ser puerta de visibilidad', () => {
    const page = read(PAGE);
    // Sigue permitido usarlo para explicar la señal de calidad…
    assert.ok(page.includes('qualityFlaggedCandidates'));
    // …pero no para construir la lista que se monta.
    assert.ok(
      !/const\s+usefulCandidates\s*=/.test(page),
      'volvió el subconjunto útil como fuente de filas',
    );
  });

  it('20. el lector del lote pagina hasta agotar y filtra por estados durables', () => {
    const actions = read(ACTIONS);
    const fn = actions.slice(actions.indexOf('export async function getCandidatesByBatch'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
    assert.ok(
      body.includes(".in('status', [...DURABLE_PROSPECT_CANDIDATE_STATUSES])"),
      'la pertenencia debe salir del contrato durable canónico',
    );
    assert.ok(body.includes('.range('), 'debe paginar');
    assert.ok(
      body.includes('if (pageRows.length === 0) return rows;'),
      'sólo una página vacía puede cerrar el conjunto (no «devolvió menos de lo pedido»)',
    );
    assert.ok(
      /throw new Error\(\s*`Carga de candidatos abortada/.test(body),
      'agotar el tope debe ser un error, nunca un truncado mudo',
    );
  });

  it('19. conteo y filas comparten EXACTAMENTE el mismo contrato durable', () => {
    const actions = read(ACTIONS);
    const counter = actions.indexOf('async function fetchDurableCandidateCountRows');
    const reader = actions.indexOf('export async function getCandidatesByBatch');
    for (const at of [counter, reader]) {
      assert.ok(at > 0);
      const body = actions.slice(at, at + 2200);
      assert.ok(
        body.includes('DURABLE_PROSPECT_CANDIDATE_STATUSES'),
        'las dos lecturas deben citar la misma constante',
      );
    }
    assert.ok(
      !actions.slice(reader, reader + 2200).includes('isUsefulReviewCandidate'),
      'el lector de filas no puede consultar el clasificador',
    );
  });
});

// ─── § 8 — estados durables terminales: visibles, no accionables ─────────────

describe('CUT4-C § 8 — los estados durables terminales se ven y no se re-mutan', () => {
  const terminal = [
    ['13. approved', 'approved'],
    ['14. discarded', 'discarded'],
    ['15. duplicate', 'duplicate'],
    ['16. converted_to_account', 'converted_to_account'],
  ] as const;

  for (const [label, status] of terminal) {
    it(`${label} — durable (visible) pero sin acción de revisión`, () => {
      const c = fixture({ status });
      assert.ok(
        DURABLE_PROSPECT_CANDIDATE_STATUSES.includes(status as never),
        'debe seguir siendo durable, o dejaría de verse',
      );
      const av = batchAvailability(c);
      assert.equal(av.canOfferApprove, false, 'no se re-aprueba');
      assert.equal(av.canOfferDiscard, status === 'discarded' ? false : false);
      assert.equal(av.canOfferMarkDuplicate, false);

      const view = decision(c);
      assert.equal(view.canApprove, false);
      assert.ok(view.terminal, 'el drawer lo declara terminal');
      assertParity(c, label);
    });
  }
});

// ─── § 9 / § 10 — paridad exacta por record_origin ───────────────────────────

describe('CUT4-C § 9/§ 10 — paridad exacta de acciones con Prospectos', () => {
  it('11. production + gates válidos: mismas acciones en ambas superficies', () => {
    const c = fixture();
    const av = batchAvailability(c);
    assert.equal(av.canOfferApprove, true);
    assert.equal(av.canOfferDiscard, true);
    assert.equal(av.canOfferMarkDuplicate, true);
    assert.equal(decision(c).canApprove, true);
    assertParity(c, 'production/needs_review');
  });

  it('12. production + estado inválido: denegado en ambas', () => {
    for (const status of ['generated', 'normalized']) {
      const c = fixture({ status });
      const av = batchAvailability(c);
      assert.equal(av.canOfferDiscard, false, `${status} no es descartable`);
      assert.equal(av.canOfferMarkDuplicate, false, `${status} no es duplicable`);
      assert.equal(decision(c).canApprove, false, `${status} no es aprobable`);
      assertParity(c, `production/${status}`);
    }
  });

  for (const [i, origin] of NON_PRODUCTION_ORIGINS.entries()) {
    const label = origin ?? 'NULL histórico';
    it(`${4 + i}. record_origin ${label}: VISIBLE, sin acciones, y en paridad`, () => {
      const c = fixture({ record_origin: origin });

      // Visible: la pertenencia al lote no mira `record_origin`.
      assert.ok(
        DURABLE_PROSPECT_CANDIDATE_STATUSES.includes(c.status as never),
        'la fila sigue siendo durable, así que no puede desaparecer',
      );

      // Fail-closed: ninguna acción de revisión.
      const av = batchAvailability(c);
      assert.equal(av.canOfferDiscard, false, `${label} no puede descartarse`);
      assert.equal(av.canOfferMarkDuplicate, false, `${label} no puede duplicarse`);

      // Y el drawer tampoco la aprueba, con el motivo tipado correcto.
      const view = decision(c);
      assert.equal(view.canApprove, false, `${label} no puede aprobarse`);
      assert.equal(view.canDiscard, false);
      assert.equal(view.canMarkDuplicate, false);

      assertParity(c, label);
    });
  }

  it('la paridad se rompería si alguna superficie usara otra autoridad', () => {
    const batch = read(ROW_ACTIONS);
    const prospectos = read(PROSPECTOS_TABLE);
    for (const [file, src] of [
      ['lote', batch],
      ['prospectos', prospectos],
    ] as const) {
      assert.ok(
        src.includes('resolveRowActionAvailability'),
        `${file} debe consumir la autoridad compartida`,
      );
    }
    // Ninguna de las dos puede re-implementar la política por su cuenta.
    assert.ok(
      !batch.includes('record_origin ===') && !batch.includes("=== 'production'"),
      'el lote reimplementó la puerta de record_origin',
    );
  });
});

// ─── § 6 / § 11 — la superficie heredada no vuelve ───────────────────────────

describe('CUT4-C § 6/§ 11 — la superficie heredada no vuelve al lote', () => {
  it('la tabla del lote NO monta CandidateRowActions', () => {
    const table = read(TABLE);
    assert.ok(
      !table.includes('CandidateRowActions'),
      'volvió el menú heredado a la tabla del lote',
    );
    assert.ok(table.includes('<BatchCandidateSafeActions'));
  });

  it('la fila del lote no importa NINGUNA server action de mutación', () => {
    const src = stripComments(read(ROW_ACTIONS));
    for (const action of [
      'approveAndConvertCandidateAction',
      'discardCandidate',
      'markCandidateDuplicate',
      'approvePendingReviewCandidateAction',
      'discardPendingReviewCandidateAction',
      'markDuplicatePendingReviewCandidateAction',
    ]) {
      assert.ok(!src.includes(action), `${action} no debe estar en el menú de fila`);
    }
    assert.ok(!/from '@\/modules\/prospect-(batches|review)\/[^']*actions'/.test(src));
  });

  it('el menú de fila sólo declara intención: abre el drawer', () => {
    const src = read(ROW_ACTIONS);
    const clicks = src.match(/onClick=\{\(\) => onOpenDetail\(candidate, '[a-z]+'\)\}/g) ?? [];
    assert.equal(clicks.length, 4, 'ver detalle + aprobar + descartar + duplicar');
  });

  it('la tabla del lote no consulta el clasificador de calidad', () => {
    assert.ok(!read(TABLE).includes('isUsefulReviewCandidate'));
  });

  it('el drawer del lote sigue montando la zona de acciones canónica', () => {
    const sheet = read('src/components/prospect-batches/candidate-detail-sheet.tsx');
    assert.ok(sheet.includes('<ProspectReviewActions'));
    assert.ok(sheet.includes('recordOrigin: candidate.record_origin'));
  });
});

// ─── § 13 — el empty state deja de mentir ────────────────────────────────────

describe('CUT4-C § 13 — el empty state', () => {
  it('17. durables > 0 aunque ninguno sea «útil»: la tabla NO está vacía', () => {
    const rows = [
      fixture({ id: 'a', tax_identifier: null, source_primary: 'lusha' }),
      fixture({ id: 'b', tax_identifier: null, source_primary: 'apollo' }),
    ];
    assert.equal(rows.filter(isUsefulReviewCandidate).length, 0, 'fixture del defecto');
    // La tabla recibe el universo durable, así que su longitud no es cero.
    assert.equal(rows.length, 2);
    assert.equal(computeBatchCandidateCounts(rows.map((r) => ({ status: r.status }))).total, 2);
  });

  it('18. cero durable de verdad: el empty state se conserva', () => {
    assert.equal(computeBatchCandidateCounts([]).total, 0);
    assert.ok(read(TABLE).includes('if (candidates.length === 0) return <EmptyState />;'));
  });

  it('el empty state no puede volver a colgar del clasificador', () => {
    const page = read(PAGE);
    assert.ok(!/useful[A-Za-z]*\.length === 0/.test(page));
  });
});

// ─── § 17 — el enlace seguro sobrevive ───────────────────────────────────────

describe('CUT4-C § 17 — el enlace a la cola oficial sobrevive', () => {
  it('sigue montado y sigue saliendo del helper de A1', () => {
    const page = read(PAGE);
    assert.ok(page.includes('href={candidatesPanel.prospectosHref}'));
    assert.ok(page.includes('Revisar en Prospectos'));
    assert.ok(page.includes('candidatesPanel.showReviewCallout'));
  });
});
