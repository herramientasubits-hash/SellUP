/**
 * Tests — orden por seniority antes del enrich pagado (AGENT2A-COVERAGE-DECISION-MAKERS-1).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  rankContactsBySeniority,
  seniorityRank,
  SENIORITY_RANK_UNKNOWN,
} from '../contact-seniority-ranking';

type C = { id: string; seniority: string | null; title: string | null };
const rank = (items: C[]) =>
  rankContactsBySeniority(items, (c) => c.seniority, (c) => c.title).map((c) => c.id);

describe('seniorityRank', () => {
  it('C-level, dueños y gerente general van primero', () => {
    for (const [s, t] of [
      ['C-Level', null],
      ['Founder', null],
      [null, 'CEO'],
      [null, 'Gerente General'],
      [null, 'Country Manager'],
    ] as const) {
      assert.equal(seniorityRank(s, t), 0, `${s} / ${t}`);
    }
  });

  it('VP > director > gerente > senior > desconocido', () => {
    assert.equal(seniorityRank('VP', null), 1);
    assert.equal(seniorityRank(null, 'Directora de Talento Humano'), 2);
    assert.equal(seniorityRank('Manager', null), 3);
    assert.equal(seniorityRank('Senior', null), 4);
    assert.equal(seniorityRank('Entry', null), SENIORITY_RANK_UNKNOWN - 1);
    assert.equal(seniorityRank(null, null), SENIORITY_RANK_UNKNOWN);
  });

  it('la seniority del proveedor manda sobre el título', () => {
    assert.equal(seniorityRank('Director', 'HR Analyst'), 2);
  });
});

describe('rankContactsBySeniority', () => {
  it('ordena de mayor a menor y es estable dentro del mismo nivel', () => {
    const items: C[] = [
      { id: 'analista', seniority: null, title: 'Analista de Nómina' },
      { id: 'mgr-1', seniority: 'Manager', title: 'HR Manager' },
      { id: 'ceo', seniority: null, title: 'CEO' },
      { id: 'mgr-2', seniority: 'Manager', title: 'Talent Manager' },
      { id: 'dir', seniority: 'Director', title: 'Director RRHH' },
    ];
    assert.deepEqual(rank(items), ['ceo', 'dir', 'mgr-1', 'mgr-2', 'analista']);
  });

  it('no descarta ni muta la lista original', () => {
    const items: C[] = [
      { id: 'a', seniority: null, title: null },
      { id: 'b', seniority: 'VP', title: null },
    ];
    const out = rank(items);
    assert.equal(out.length, 2);
    assert.deepEqual(items.map((c) => c.id), ['a', 'b']);
  });

  it('con tope 5, el corte se queda con los más senior', () => {
    const items: C[] = [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `analista-${i}`, seniority: null, title: 'Analista' })),
      { id: 'gg', seniority: null, title: 'Gerente General' },
    ];
    const top5 = rank(items).slice(0, 5);
    assert.equal(top5[0], 'gg');
  });
});
