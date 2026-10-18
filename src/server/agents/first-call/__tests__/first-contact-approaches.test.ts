/**
 * AGENT3-APPROACHES-1 — lo que sale del «Manual del primer contacto» (17-10-2026):
 * enfoques, recomendación, horario, reglas nuevas del verificador, versiones por
 * enfoque, resultado del contacto y el paso «Enfoque» del asistente.
 *
 * Sin red ni base de datos.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  APPROACH_DEFINITIONS,
  FIRST_CONTACT_APPROACHES,
  RECOMMENDED_APPROACH,
  bestContactWindow,
  isApproachAvailable,
  recommendApproach,
} from '../approaches';
import { EMAIL_OPT_OUT_LINE, contentForChannel, parseWriterSubmission, splitEmail, verifyPack } from '../pack-verifier';
import { mapPackRow } from '../row-mappers';
import { hasRecentSignal } from '../run-first-call';
import type { ResearchFact } from '../types';
import { BANNED_PHRASES, UBITS_CLAIMS, UBITS_OFFERS, addressFormFor, renderLibraryForPrompt } from '../ubits-messaging-library';
import { buildWriterSubmitTool, buildWriterSystemPrompt, buildWriterUserMessage } from '../writer-prompt';
import { parseFirstCallRequest } from '../../../../modules/speech/first-call-request';
import {
  approachOptions,
  approachesFrom,
  buildFirstContactRequestBody,
  normalizeApproachSelection,
  summaryText,
} from '../../../../modules/speech/first-contact-wizard';

const ACCOUNT = '7d2b8c5e-1f3a-4b6c-9d8e-0a1b2c3d4e5f';
const NOW = Date.parse('2026-10-17T12:00:00Z');

function fact(id: string, statement: string, publishedOn: string | null = null, topic: ResearchFact['topic'] = 'recent_signal'): ResearchFact {
  return { id, topic, statement, quote: null, sourceKind: 'news', sourceUrl: null, sourceLabel: 'Noticia', publishedOn };
}

const FACTS = [fact('F1', 'Integró las operaciones de Scotiabank.', '2026-09-20'), fact('F2', 'Abrió una sede en Cali.', '2025-11-01')];

const SCRIPT =
  'Buenos días Laura, le habla Elkin de UBITS. Sé que no esperaba mi llamada. ¿Me regala 30 segundos y usted decide si seguimos? La llamo porque vi la integración con Scotiabank. ' +
  'Los líderes de talento con los que hablo me cuentan que lo difícil es que los jefes de los dos lados lideren igual. '.repeat(2) +
  '¿Cómo lo están manejando hoy?';

function raw(overrides: Record<string, unknown> = {}) {
  return {
    approach: 'trigger',
    approach_reason: 'Hay una integración de hace menos de un mes.',
    reason_to_call: { text: 'Integró las operaciones de Scotiabank.', fact_refs: ['F1'] },
    angle: 'Que los líderes de los dos bancos lideren igual.',
    product_key: null,
    call_script: { text: SCRIPT, fact_refs: ['F1'] },
    call_opener_variants: [{ approach: 'insight', text: 'Laura, el 49 % de los líderes de talento dice que a su alta dirección le preocupa que la gente no tenga las habilidades para ejecutar la estrategia.', fact_refs: [] }],
    messages: [
      { channel: 'call', text: 'Laura, le dejé un correo sobre la integración con Scotiabank.', fact_refs: ['F1'], variants: [] },
      {
        channel: 'email',
        text: 'Asunto: Líderes tras la integración\nLaura, vi que integraron Scotiabank. En integraciones así cuesta que los jefes lideren igual. ¿Le sirve que le comparta cómo lo abordan otros bancos?',
        fact_refs: ['F1'],
        variants: [
          { approach: 'insight', text: 'Asunto: Habilidades y estrategia\nLaura, el 49 % de los líderes de talento dice que a su alta dirección le preocupa que la gente no tenga las habilidades para ejecutar la estrategia. ¿Le comparto lo que vemos en el sector?', fact_refs: [] },
          { approach: 'trigger', text: 'duplicado del principal: se descarta', fact_refs: [] },
        ],
      },
    ],
    meeting_ask: '¿Le parece si lo vemos 20 minutos el martes a las 10 o el jueves a las 4? Le muestro casos de su sector.',
    questions: ['¿Cómo forman hoy a los líderes nuevos?', '¿Quién define la inducción?', '¿Cómo miden el avance?'],
    objections: [{ library_key: 'not_interested', objection: 'No me interesa.', response: 'Es justo. ¿Es porque ya lo tienen resuelto o porque no es prioridad?' }],
    if_no: 'Si no es momento, preguntar si le escribo el próximo trimestre y dejar esa fecha.',
    next_step: 'Agendar 20 minutos.',
    confirmation: 'Quedamos el martes a las 10. Agenda: su reto con los líderes nuevos y casos de su sector.',
    cautions: [],
    ...overrides,
  };
}

describe('enfoques y recomendación', () => {
  it('hay ocho enfoques con regla; «Pares» queda apagado hasta tener la lista de clientes', () => {
    assert.equal(FIRST_CONTACT_APPROACHES.length, 8);
    for (const a of FIRST_CONTACT_APPROACHES) assert.ok(APPROACH_DEFINITIONS[a].rule.length > 20, a);
    assert.equal(isApproachAvailable('peers'), false);
    assert.equal(isApproachAvailable('trigger'), true);
  });

  it('recomienda según país, decisor, noticia reciente y cargo', () => {
    const base = { title: 'Gerente de formación', hasRecentSignal: false, hasDecisionMaker: true, countryCode: 'CO' };
    assert.equal(recommendApproach({ ...base, countryCode: 'PE' }), 'permission');
    assert.equal(recommendApproach({ ...base, hasDecisionMaker: false }), 'who_decides');
    assert.equal(recommendApproach({ ...base, hasRecentSignal: true }), 'trigger');
    assert.equal(recommendApproach({ ...base, title: 'CHRO' }), 'insight');
    assert.equal(recommendApproach(base), 'problem');
  });

  it('una señal reciente es de los últimos 90 días y con fecha', () => {
    assert.equal(hasRecentSignal([fact('F1', 'x', '2026-09-20')], NOW), true);
    assert.equal(hasRecentSignal([fact('F2', 'x', '2025-11-01')], NOW), false);
    assert.equal(hasRecentSignal([fact('F3', 'x', null)], NOW), false);
  });

  it('el horario sugerido usa la hora del país y el límite legal', () => {
    const call = bestContactWindow('CO', 'call');
    assert.match(call, /10:00 a 11:00 o de 14:00 a 15:00, hora de Colombia/);
    assert.match(call, /7:00–19:00/);
    assert.match(bestContactWindow('MX', 'email'), /Enviar entre 8:00 y 10:00, hora de Ciudad de México/);
    assert.match(bestContactWindow(null, 'call'), /el país del contacto/);
  });

  it('primer contacto siempre de «usted», y la biblioteca trae datos de industria y ofertas', () => {
    assert.equal(addressFormFor('MX'), 'usted');
    assert.equal(addressFormFor('CL'), 'usted');
    assert.ok(UBITS_CLAIMS.some((c) => c.source.includes('LinkedIn Workplace Learning Report 2025')));
    assert.ok(UBITS_OFFERS.length >= 2);
    assert.match(renderLibraryForPrompt(), /Lo que se puede ofrecer/);
    assert.ok(BANNED_PHRASES.includes('cómo ha estado'));
  });
});

describe('solicitud y redactor con enfoques', () => {
  it('acepta hasta 3 enfoques; la referencia sólo cuenta con nombre; «Pares» no pasa', () => {
    const ok = parseFirstCallRequest({ accountId: ACCOUNT, channels: ['call'], approaches: ['trigger', 'referral'], referralNote: 'María Gómez, de Bancolombia' });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.deepEqual(ok.request.approaches, ['trigger', 'referral']);
      assert.equal(ok.request.referralNote, 'María Gómez, de Bancolombia');
    }
    const noNote = parseFirstCallRequest({ accountId: ACCOUNT, channels: ['call'], approaches: ['referral', 'problem'] });
    assert.equal(noNote.ok && noNote.request.approaches.join(), 'problem');
    const noteWithout = parseFirstCallRequest({ accountId: ACCOUNT, channels: ['call'], approaches: ['problem'], referralNote: 'Alguien' });
    assert.equal(noteWithout.ok && noteWithout.request.referralNote, null);
    assert.equal(parseFirstCallRequest({ accountId: ACCOUNT, channels: ['call'], approaches: ['peers'] }).ok, false);
    assert.equal(parseFirstCallRequest({ accountId: ACCOUNT, channels: ['call'], approaches: ['trigger', 'problem', 'insight', 'permission'] }).ok, false);
  });

  it('la herramienta pide versiones sólo por los enfoques extra y limita el enfoque a los pedidos', () => {
    const tool = buildWriterSubmitTool(['call', 'email'], ['trigger', 'insight']);
    assert.deepEqual(tool.input_schema.properties.approach.enum, ['trigger', 'insight']);
    const props = tool.input_schema.properties as unknown as Record<string, { maxItems?: number; items?: { properties: Record<string, { maxItems?: number }> } }>;
    assert.equal(props.call_opener_variants?.maxItems, 1);
    assert.equal(props.messages.items?.properties.variants?.maxItems, 1);
    // Sin enfoques extra, el formulario no pide listas de versiones (más simple para modelos chicos).
    const single = buildWriterSubmitTool(['email'], []);
    const singleProps = single.input_schema.properties as unknown as Record<string, { items?: { properties: Record<string, unknown> } }>;
    assert.equal(singleProps.call_opener_variants, undefined);
    assert.equal(singleProps.messages.items?.properties.variants, undefined);
    assert.ok(!single.input_schema.required.includes('call_opener_variants'));
    assert.ok(!single.input_schema.properties.approach.enum.includes('referral' as never));
    assert.ok(tool.input_schema.required.includes('meeting_ask'));
  });

  it('las instrucciones llevan el manual: vender la reunión, permiso, interés por escrito y Perú', () => {
    const system = buildWriterSystemPrompt();
    assert.match(system, /vendes la reunión, no la plataforma/);
    assert.match(system, /me regala 30 segundos/);
    assert.match(system, /pide INTERÉS/);
    assert.match(system, /Perú/);
    assert.match(system, /# Enfoques disponibles/);
    const user = buildWriterUserMessage({
      companyName: 'Davivienda',
      countryName: 'Perú',
      addressForm: 'usted',
      sellerName: 'Elkin',
      decisionMaker: { name: 'Laura', title: 'CHRO', roleFocus: 'x' },
      channels: ['call'],
      goals: ['book_meeting'],
      productKeys: [],
      approaches: [],
      recommendedApproach: 'permission',
      referralNote: 'María Gómez',
      countryCode: 'PE',
      briefStatus: 'sufficient',
      summary: null,
      facts: FACTS,
      hypotheses: [],
      gaps: [],
      hubspotWarning: null,
      regenerationReason: null,
    });
    assert.match(user, /Recomendado por el manual para este caso: permission/);
    assert.match(user, /Referencia .*«María Gómez»/);
    assert.match(user, /regla especial: Perú/);
  });
});

describe('versiones por enfoque y correo', () => {
  it('separa las versiones por canal sin repetir el enfoque principal, y agrega la línea para dejar de recibir correos', () => {
    const submission = parseWriterSubmission(raw(), ['call', 'email']);
    const email = contentForChannel(submission, 'email');
    const call = contentForChannel(submission, 'call');
    assert.equal(email.approach, 'trigger');
    assert.deepEqual(email.variants?.map((v) => v.approach), ['insight']);
    assert.ok(email.shortMessage.text.endsWith(EMAIL_OPT_OUT_LINE));
    assert.ok(email.variants?.[0].text.endsWith(EMAIL_OPT_OUT_LINE));
    assert.deepEqual(call.variants?.map((v) => v.approach), ['insight']);
    assert.equal(call.meetingAsk?.startsWith('¿Le parece'), true);
    assert.deepEqual(verifyPack(email, FACTS, 'email', { nowMs: NOW }), []);
    assert.deepEqual(verifyPack(call, FACTS, 'call', { nowMs: NOW }), []);
  });

  it('separa asunto y cuerpo del correo', () => {
    const { subject, body } = splitEmail(`Asunto: Hola Laura\n\nCuerpo corto.\n\n${EMAIL_OPT_OUT_LINE}`);
    assert.equal(subject, 'Hola Laura');
    assert.equal(body, 'Cuerpo corto.');
  });
});

describe('verificador · reglas del manual', () => {
  function emailIssues(text: string, extra: Record<string, unknown> = {}) {
    const submission = parseWriterSubmission(raw({ messages: [{ channel: 'email', text, fact_refs: ['F1'], variants: [] }], ...extra }), ['email']);
    return verifyPack(contentForChannel(submission, 'email'), FACTS, 'email', { nowMs: NOW });
  }

  it('el correo necesita asunto corto y cuerpo de 50 a 90 palabras', () => {
    assert.ok(emailIssues('Laura, vi la integración. ¿Le sirve?').some((i) => i.includes('«Asunto: …»')));
    assert.ok(emailIssues('Asunto: Una pregunta sobre la integración de los dos bancos\nLaura, ¿le sirve?').some((i) => i.includes('asunto es largo')));
    assert.ok(emailIssues(`Asunto: Líderes\n${'Laura, vi la integración con Scotiabank y quería contarle algo. '.repeat(14)}`).some((i) => i.includes('correo es largo')));
  });

  it('sin enlaces ni calendario, y un solo pedido', () => {
    assert.ok(emailIssues('Asunto: Líderes\nLaura, agende aquí: https://calendly.com/elkin').some((i) => i.includes('enlace')));
    assert.ok(emailIssues('Asunto: Líderes\nLaura, ¿cómo forman a los líderes? ¿Quién lo lleva? ¿Lo vemos?').some((i) => i.includes('más de un pedido')));
  });

  it('no tutea en el primer contacto', () => {
    assert.ok(emailIssues('Asunto: Líderes\nLaura, vi la integración. ¿Te sirve que te comparta lo que vemos?').some((i) => i.includes('usted')));
  });

  it('con el enfoque «evento reciente», la noticia citada debe tener menos de 90 días', () => {
    const issues = emailIssues('Asunto: Líderes\nLaura, vi la nueva sede. ¿Le sirve?', {
      reason_to_call: { text: 'Abrió una sede en Cali.', fact_refs: ['F2'] },
    });
    assert.ok(issues.some((i) => i.includes('más de 90 días')), issues.join(' | '));
  });

  it('revisa también las otras versiones y lo nuevo (pedido, confirmación)', () => {
    const submission = parseWriterSubmission(
      raw({
        confirmation: '',
        messages: [
          {
            channel: 'whatsapp',
            text: 'Laura, ¿le puedo escribir por aquí?',
            fact_refs: [],
            variants: [{ approach: 'problem', text: 'Laura, ¿cómo ha estado? Trabajamos con bancos como ustedes.', fact_refs: [] }],
          },
        ],
      }),
      ['whatsapp'],
    );
    const issues = verifyPack(contentForChannel(submission, 'whatsapp'), FACTS, 'whatsapp', { nowMs: NOW });
    assert.ok(issues.some((i) => i.includes('cómo ha estado')), issues.join(' | '));
    assert.ok(issues.some((i) => i.includes('clientes o casos de UBITS')));
    assert.ok(issues.some((i) => i.includes('confirmar la reunión')));
  });
});

describe('preparación guardada', () => {
  it('lee las versiones y el resultado del contacto; ignora lo que no reconoce', () => {
    const pack = mapPackRow({
      id: 'p',
      account_id: 'a',
      status: 'used',
      channel: 'email',
      goal: 'book_meeting',
      created_at: '2026-10-17T00:00:00Z',
      pack: {
        callScript: { text: '', factRefs: [] },
        reasonToCall: { text: 'x', factRefs: [] },
        shortMessage: { text: 'y', factRefs: [] },
        approach: 'trigger',
        variants: [{ approach: 'insight', text: 'z', factRefs: [] }, { approach: 'magia', text: 'w' }],
        meetingAsk: 'martes o jueves',
        outcome: { result: 'meeting_booked', at: '2026-10-18T10:00:00Z' },
      },
    });
    assert.equal(pack.content?.approach, 'trigger');
    assert.deepEqual(pack.content?.variants?.map((v) => v.approach), ['insight']);
    assert.equal(pack.content?.meetingAsk, 'martes o jueves');
    assert.deepEqual(pack.outcome, { result: 'meeting_booked', at: '2026-10-18T10:00:00Z' });
    const odd = mapPackRow({ id: 'p', account_id: 'a', status: 'used', channel: 'email', goal: 'x', created_at: '2026-10-17T00:00:00Z', pack: { callScript: {}, outcome: { result: 'gané', at: 'x' } } });
    assert.equal(odd.outcome, null);
  });
});

describe('asistente · paso «Enfoque»', () => {
  it('ofrece «el que recomiende el agente» primero y «Pares» apagado', () => {
    const options = approachOptions();
    assert.equal(options[0].value, RECOMMENDED_APPROACH);
    const peers = options.find((o) => o.value === 'peers');
    assert.equal(peers?.unavailable, true);
    assert.equal(peers?.hint, 'Próximamente');
  });

  it('«el que recomiende» excluye a los demás, tope de 3 y sin apagados', () => {
    assert.deepEqual(normalizeApproachSelection(['trigger'], ['trigger', RECOMMENDED_APPROACH]), [RECOMMENDED_APPROACH]);
    assert.deepEqual(normalizeApproachSelection([RECOMMENDED_APPROACH], [RECOMMENDED_APPROACH, 'problem']), ['problem']);
    assert.equal(normalizeApproachSelection([], ['trigger', 'problem', 'insight', 'permission']).length, 3);
    assert.deepEqual(normalizeApproachSelection([], ['peers']), []);
    assert.deepEqual(approachesFrom([RECOMMENDED_APPROACH]), []);
  });

  it('el resumen nombra los enfoques y el pedido manda la referencia sólo con su enfoque', () => {
    const selection = { contactIds: [], channels: ['email' as const], goals: ['book_meeting' as const], productKeys: [], approaches: ['trigger' as const, 'referral' as const], referralNote: ' María ' };
    assert.match(summaryText(selection, [], true), /Enfoques: por un evento reciente y por referencia \(una versión de cada uno\)/);
    assert.equal(buildFirstContactRequestBody({ accountId: ACCOUNT, selection, refreshResearch: false }).referralNote, 'María');
    assert.equal(
      buildFirstContactRequestBody({ accountId: ACCOUNT, selection: { ...selection, approaches: ['trigger'] }, refreshResearch: false }).referralNote,
      null,
    );
    assert.match(summaryText({ ...selection, approaches: [] }, [], true), /Enfoque: el que recomiende el agente/);
  });
});
