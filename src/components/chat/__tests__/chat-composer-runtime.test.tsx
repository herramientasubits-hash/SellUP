/**
 * ChatComposer (Thema · chat) — contrato RUNTIME: enviar con Enter, apagado,
 * chips de arranque, aviso de novedad y tope de caracteres.
 * Porta `ChatComposer.test.tsx` de Thema (sin el botón Voz, que SellUp no tiene).
 */
import './jsdom-setup';

import * as React from 'react';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let rtl: typeof import('@testing-library/react');
let ChatComposer: (typeof import('../chat-composer'))['ChatComposer'];
type Props = React.ComponentProps<(typeof import('../chat-composer'))['ChatComposer']>;

function Harness(props: Partial<Props>) {
  const [value, setValue] = React.useState(props.value ?? '');
  return <ChatComposer {...props} value={value} onChange={setValue} onSend={props.onSend ?? (() => {})} />;
}

function type(input: HTMLElement, text: string): void {
  rtl.fireEvent.change(input, { target: { value: text } });
}

before(async () => {
  rtl = await import('@testing-library/react');
  ({ ChatComposer } = await import('../chat-composer'));
});

afterEach(() => rtl.cleanup());

describe('ChatComposer', () => {
  it('Enter envía el texto recortado y vacía la caja; Shift+Enter no envía', () => {
    const onSend = mock.fn();
    rtl.render(<Harness onSend={onSend} />);
    const input = rtl.screen.getByTestId('chat-input') as HTMLTextAreaElement;

    type(input, '  hola\nmundo  ');
    rtl.fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    assert.equal(onSend.mock.callCount(), 0);

    rtl.fireEvent.keyDown(input, { key: 'Enter' });
    assert.equal(onSend.mock.callCount(), 1);
    assert.deepEqual(onSend.mock.calls[0].arguments, ['hola\nmundo', []]);
    assert.equal(input.value, '');
  });

  it('el botón de enviar manda lo mismo que Enter', () => {
    const onSend = mock.fn();
    rtl.render(<Harness onSend={onSend} />);
    type(rtl.screen.getByTestId('chat-input'), 'Acme');
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Enviar' }));
    assert.equal(onSend.mock.calls[0].arguments[0], 'Acme');
  });

  it('sin texto no se puede enviar y el halo queda apagado', () => {
    const onSend = mock.fn();
    const { container } = rtl.render(<Harness onSend={onSend} />);
    assert.equal((rtl.screen.getByTestId('chat-send') as HTMLButtonElement).disabled, true);
    assert.equal(container.querySelector('.chat-send-halo--on'), null);
    rtl.fireEvent.keyDown(rtl.screen.getByTestId('chat-input'), { key: 'Enter' });
    assert.equal(onSend.mock.callCount(), 0);

    type(rtl.screen.getByTestId('chat-input'), 'algo');
    assert.ok(container.querySelector('.chat-send-halo--on'), 'con texto el halo se enciende');
  });

  it('apagada: no se escribe, no se envía y no recorre el borde', () => {
    const onSend = mock.fn();
    const { container } = rtl.render(<Harness onSend={onSend} disabled value="texto previo" placeholder="Elige una opción" />);
    const input = rtl.screen.getByTestId('chat-input') as HTMLTextAreaElement;
    assert.equal(input.disabled, true);
    assert.equal(input.placeholder, 'Elige una opción');
    assert.equal((rtl.screen.getByTestId('chat-send') as HTMLButtonElement).disabled, true);
    rtl.fireEvent.keyDown(input, { key: 'Enter' });
    assert.equal(onSend.mock.callCount(), 0);
    assert.equal(container.querySelector('[data-slot="moving-border-beam"]'), null);
  });

  it('encendida pinta el borde que recorre, la pista de Enter y el aviso de errores', () => {
    const { container } = rtl.render(<Harness />);
    assert.ok(container.querySelector('[data-slot="moving-border-beam"]'));
    assert.ok(rtl.screen.getByText('para enviar'));
    assert.ok(rtl.screen.getByText(/El agente puede cometer errores/));
  });

  it('las fichas de arranque avisan al tocarlas y el aviso de novedad se cierra', () => {
    const onChip = mock.fn();
    rtl.render(
      <Harness chips={['Empresas de salud en Colombia']} onChip={onChip} news={{ text: 'Ya busca en **Perú**.' }} />,
    );
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Empresas de salud en Colombia' }));
    assert.deepEqual(onChip.mock.calls[0].arguments, ['Empresas de salud en Colombia']);

    assert.ok(rtl.screen.getByTestId('chat-news'));
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Cerrar novedad' }));
    assert.equal(rtl.screen.queryByTestId('chat-news'), null);
  });

  it('la pastilla de contexto se muestra y se puede quitar', () => {
    const onRemoveContext = mock.fn();
    rtl.render(<Harness contextChip="Acme S.A.S." onRemoveContext={onRemoveContext} />);
    assert.ok(rtl.screen.getByText('Acme S.A.S.'));
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Quitar contexto' }));
    assert.equal(onRemoveContext.mock.callCount(), 1);
  });

  it('el menú «+» no existe salvo que se pida: no hay controles que no hagan nada', () => {
    const { rerender } = rtl.render(<Harness />);
    assert.equal(rtl.screen.queryByTestId('chat-attach'), null);
    rerender(<Harness attach />);
    assert.ok(rtl.screen.getByTestId('chat-attach'));
  });

  it('pasado el tope de caracteres enseña el contador en rojo y no envía', () => {
    const onSend = mock.fn();
    rtl.render(<Harness onSend={onSend} maxLength={5} />);
    const input = rtl.screen.getByTestId('chat-input');
    type(input, 'abc');
    assert.equal(rtl.screen.getByTestId('chat-counter').textContent, '3/5');
    type(input, 'abcdefgh');
    assert.equal(rtl.screen.getByTestId('chat-counter').textContent, '8/5');
    assert.match(rtl.screen.getByTestId('chat-counter').className, /text-destructive/);
    rtl.fireEvent.keyDown(input, { key: 'Enter' });
    assert.equal(onSend.mock.callCount(), 0);
    assert.equal((input as HTMLTextAreaElement).value, 'abcdefgh', 'lo escrito no se pierde');
  });
});
