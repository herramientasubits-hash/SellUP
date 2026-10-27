/**
 * ShowMore — contrato ESTÁTICO: el «Ver más» despliega con la altura animada
 * (Collapsible), deja fijos los primeros y no pone márgenes al panel (un margen
 * no se anima y aparece de golpe). Y quienes lo usan ya no cortan la lista a mano.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

describe('ShowMore', () => {
  const source = read('components/shared/show-more.tsx');

  it('despliega con Collapsible', () => {
    assert.ok(source.includes('<CollapsibleContent>'));
    assert.ok(source.includes('<CollapsibleTrigger'));
  });

  it('los primeros quedan fijos; el resto va dentro del panel', () => {
    assert.ok(source.includes('items.slice(0, initial)'));
    assert.ok(source.includes('items.slice(initial)'));
  });

  it('el aire entre las dos listas va dentro del panel, no como margen', () => {
    assert.ok(source.includes('<div className={tailGapClassName}>'));
  });

  it('las secciones de oportunidad de la ficha lo usan (sin el corte a mano)', () => {
    const insight = read('components/prospect-batches/candidate-detail-insight-sections.tsx');
    assert.ok(insight.includes('<ShowMore'));
    assert.equal(insight.includes('showAllNeeds'), false);
    assert.equal(insight.includes('showAllAngles'), false);
  });
});
