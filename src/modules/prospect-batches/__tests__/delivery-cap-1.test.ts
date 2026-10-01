/**
 * AGENT1-DELIVERY-CAP-1 — cuántas empresas ve UN vendedor por corrida (opción B
 * de la dueña, 2026-10-01).
 *
 *   § 1 · el valor sale del entorno y falla hacia «sin tope», nunca hacia recortar;
 *   § 2 · el reparto: completas primero, orden original, sin tocar si cabe;
 *   § 3 · el cableado: los tres escritores lo aplican (Apollo/Tavily, Lusha, gratuito).
 *
 *   LIVE_PROVIDER_CALLS = 0 · CREDITS = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  DELIVERY_CAP_ENV_VAR,
  DELIVERY_CAP_SANITY_MAX,
  applyDeliveryCap,
  resolveMaxDeliveredCandidates,
} from '../delivery-cap';
import { WIZARD_TARGET_USEFUL_COMPANIES } from '../wizard-target-authority';

describe('§ 1 — el valor', () => {
  const env = (v?: string) => ({ [DELIVERY_CAP_ENV_VAR]: v });

  it('ausente ⇒ sin tope (comportamiento de X6.13)', () => {
    assert.equal(resolveMaxDeliveredCandidates({}), null);
    assert.equal(resolveMaxDeliveredCandidates(env(undefined)), null);
  });

  it('un entero válido ⇒ ese tope', () => {
    assert.equal(resolveMaxDeliveredCandidates(env('10')), 10);
    assert.equal(resolveMaxDeliveredCandidates(env(' 12 ')), 12);
    assert.equal(resolveMaxDeliveredCandidates(env(String(WIZARD_TARGET_USEFUL_COMPANIES))), WIZARD_TARGET_USEFUL_COMPANIES);
  });

  it('🔴 nunca por debajo del objetivo: un valor menor se IGNORA (no recorta)', () => {
    assert.equal(resolveMaxDeliveredCandidates(env('4')), null);
    assert.equal(resolveMaxDeliveredCandidates(env('0')), null);
    assert.equal(resolveMaxDeliveredCandidates(env('8'), 10), null, 'con objetivo 10, 8 no vale');
  });

  it('🔴 basura o exceso ⇒ sin tope, nunca un recorte inventado', () => {
    for (const bad of ['', 'diez', '10.5', '-10', '1e2', String(DELIVERY_CAP_SANITY_MAX + 1), '999999999999999999999']) {
      assert.equal(resolveMaxDeliveredCandidates(env(bad)), null, bad);
    }
  });
});

describe('§ 2 — el reparto', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: i, complete: i >= 9 }));

  it('sin tope o si cabe ⇒ la misma lista, sin recorte', () => {
    assert.deepEqual(applyDeliveryCap(items, null, (x) => x.complete).delivered, items);
    const fits = applyDeliveryCap(items.slice(0, 5), 10, (x) => x.complete);
    assert.equal(fits.applied, false);
    assert.equal(fits.delivered.length, 5);
  });

  it('🔴 completas primero: con 3 completas al FINAL y tope 10, las 3 entran', () => {
    const r = applyDeliveryCap(items, 10, (x) => x.complete);
    assert.equal(r.applied, true);
    assert.equal(r.delivered.length, 10);
    assert.equal(r.capped.length, 2);
    for (const id of [9, 10, 11]) assert.ok(r.delivered.some((x) => x.id === id), `la completa ${id} quedó fuera`);
    assert.deepEqual(r.capped.map((x) => x.id), [7, 8], 'se recortan las últimas incompletas');
  });

  it('el orden entregado es el ORIGINAL (determinista aguas abajo)', () => {
    const r = applyDeliveryCap(items, 10, (x) => x.complete);
    const ids = r.delivered.map((x) => x.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  });

  it('más completas que el tope ⇒ se recortan completas, nunca entra una incompleta', () => {
    const all = Array.from({ length: 12 }, (_, i) => ({ id: i, complete: i % 4 !== 0 }));
    const r = applyDeliveryCap(all, 5, (x) => x.complete);
    assert.ok(r.delivered.every((x) => x.complete));
  });
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const read = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));

describe('§ 3 — el cableado', () => {
  it('Apollo: el runner pasa el tope al escritor', () => {
    const runner = read('src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts');
    assert.match(runner, /maxDeliveredCandidates:\s*resolveMaxDeliveredCandidates\(\)/);
  });

  it('Tavily: la búsqueda incremental pasa el tope al escritor', () => {
    const inc = read('src/server/agents/prospecting-toolkit/incremental-search.ts');
    assert.match(inc, /maxDeliveredCandidates:\s*resolveMaxDeliveredCandidates\(\)/);
  });

  it('🔴 el escritor recorta la COLA de la lista ya ordenada completas-primero', () => {
    const writer = read('src/server/agents/prospecting-toolkit/candidate-writer.ts');
    assert.match(writer, /const capOrdered = orderByCompleteFirst\(/);
    assert.match(writer, /capOrdered\.slice\(0, deliveryCap\)/);
    assert.match(writer, /precisionGate\.targetCapCount = capOrdered\.length - toPersist\.length/);
  });

  it('Lusha: el tope se aplica tras la admisión y nunca reutiliza el contador de X6.13', () => {
    const lusha = read('src/server/prospect-batches/lusha-pending-review.ts');
    assert.match(lusha, /applyDeliveryCap\(\s*useful,/);
    assert.match(lusha, /const targetOverflowDiscarded = 0;/, 'el trinquete de X6.13 sigue intacto');
  });

  it('capa gratuita: persiste como mucho el tope', () => {
    const free = read('src/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server.ts');
    assert.match(free, /companies:\s*deliveredFree,/);
  });
});
