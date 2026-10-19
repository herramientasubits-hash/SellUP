/**
 * «Lo que no se encontró» (dueña 18-10): un campo por cada cosa y UN botón que agrega
 * todo junto y rehace los textos.
 */
import '../../chat/__tests__/jsdom-setup';

import * as React from 'react';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const saved: Array<{ briefId: string; answers: unknown[] }> = [];

mock.module('@/modules/speech/actions', {
  namedExports: {
    addFirstCallSellerAnswers: async (briefId: string, answers: unknown[]) => {
      saved.push({ briefId, answers });
      return { success: true, added: answers.length };
    },
  },
});

let rtl: typeof import('@testing-library/react');
let SellerAnswersForm: (typeof import('../seller-answers-form'))['SellerAnswersForm'];

before(async () => {
  rtl = await import('@testing-library/react');
  ({ SellerAnswersForm } = await import('../seller-answers-form'));
});

afterEach(() => {
  rtl.cleanup();
  saved.length = 0;
});

const QUESTIONS = [
  { question: 'No hay detalles de presupuesto de formación.', gapIndex: 0, contactId: null },
  { question: 'No se identificó el LMS que usan.', gapIndex: 1, contactId: null },
  { question: 'Faltan cifras de rotación.', gapIndex: 2, contactId: null },
];

describe('responder lo que no se encontró', () => {
  it('guarda las respuestas escritas juntas, con un solo botón, y avisa para rehacer los textos', async () => {
    const onSaved: number[] = [];
    rtl.render(React.createElement(SellerAnswersForm, { questions: QUESTIONS, briefId: 'b1', onSaved: (n: number) => onSaved.push(n) }));

    const button = rtl.screen.getByRole('button', { name: 'Agregar a la investigación y rehacer los textos' });
    assert.equal((button as HTMLButtonElement).disabled, true, 'sin respuestas no se puede agregar');

    rtl.fireEvent.change(rtl.screen.getByLabelText(/presupuesto de formación/), { target: { value: 'Unos 50.000 dólares al año.' } });
    rtl.fireEvent.change(rtl.screen.getByLabelText(/LMS/), { target: { value: 'Usan Moodle.' } });
    assert.ok(rtl.screen.getByText('2 respuestas listas.'));
    rtl.fireEvent.click(button);

    await rtl.waitFor(() => assert.deepEqual(onSaved, [2]));
    assert.equal(saved.length, 1, 'un solo guardado para todo el bloque');
    assert.deepEqual(saved[0].answers, [
      { question: QUESTIONS[0].question, text: 'Unos 50.000 dólares al año.', gapIndex: 0, contactId: null },
      { question: QUESTIONS[1].question, text: 'Usan Moodle.', gapIndex: 1, contactId: null },
    ]);
  });

  it('sin permiso (o agente apagado) sólo muestra las preguntas', () => {
    rtl.render(React.createElement(SellerAnswersForm, { questions: QUESTIONS, briefId: null }));
    assert.equal(rtl.screen.queryByRole('textbox'), null);
    assert.equal(rtl.screen.queryByRole('button'), null);
  });
});
