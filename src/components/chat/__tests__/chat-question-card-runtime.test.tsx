/**
 * ChatQuestionCard (Thema · chat) — contrato RUNTIME: tocar, tecla del número,
 * «Otro», pregunta respondida y opciones con detalle.
 * Porta `ChatQuestionCard.test.tsx` de Thema.
 */
import './jsdom-setup';

import * as React from 'react';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let rtl: typeof import('@testing-library/react');
let ChatQuestionCard: (typeof import('../chat-question-card'))['ChatQuestionCard'];

const question = { options: ['Una', 'Dos', 'Tres'], otherPlaceholder: 'Escribe cuántos quieres' };

function pressKey(key: string, init: KeyboardEventInit = {}): void {
  rtl.act(() => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
}

before(async () => {
  rtl = await import('@testing-library/react');
  ({ ChatQuestionCard } = await import('../chat-question-card'));
});

afterEach(() => rtl.cleanup());

describe('ChatQuestionCard', () => {
  it('tocar una opción la responde; la tecla del número también', () => {
    const onAnswer = mock.fn();
    rtl.render(<ChatQuestionCard question={question} active onAnswer={onAnswer} />);

    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Dos' }));
    assert.deepEqual(onAnswer.mock.calls.at(-1)?.arguments, ['Dos']);

    pressKey('3');
    assert.deepEqual(onAnswer.mock.calls.at(-1)?.arguments, ['Tres']);
  });

  it('un número fuera de rango o con modificador no responde', () => {
    const onAnswer = mock.fn();
    rtl.render(<ChatQuestionCard question={{ options: ['Una', 'Dos'] }} active onAnswer={onAnswer} />);
    pressKey('7');
    pressKey('1', { ctrlKey: true });
    pressKey('1', { metaKey: true });
    assert.equal(onAnswer.mock.callCount(), 0);
  });

  it('«Otro» envía lo escrito y su número lleva el foco al campo', () => {
    const onAnswer = mock.fn();
    rtl.render(<ChatQuestionCard question={question} active onAnswer={onAnswer} />);
    const other = rtl.screen.getByPlaceholderText('Escribe cuántos quieres') as HTMLInputElement;

    pressKey('4');
    assert.equal(document.activeElement, other);
    assert.equal(onAnswer.mock.callCount(), 0);

    rtl.fireEvent.change(other, { target: { value: '  Siete ' } });
    rtl.fireEvent.submit(other.closest('form') as HTMLFormElement);
    assert.deepEqual(onAnswer.mock.calls[0].arguments, ['Siete']);
  });

  it('sin `otherPlaceholder` no hay campo libre', () => {
    rtl.render(<ChatQuestionCard question={{ options: ['Sí', 'No'] }} active onAnswer={() => {}} />);
    assert.equal(rtl.screen.queryByText('Otro'), null);
  });

  it('respondida, enseña lo elegido y no deja elegir otra', () => {
    const onAnswer = mock.fn();
    rtl.render(<ChatQuestionCard question={{ ...question, answer: 'Dos' }} active onAnswer={onAnswer} />);

    assert.equal(rtl.screen.getByRole('button', { name: /Dos/ }).getAttribute('aria-pressed'), 'true');
    assert.ok(rtl.screen.getByTestId('chat-question').hasAttribute('data-answered'));
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Una' }));
    pressKey('1');
    assert.equal(onAnswer.mock.callCount(), 0);
  });

  it('inactiva (no es la última pregunta) no responde ni con clic ni con tecla', () => {
    const onAnswer = mock.fn();
    rtl.render(<ChatQuestionCard question={question} active={false} onAnswer={onAnswer} />);
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Una' }));
    pressKey('1');
    assert.equal(onAnswer.mock.callCount(), 0);
  });

  it('mientras se escribe en otro sitio, los números son números', () => {
    const onAnswer = mock.fn();
    rtl.render(
      <>
        <textarea aria-label="otra caja" />
        <ChatQuestionCard question={question} active onAnswer={onAnswer} />
      </>,
    );
    (rtl.screen.getByLabelText('otra caja') as HTMLTextAreaElement).focus();
    pressKey('1');
    assert.equal(onAnswer.mock.callCount(), 0);
  });

  it('opciones con detalle: devuelve el valor, pinta descripción y nota, y marca la elegida sin cerrar', () => {
    const onAnswer = mock.fn();
    rtl.render(
      <ChatQuestionCard
        aria-label="Tipo de búsqueda"
        question={{
          options: [
            { value: 'exploratory', label: 'Empresas por criterios', description: 'Por país e industria.' },
            { value: 'competitors', label: 'Competidores', hint: 'Próximamente', unavailable: true },
          ],
        }}
        selected="exploratory"
        active
        onAnswer={onAnswer}
      />,
    );
    assert.ok(rtl.screen.getByRole('group', { name: 'Tipo de búsqueda' }));
    assert.ok(rtl.screen.getByText('Por país e industria.'));
    const chosen = rtl.screen.getByRole('button', { name: /Empresas por criterios/ });
    assert.equal(chosen.getAttribute('aria-pressed'), 'true');

    const soon = rtl.screen.getByRole('button', { name: /Competidores/ });
    assert.equal(soon.getAttribute('aria-disabled'), 'true');
    // Se puede tocar: quien la monta explica por qué todavía no sirve.
    rtl.fireEvent.click(soon);
    assert.deepEqual(onAnswer.mock.calls[0].arguments, ['competitors']);
    pressKey('1');
    assert.deepEqual(onAnswer.mock.calls[1].arguments, ['exploratory']);
  });
});
