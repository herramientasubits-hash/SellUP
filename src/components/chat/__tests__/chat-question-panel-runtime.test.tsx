/**
 * ChatQuestionPanel — contrato RUNTIME de la pregunta acoplada del agente:
 * respuesta única al tocar o con el número, varias con tope y «Enviar», «Otro»
 * con su campo, «Omitir», filtro con muchas opciones y plegado.
 */
import './jsdom-setup';

import * as React from 'react';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let rtl: typeof import('@testing-library/react');
let ChatQuestionPanel: (typeof import('../chat-question-panel'))['ChatQuestionPanel'];
let ChatQuestionBackContext: (typeof import('../chat-question-panel'))['ChatQuestionBackContext'];

function pressKey(key: string): void {
  rtl.act(() => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

before(async () => {
  rtl = await import('@testing-library/react');
  ({ ChatQuestionPanel, ChatQuestionBackContext } = await import('../chat-question-panel'));
});

afterEach(() => rtl.cleanup());

describe('ChatQuestionPanel — una respuesta', () => {
  it('pinta la pregunta arriba y responde al tocar una opción', () => {
    const onAnswer = mock.fn();
    rtl.render(<ChatQuestionPanel title="¿En qué país?" options={['Colombia', 'Perú']} onAnswer={onAnswer} />);

    assert.ok(rtl.screen.getByRole('heading', { name: '¿En qué país?' }));
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: /Perú/ }));
    assert.deepEqual(onAnswer.mock.calls[0].arguments, ['Perú']);
  });

  it('responde con la tecla del número', () => {
    const onAnswer = mock.fn();
    rtl.render(<ChatQuestionPanel title="¿País?" options={['Colombia', 'Perú']} onAnswer={onAnswer} />);
    pressKey('2');
    assert.deepEqual(onAnswer.mock.calls[0].arguments, ['Perú']);
  });

  it('marca lo elegido antes (al volver a editar)', () => {
    rtl.render(<ChatQuestionPanel title="¿País?" options={['Colombia', 'Perú']} selected={['Perú']} onAnswer={() => {}} />);
    assert.equal(rtl.screen.getByRole('button', { name: /Perú/ }).getAttribute('aria-pressed'), 'true');
  });
});

describe('ChatQuestionPanel — varias respuestas', () => {
  function Host({ onSubmit }: { onSubmit: (values: string[]) => void }) {
    const [selected, setSelected] = React.useState<string[]>([]);
    return (
      <ChatQuestionPanel
        title="¿Subindustrias?"
        mode="multiple"
        max={2}
        options={['A', 'B', 'C']}
        selected={selected}
        onSelectionChange={setSelected}
        onSubmitSelection={onSubmit}
        onSkip={() => {}}
      />
    );
  }

  it('marca varias, respeta el tope y envía con «Enviar»', () => {
    const onSubmit = mock.fn();
    rtl.render(<Host onSubmit={onSubmit} />);
    const send = rtl.screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement;
    assert.equal(send.disabled, true);

    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: /^A/ }));
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: /^B/ }));
    assert.ok(rtl.screen.getByText('2/2 seleccionadas'));
    assert.equal((rtl.screen.getByRole('button', { name: /^C/ }) as HTMLButtonElement).disabled, true);

    rtl.fireEvent.click(send);
    assert.deepEqual(onSubmit.mock.calls[0].arguments, [['A', 'B']]);
  });

  it('ofrece «Omitir»', () => {
    rtl.render(<Host onSubmit={() => {}} />);
    assert.ok(rtl.screen.getByRole('button', { name: 'Omitir' }));
  });
});

describe('ChatQuestionPanel — «Otro», filtro y plegado', () => {
  it('«Otro» envía el texto escrito', () => {
    const onOther = mock.fn();
    rtl.render(
      <ChatQuestionPanel
        title="¿Algo más?"
        options={['No, continuar']}
        onAnswer={() => {}}
        otherPlaceholder="Escribe la característica"
        onOther={onOther}
      />,
    );
    rtl.fireEvent.change(rtl.screen.getByPlaceholderText('Escribe la característica'), {
      target: { value: ' más de 200 empleados ' },
    });
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Enviar' }));
    assert.deepEqual(onOther.mock.calls[0].arguments, ['más de 200 empleados']);
  });

  it('con muchas opciones aparece el filtro y acota la lista (sin tildes)', () => {
    const options = ['Colombia', 'México', 'Perú', 'Chile', 'Ecuador', 'Panamá', 'Uruguay', 'Paraguay', 'Bolivia'];
    rtl.render(<ChatQuestionPanel title="¿País?" options={options} onAnswer={() => {}} filterPlaceholder="Buscar país" />);
    rtl.fireEvent.change(rtl.screen.getByPlaceholderText('Buscar país'), { target: { value: 'mexi' } });
    assert.ok(rtl.screen.getByRole('button', { name: /México/ }));
    assert.equal(rtl.screen.queryByRole('button', { name: /Colombia/ }), null);
  });

  it('se pliega y se despliega', () => {
    rtl.render(<ChatQuestionPanel title="¿País?" options={['Colombia']} onAnswer={() => {}} />);
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Plegar las opciones' }));
    assert.equal(rtl.screen.queryByRole('button', { name: /Colombia/ }), null);
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Mostrar las opciones' }));
    assert.ok(rtl.screen.getByRole('button', { name: /Colombia/ }));
  });
});

describe('ChatQuestionPanel — «Volver» a la pregunta anterior', () => {
  it('sin «Volver» no hay botón; con él, va junto a los demás y vuelve', () => {
    rtl.render(<ChatQuestionPanel title="¿País?" options={['Colombia']} onAnswer={() => {}} />);
    assert.equal(rtl.screen.queryByRole('button', { name: 'Volver' }), null);
    rtl.cleanup();
    const onBack = mock.fn();
    rtl.render(
      <ChatQuestionPanel title="¿Canales?" mode="multiple" options={['Llamada', 'Correo']} selected={['Llamada']} onBack={onBack} onSubmitSelection={() => {}} submitLabel="Continuar" />,
    );
    const back = rtl.screen.getByRole('button', { name: 'Volver' });
    const next = rtl.screen.getByRole('button', { name: 'Continuar' });
    assert.ok(back.compareDocumentPosition(next) & window.Node.DOCUMENT_POSITION_FOLLOWING, '«Volver» antes del botón principal');
    rtl.fireEvent.click(back);
    assert.equal(onBack.mock.callCount(), 1);
  });

  it('una pregunta de una sola respuesta también muestra «Volver»', () => {
    const onBack = mock.fn();
    rtl.render(<ChatQuestionPanel title="¿Industria?" options={['Retail']} onAnswer={() => {}} onBack={onBack} />);
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Volver' }));
    assert.equal(onBack.mock.callCount(), 1);
  });

  it('lo toma del asistente (contexto) y `null` lo quita en una pregunta concreta', () => {
    const onBack = mock.fn();
    rtl.render(
      <ChatQuestionBackContext.Provider value={onBack}>
        <ChatQuestionPanel title="¿Industria?" options={['Retail']} onAnswer={() => {}} />
      </ChatQuestionBackContext.Provider>,
    );
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Volver' }));
    assert.equal(onBack.mock.callCount(), 1);
    rtl.cleanup();
    rtl.render(
      <ChatQuestionBackContext.Provider value={onBack}>
        <ChatQuestionPanel title="¿Ramas?" options={['Filiales']} onAnswer={() => {}} onBack={null} />
      </ChatQuestionBackContext.Provider>,
    );
    assert.equal(rtl.screen.queryByRole('button', { name: 'Volver' }), null);
  });
});
