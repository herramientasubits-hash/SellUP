/**
 * Piezas del hilo (Thema · chat) — contrato RUNTIME: ChatThinking (contador),
 * ChatMark, ChatAgentMessage (acciones opcionales, error, Markdown),
 * ChatUserMessage (editar) y ChatCardView.
 */
import './jsdom-setup';

import * as React from 'react';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let rtl: typeof import('@testing-library/react');
let chat: typeof import('../index');
type ChatMessage = import('../types').ChatMessage;

const agent = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a1',
  role: 'agent',
  text: 'Hola',
  createdAt: 0,
  status: 'done',
  ...over,
});

before(async () => {
  rtl = await import('@testing-library/react');
  chat = await import('../index');
});

afterEach(() => {
  rtl.cleanup();
  mock.timers.reset();
});

describe('ChatThinking', () => {
  it('enseña «Razonando…», la marca girando y cuenta los segundos desde `since`', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: 100_000 });
    const { container } = rtl.render(<chat.ChatThinking since={100_000} />);
    const status = rtl.screen.getByRole('status');
    assert.match(status.textContent ?? '', /Razonando…/);
    assert.equal(container.querySelector('[data-slot="chat-mark"]')?.getAttribute('data-motion'), 'thinking');
    assert.doesNotMatch(status.textContent ?? '', /\d s/, 'en el segundo cero no hay contador');

    rtl.act(() => mock.timers.tick(3000));
    assert.match(status.textContent ?? '', /3 s/);
  });

  it('acepta un rótulo propio y arranca contando lo que ya lleva', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: 50_000 });
    rtl.render(<chat.ChatThinking label="Buscando en Apollo…" since={38_000} />);
    assert.match(rtl.screen.getByRole('status').textContent ?? '', /Buscando en Apollo…12 s/);
  });
});

describe('ChatMark', () => {
  it('es decorativa y lleva el gradiente de IA del tema, no un color propio', () => {
    const { container } = rtl.render(<chat.ChatMark size="md" motion="breathing" />);
    const mark = container.querySelector('[data-slot="chat-mark"]') as HTMLElement;
    assert.equal(mark.getAttribute('aria-hidden'), 'true');
    assert.match(mark.className, /bg-ai-gradient/);
    assert.match(mark.className, /chat-mark--breathing/);
    assert.equal(mark.getAttribute('style'), null);
  });
});

describe('ChatAgentMessage', () => {
  it('sin burbuja, con la marca y con Markdown ligero (negrita, lista, enlace seguro)', () => {
    const { container } = rtl.render(
      <chat.ChatAgentMessage
        isLast
        message={agent({ text: '**Listo**\n- uno\n- dos\n[ver](https://example.com) [malo](javascript:alert(1))' })}
      />,
    );
    assert.ok(container.querySelector('[data-slot="chat-mark"]'));
    assert.equal(container.querySelector('strong')?.textContent, 'Listo');
    assert.equal(container.querySelectorAll('li').length, 2);
    const links = container.querySelectorAll('a');
    assert.equal(links.length, 1, 'un enlace que no es http(s) ni interno no se enlaza');
    assert.equal(links[0].getAttribute('rel'), 'noreferrer');
  });

  it('solo pinta las acciones que tienen quién las atienda', () => {
    const { rerender } = rtl.render(<chat.ChatAgentMessage isLast message={agent()} />);
    assert.ok(rtl.screen.getByRole('button', { name: 'Copiar' }));
    assert.equal(rtl.screen.queryByRole('button', { name: 'Útil' }), null);
    assert.equal(rtl.screen.queryByRole('button', { name: 'No útil' }), null);
    assert.equal(rtl.screen.queryByRole('button', { name: 'Regenerar' }), null);
    assert.equal(rtl.screen.queryByRole('button', { name: 'Más opciones' }), null);

    const onFeedback = mock.fn();
    const onRegenerate = mock.fn();
    rerender(<chat.ChatAgentMessage isLast message={agent()} onFeedback={onFeedback} onRegenerate={onRegenerate} />);
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Útil' }));
    assert.deepEqual(onFeedback.mock.calls[0].arguments, ['up']);
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Regenerar' }));
    assert.equal(onRegenerate.mock.callCount(), 1);
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'No útil' }));
    assert.ok(rtl.screen.getByTestId('chat-feedback'), '«No útil» pregunta qué falló');
  });

  it('pendiente enseña ChatThinking; con error ofrece Reintentar', () => {
    const { rerender } = rtl.render(<chat.ChatAgentMessage isLast message={agent({ status: 'pending' })} />);
    assert.ok(rtl.screen.getByTestId('chat-thinking'));

    const onRegenerate = mock.fn();
    rerender(<chat.ChatAgentMessage isLast message={agent({ status: 'error', text: '' })} onRegenerate={onRegenerate} />);
    assert.match(rtl.screen.getByRole('alert').textContent ?? '', /No pude responder/);
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Reintentar' }));
    assert.equal(onRegenerate.mock.callCount(), 1);
  });

  it('las sugerencias para seguir son Chips y solo salen en la última respuesta', () => {
    const onFollowup = mock.fn();
    const message = agent({ followups: ['Otra industria'] });
    const { rerender } = rtl.render(<chat.ChatAgentMessage isLast={false} message={message} onFollowup={onFollowup} />);
    assert.equal(rtl.screen.queryByTestId('chat-followups'), null);
    rerender(<chat.ChatAgentMessage isLast message={message} onFollowup={onFollowup} />);
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Otra industria' }));
    assert.deepEqual(onFollowup.mock.calls[0].arguments, ['Otra industria']);
  });
});

