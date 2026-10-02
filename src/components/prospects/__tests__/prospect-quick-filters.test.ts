/**
 * Indicadores de «Por revisar» — las REGLAS con las que se cuentan y filtran.
 *
 * Antes eran cuatro recuentos del servidor (`getGlobalProspectsKPIs`). Ahora se
 * calculan sobre las filas de la tabla; estas pruebas fijan que la regla de
 * cada indicador es la misma que tenía la consulta.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildProspectQuickFilters } from '../prospect-quick-filters';
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function candidate(overrides: Partial<ProspectCandidateWithReviewer>): ProspectCandidateWithReviewer {
  return {
    id: 'c',
    status: 'needs_review',
    review_status: null,
    duplicate_status: 'no_match',
    source_primary: 'agent_1',
    created_at: new Date(NOW - 30 * DAY).toISOString(),
    ...overrides,
  } as ProspectCandidateWithReviewer;
}

const filters = buildProspectQuickFilters(NOW);
const byId = (id: string) => {
  const found = filters.find((filter) => filter.id === id);
  assert.ok(found, `falta el indicador ${id}`);
  return found;
};

describe('buildProspectQuickFilters — los tres indicadores', () => {
  it('son «Sin bloqueos detectados», «Posibles duplicados» e «Importados esta semana»', () => {
    assert.deepEqual(
      filters.map((filter) => filter.label),
      ['Sin bloqueos detectados', 'Posibles duplicados', 'Importados esta semana'],
    );
  });

  it('ninguno promete que el prospecto está listo para aprobar', () => {
    for (const filter of filters) assert.doesNotMatch(filter.label, /listos? para aprobar/i);
  });
});

describe('«Sin bloqueos detectados» — la regla de readyForApproval', () => {
  const unblocked = byId('unblocked').predicate;

  it('cuenta los tres estados de revisión', () => {
    for (const status of ['needs_review', 'generated', 'normalized'] as const) {
      assert.equal(unblocked(candidate({ status })), true, status);
    }
  });

  it('deja fuera lo que ya tiene decisión', () => {
    for (const status of ['approved', 'discarded', 'duplicate', 'converted_to_account'] as const) {
      assert.equal(unblocked(candidate({ status })), false, status);
    }
  });

  it('admite review_status nulo o ready_for_approval, y ningún otro', () => {
    assert.equal(unblocked(candidate({ review_status: null })), true);
    assert.equal(
      unblocked(candidate({ review_status: 'ready_for_approval' as ProspectCandidateWithReviewer['review_status'] })),
      true,
    );
    assert.equal(
      unblocked(candidate({ review_status: 'blocked' as ProspectCandidateWithReviewer['review_status'] })),
      false,
    );
  });

  it('un duplicado exacto, lo no verificado y los datos insuficientes bloquean', () => {
    for (const duplicate_status of ['no_match', 'related_company', 'possible_duplicate'] as const) {
      assert.equal(unblocked(candidate({ duplicate_status })), true, duplicate_status);
    }
    for (const duplicate_status of ['exact_duplicate', 'unchecked', 'insufficient_data'] as const) {
      assert.equal(
        unblocked(candidate({ duplicate_status: duplicate_status as ProspectCandidateWithReviewer['duplicate_status'] })),
        false,
        duplicate_status,
      );
    }
  });
});

describe('«Posibles duplicados»', () => {
  const possible = byId('possible_duplicates').predicate;

  it('solo cuenta possible_duplicate en revisión', () => {
    assert.equal(possible(candidate({ duplicate_status: 'possible_duplicate' })), true);
    assert.equal(possible(candidate({ duplicate_status: 'no_match' })), false);
    assert.equal(
      possible(candidate({ duplicate_status: 'exact_duplicate' as ProspectCandidateWithReviewer['duplicate_status'] })),
      false,
    );
    assert.equal(possible(candidate({ duplicate_status: 'possible_duplicate', status: 'approved' })), false);
  });
});

describe('«Importados esta semana»', () => {
  const imported = byId('imported_recently').predicate;
  const importedAt = (ms: number) =>
    candidate({
      source_primary: 'external_import' as ProspectCandidateWithReviewer['source_primary'],
      created_at: new Date(ms).toISOString(),
    });

  it('cuenta lo importado en los últimos 7 días', () => {
    assert.equal(imported(importedAt(NOW - DAY)), true);
    assert.equal(imported(importedAt(NOW - 7 * DAY)), true);
  });

  it('deja fuera lo importado antes', () => {
    assert.equal(imported(importedAt(NOW - 7 * DAY - 1000)), false);
  });

  it('deja fuera lo que no vino de una importación', () => {
    assert.equal(imported(candidate({ created_at: new Date(NOW - DAY).toISOString() })), false);
  });
});
