// Agente 2A — QUÉ SE AFIRMA al cerrar una corrida «Buscar más números»
// (AGENT2A-SEARCH-MORE-PHONES-1)
//
// Suite PURA. Cada caso está escrito desde la AFIRMACIÓN que quedaría en el ledger y en la
// pantalla, porque es ahí donde este módulo puede hacer daño: `no_phone_found` afirma que el
// proveedor no tiene teléfono para esa persona, y usarlo cuando sí lo tiene es una mentira
// con consecuencias (el operador deja de buscar, y el copy dice algo falso del contacto).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSearchMoreOutcome,
  type SearchMoreOutcomeInput,
} from '../search-more-phones-core';

const NOW = '2026-08-18T12:00:00.000Z';

function input(overrides: Partial<SearchMoreOutcomeInput> = {}): SearchMoreOutcomeInput {
  return {
    providerOutcome: 'revealed',
    persistStatus: 'persisted',
    newDistinctPhoneCount: 1,
    costCredits: 2,
    nowIso: NOW,
    ...overrides,
  };
}

describe('AGENT2A-SEARCH-MORE-PHONES-1 · desenlace de la corrida', () => {
  it('ÉXITO: números nuevos ⇒ completed_lusha, revealed, y el conteo real', () => {
    const out = resolveSearchMoreOutcome(input({ newDistinctPhoneCount: 2 }));

    assert.equal(out.result, 'new_phones_found');
    assert.equal(out.newDistinctPhoneCount, 2);
    assert.equal(out.patch.status, 'completed_lusha');
    assert.equal(out.patch.lushaOutcome, 'revealed');
    assert.equal(out.patch.finalProvider, 'lusha');
    assert.equal(out.patch.errorCode, null);
    assert.equal(out.patch.completedAt, NOW);
  });

  it('SÓLO DUPLICADOS: `no_new_distinct_phone`, NUNCA `no_phone_found`', () => {
    // El caso que motiva el vocabulario nuevo. Lusha contestó y cobró; todos sus números ya
    // estaban. Decir `no_phone_found` afirmaría que el proveedor no tiene teléfono para esa
    // persona — falso, tiene el mismo — y el copy pasaría de «no hay números adicionales» a
    // «este contacto no tiene teléfono».
    const out = resolveSearchMoreOutcome(
      input({ providerOutcome: 'revealed', newDistinctPhoneCount: 0 }),
    );

    assert.equal(out.patch.lushaOutcome, 'no_new_distinct_phone');
    assert.notEqual(out.patch.lushaOutcome, 'no_phone_found');
    assert.notEqual(out.patch.lushaOutcome, 'revealed', 'SellUp no ganó ningún número');
    assert.equal(out.patch.status, 'exhausted');
    assert.equal(
      out.patch.finalProvider,
      'none',
      'ningún proveedor produjo un número que SellUp no tuviera',
    );
    assert.equal(out.result, 'no_new_phones');
    assert.equal(out.newDistinctPhoneCount, 0);
  });

  it('el costo de una corrida que sólo trajo duplicados se registra ENTERO', () => {
    // Se pagó por la respuesta. Perder el cobro porque no aportó nada nuevo haría que el
    // presupuesto contara menos de lo gastado, que es el defecto que corrigió #301.
    const out = resolveSearchMoreOutcome(
      input({ providerOutcome: 'revealed', newDistinctPhoneCount: 0, costCredits: 2 }),
    );
    assert.equal(out.patch.lushaCostCredits, 2);
    assert.equal(out.patch.lushaCostSource, 'reported');
  });

  it('SIN TELÉFONO en la fuente: `no_phone_found` sí es la afirmación correcta', () => {
    const out = resolveSearchMoreOutcome(input({ providerOutcome: 'no_phone_found' }));

    assert.equal(out.patch.lushaOutcome, 'no_phone_found');
    assert.equal(out.patch.status, 'exhausted');
    assert.equal(out.patch.errorCode, null, 'no encontrar no es un error');
    assert.equal(out.result, 'no_new_phones');
  });

  it('los dos casos «sin números nuevos» se distinguen en el ledger pero NO en pantalla', () => {
    // El operador no tiene que aprender la diferencia entre «la fuente no tiene teléfono» y
    // «tiene el mismo»: para él el resultado es el mismo. La auditoría sí la necesita.
    const noPhone = resolveSearchMoreOutcome(input({ providerOutcome: 'no_phone_found' }));
    const onlyDupes = resolveSearchMoreOutcome(
      input({ providerOutcome: 'revealed', newDistinctPhoneCount: 0 }),
    );

    assert.equal(noPhone.result, onlyDupes.result, 'mismo copy');
    assert.notEqual(
      noPhone.patch.lushaOutcome,
      onlyDupes.patch.lushaOutcome,
      'distinto hecho registrado',
    );
  });

  it('FALLO DEL PROVEEDOR: `error`, y jamás se degrada a «no encontramos»', () => {
    const out = resolveSearchMoreOutcome(input({ providerOutcome: 'error', persistStatus: null }));

    assert.equal(out.patch.status, 'error');
    assert.equal(out.patch.lushaOutcome, 'error');
    assert.notEqual(
      out.patch.lushaOutcome,
      'no_phone_found',
      'un fallo técnico no es evidencia sobre los datos de la persona',
    );
    assert.equal(out.patch.errorCode, 'provider_error');
    assert.equal(out.result, 'provider_error');
  });

  it('SUPRESIÓN bajo el lock: se retiene el NÚMERO, nunca el costo', () => {
    const out = resolveSearchMoreOutcome(
      input({ persistStatus: 'suppressed', costCredits: 2 }),
    );

    assert.equal(out.patch.status, 'aborted');
    assert.equal(out.patch.lushaSkippedReason, 'suppressed');
    assert.equal(out.patch.errorCode, 'blocked_suppressed');
    assert.equal(out.result, 'privacy_blocked');
    assert.equal(out.newDistinctPhoneCount, 0);
    assert.equal(
      out.patch.lushaCostCredits,
      2,
      'el proveedor ya cobró: registrar 0 perdería un cobro real',
    );
  });

  it('una ESCRITURA que no se pudo ejecutar NO es «no hay números nuevos»', () => {
    // El proveedor contestó, quizá con números, y no se sabe qué habría pasado. Cerrar como
    // `no_new_distinct_phone` afirmaría un hecho que nunca se obtuvo.
    for (const status of ['unavailable', 'invalid_input', 'candidate_not_eligible'] as const) {
      const out = resolveSearchMoreOutcome(input({ persistStatus: status }));
      assert.equal(out.patch.status, 'error', status);
      assert.equal(out.patch.errorCode, 'persist_unavailable', status);
      assert.equal(out.result, 'provider_error', status);
      assert.notEqual(out.patch.lushaOutcome, 'no_new_distinct_phone', status);
    }
  });

  it('un costo NO reportado es `unknown`, nunca 0: no reportar ≠ no cobrar', () => {
    const out = resolveSearchMoreOutcome(input({ costCredits: null }));
    assert.equal(out.patch.lushaCostSource, 'unknown');
    assert.equal(out.patch.lushaCostCredits, null);

    // Un 0 EXPLÍCITO sí es un dato reportado.
    const zero = resolveSearchMoreOutcome(input({ costCredits: 0 }));
    assert.equal(zero.patch.lushaCostSource, 'reported');
    assert.equal(zero.patch.lushaCostCredits, 0);
  });

  it('la corrida se cierra SIEMPRE, en todas las ramas', () => {
    // Una corrida `search_more` viva bloquea la siguiente por el índice único parcial de la
    // 102, así que dejarla abierta convertiría un fallo en una inhabilitación permanente del
    // botón.
    const cases: SearchMoreOutcomeInput[] = [
      input(),
      input({ newDistinctPhoneCount: 0 }),
      input({ providerOutcome: 'no_phone_found' }),
      input({ providerOutcome: 'error', persistStatus: null }),
      input({ persistStatus: 'suppressed' }),
      input({ persistStatus: 'unavailable' }),
      input({ persistStatus: 'no_incoming_phones', providerOutcome: 'no_phone_found' }),
    ];
    const TERMINAL = ['completed_lusha', 'exhausted', 'error', 'aborted'];
    for (const c of cases) {
      const out = resolveSearchMoreOutcome(c);
      assert.ok(TERMINAL.includes(out.patch.status ?? ''), JSON.stringify(c));
      assert.equal(out.patch.completedAt, NOW, JSON.stringify(c));
    }
  });

  it('el patch NUNCA toca la pata de Apollo', () => {
    // Apollo no corre bajo esta autorización. Escribir su desenlace o su costo re-atribuiría
    // a esta corrida un gasto que pagó otra.
    for (const c of [input(), input({ providerOutcome: 'error', persistStatus: null })]) {
      const out = resolveSearchMoreOutcome(c);
      assert.equal('apolloOutcome' in out.patch, false);
      assert.equal('apolloCostCredits' in out.patch, false);
      assert.equal('apolloCostSource' in out.patch, false);
    }
  });

  it('el patch NUNCA sella `lusha_attempted_at`: eso es del CLAIM, antes de la llamada', () => {
    const out = resolveSearchMoreOutcome(input());
    assert.equal(
      'lushaAttemptedAt' in out.patch,
      false,
      'mover la marca de «se reclamó» a «se terminó» perdería la garantía de a-lo-sumo-una-vez',
    );
  });

  it('un conteo negativo o no entero se lee como 0 (fail-closed)', () => {
    for (const count of [-3, 1.5, Number.NaN]) {
      const out = resolveSearchMoreOutcome(input({ newDistinctPhoneCount: count }));
      assert.equal(out.result, 'no_new_phones', String(count));
      assert.equal(out.newDistinctPhoneCount, 0, String(count));
    }
  });

  it('el fallo del proveedor gana a cualquier estado de escritura', () => {
    // Si el proveedor falló no hubo respuesta que escribir, así que un `persistStatus` que
    // llegara aquí sería incoherente y no puede reinterpretar el fallo.
    const out = resolveSearchMoreOutcome(
      input({ providerOutcome: 'error', persistStatus: 'persisted', newDistinctPhoneCount: 3 }),
    );
    assert.equal(out.result, 'provider_error');
    assert.equal(out.newDistinctPhoneCount, 0);
  });
});