describe('ChatUserMessage', () => {
  const user: ChatMessage = { id: 'u1', role: 'user', text: 'Colombia', createdAt: 0, status: 'done' };

  it('sin manejador no hay «Editar»; con `onEdit` se corrige en línea', () => {
    const { rerender } = rtl.render(<chat.ChatUserMessage message={user} />);
    assert.equal(rtl.screen.queryByRole('button', { name: 'Editar' }), null);

    const onEdit = mock.fn();
    rerender(<chat.ChatUserMessage message={user} onEdit={onEdit} />);
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Editar' }));
    const box = rtl.screen.getByRole('textbox', { name: 'Editar' });
    rtl.fireEvent.change(box, { target: { value: 'Perú' } });
    rtl.fireEvent.keyDown(box, { key: 'Enter' });
    assert.deepEqual(onEdit.mock.calls[0].arguments, ['Perú']);
  });

  it('`onEditRequest` devuelve al paso en vez de abrir un campo', () => {
    const onEditRequest = mock.fn();
    rtl.render(<chat.ChatUserMessage message={user} onEditRequest={onEditRequest} editLabel="Editar respuesta: Colombia" />);
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Editar respuesta: Colombia' }));
    assert.equal(onEditRequest.mock.callCount(), 1);
    assert.equal(rtl.screen.queryByTestId('chat-user-edit'), null);
  });
});

describe('ChatCardView', () => {
  it('`rows` pinta cada par con sus data-testid y la aclaración debajo', () => {
    const { container } = rtl.render(
      <chat.ChatCardView
        data-testid="resumen"
        card={{
          kind: 'rows',
          title: 'Resultado',
          rows: [
            { key: 'saved', label: 'Guardadas', value: '4', hint: 'En el lote.' },
            { key: 'provider', label: 'Fuente', value: 'Lusha', testId: 'fuente-propia' },
          ],
        }}
      />,
    );
    assert.equal(rtl.screen.getByTestId('resumen-value-saved').textContent, '4');
    assert.match(rtl.screen.getByTestId('resumen-row-saved').textContent ?? '', /En el lote\./);
    assert.equal(rtl.screen.getByTestId('fuente-propia').textContent, 'Lusha');
    assert.equal(container.querySelectorAll('dt').length, 2);
  });

  it('`metrics` y `bars` (las de Thema) pintan cifras y barras', () => {
    const { rerender, container } = rtl.render(
      <chat.ChatCardView card={{ kind: 'metrics', items: [{ label: 'Nuevas', value: '12', delta: '+3', tone: 'positive' }] }} />,
    );
    assert.match(rtl.screen.getByTestId('chat-card').textContent ?? '', /Nuevas12\+3/);
    rerender(<chat.ChatCardView card={{ kind: 'bars', title: 'Por país', rows: [{ label: 'CO', value: 60 }] }} />);
    assert.ok(container.querySelector('[data-slot="progress"]'));
    assert.match(rtl.screen.getByTestId('chat-card').textContent ?? '', /60%/);
  });
});
