/**
 * AGENT3-WRITER-ROBUST-1 — corrida real de Grupo Ciisa (18-10): el redactor (Haiku)
 * entregó sin mensajes, objeciones ni pedido de reunión y las 4 preparaciones fallaron.
 * El lector ahora tolera listas entregadas como texto JSON, claves en camelCase y
 * mensajes con el canal como clave; una llamada con guion no se pierde por faltar el
 * mensaje de voz; y el registro de uso guarda la forma de la entrega cuando falla.
 *
 * Sin red ni base de datos.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { AnthropicContentBlock } from '../../prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { contentForChannel, describeSubmissionShape, extractWriterSubmission, parseWriterSubmission } from '../pack-verifier';
import { WRITER_SUBMIT_TOOL } from '../writer-prompt';

function toolUse(input: unknown): AnthropicContentBlock[] {
  return [{ type: 'tool_use', id: 'tu_1', name: WRITER_SUBMIT_TOOL, input } as AnthropicContentBlock];
}

const MESSAGES = [
  { channel: 'call', text: 'Emily, le dejé un correo.', fact_refs: ['F1'] },
  { channel: 'email', text: 'Asunto: Líderes\nEmily, ¿le sirve?', fact_refs: ['F1'] },
];
const OBJECTIONS = [{ library_key: 'send_info', objection: 'Mándeme información.', response: 'Con gusto, ¿cuál es el reto?' }];

describe('redactor · entregas con forma distinta', () => {
  it('lee listas que llegan como texto JSON (mensajes y objeciones)', () => {
    const raw = extractWriterSubmission(
      toolUse({
        reason_to_call: { text: 'Abrió sede.', fact_refs: ['F1'] },
        messages: JSON.stringify(MESSAGES),
        objections: JSON.stringify(OBJECTIONS),
        questions: JSON.stringify(['¿Cómo forman a los líderes?', '¿Quién decide?', '¿Cómo miden?']),
        meeting_ask: 'Martes 10:00 o jueves 16:00.',
      }),
    )!;
    const submission = parseWriterSubmission(raw, ['call', 'email']);
    assert.equal(submission.messages.email?.text, 'Asunto: Líderes\nEmily, ¿le sirve?');
    assert.equal(submission.shared.objections.length, 1);
    assert.equal(submission.shared.questions.length, 3);
    assert.equal(submission.shared.meetingAsk, 'Martes 10:00 o jueves 16:00.');
  });

  it('acepta claves en camelCase y mensajes con el canal como clave', () => {
    const raw = extractWriterSubmission(
      toolUse({
        reasonToCall: { text: 'Abrió sede.', factRefs: ['F1'] },
        meetingAsk: 'Martes 10:00 o jueves 16:00.',
        ifNo: 'Preguntar cuándo planean el presupuesto.',
        messages: { call: { text: 'Emily, le dejé un correo.', factRefs: ['F1'] }, email: { text: 'Asunto: Líderes\nEmily, ¿le sirve?' } },
      }),
    )!;
    const submission = parseWriterSubmission(raw, ['call', 'email']);
    assert.equal(submission.shared.reasonToCall.text, 'Abrió sede.');
    assert.deepEqual(submission.shared.reasonToCall.factRefs, ['F1']);
    assert.equal(submission.shared.ifNo, 'Preguntar cuándo planean el presupuesto.');
    assert.equal(submission.messages.call?.text, 'Emily, le dejé un correo.');
    assert.equal(submission.messages.email?.text, 'Asunto: Líderes\nEmily, ¿le sirve?');
  });

  it('un texto con referencias que llega como texto plano se lee sin citas', () => {
    const raw = extractWriterSubmission(toolUse({ call_script: 'Buenos días Emily…', messages: MESSAGES }))!;
    const content = contentForChannel(parseWriterSubmission(raw, ['call']), 'call');
    assert.equal(content.callScript.text, 'Buenos días Emily…');
    assert.deepEqual(content.callScript.factRefs, []);
  });

  it('un texto que empieza con corchete no se confunde con JSON', () => {
    const raw = extractWriterSubmission(
      toolUse({ messages: [{ channel: 'whatsapp', text: '[nombre], buenos días. ¿Le puedo escribir por aquí?', fact_refs: [] }] }),
    )!;
    assert.equal(parseWriterSubmission(raw, ['whatsapp']).messages.whatsapp?.text, '[nombre], buenos días. ¿Le puedo escribir por aquí?');
  });

  it('describe la forma de la entrega sin su contenido', () => {
    assert.deepEqual(describeSubmissionShape({ messages: 'texto', objections: [1, 2], meeting_ask: null }), {
      messages: 'string',
      objections: 'array(2)',
      meeting_ask: 'null',
    });
    assert.deepEqual(describeSubmissionShape(null), { submission: 'missing' });
  });
});
