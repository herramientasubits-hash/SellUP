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
import { hubspotActivityDay } from '../internal-facts';
import { unsupportedNumbers } from '../numbers';
import { mapPackRow } from '../row-mappers';
import { allApplicableApproaches } from '../approaches';
import { channelTabs, currentPacks, visibleClosedPacks } from '../../../../modules/speech/first-contact-tab-view';
import { hasRecentSignal } from '../run-first-call';
import type { ResearchFact } from '../types';
import { BANNED_PHRASES, UBITS_CLAIMS, UBITS_OFFERS, addressFormFor, renderLibraryForPrompt } from '../ubits-messaging-library';
import { buildWriterSubmitTool, buildWriterSystemPrompt, buildWriterUserMessage } from '../writer-prompt';
import { parseFirstCallRequest } from '../../../../modules/speech/first-call-request';
import {
  approachOptions,
  approachesFrom,
  buildFirstContactRequestBody,
  firstContactDoneToast,
  firstContactRunDetail,
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
    call_script_variants: [
      {
        approach: 'insight',
        text: 'Laura, el 49 % de los líderes de talento dice que a su alta dirección le preocupa que la gente no tenga las habilidades para ejecutar la estrategia. ¿Cómo lo están viviendo con la integración?',
        voicemail: 'Laura, le dejé un correo con un dato sobre líderes de talento. Le escribo por ahí.',
        fact_refs: [],
      },
    ],
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
    assert.equal(props.call_script_variants?.maxItems, 1);
    assert.equal(props.messages.items?.properties.variants?.maxItems, 1);
    // Sin enfoques extra, el formulario no pide listas de versiones (más simple para modelos chicos).
    const single = buildWriterSubmitTool(['email'], []);
    const singleProps = single.input_schema.properties as unknown as Record<string, { items?: { properties: Record<string, unknown> } }>;
    assert.equal(singleProps.call_script_variants, undefined);
    assert.equal(singleProps.messages.items?.properties.variants, undefined);
    assert.ok(!single.input_schema.required.includes('call_script_variants'));
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
    // En la llamada cada tipo trae todo: el guion completo y el mensaje si no contesta.
    assert.match(call.variants?.[0].voicemail ?? '', /le dejé un correo/);
    // La forma anterior (sólo la apertura) también se lee.
    const legacy = parseWriterSubmission({ ...raw(), call_script_variants: undefined, call_opener_variants: [{ approach: 'insight', text: 'Laura, un dato.', fact_refs: [] }] }, ['call']);
    assert.equal(contentForChannel(legacy, 'call').variants?.[0].voicemail, undefined);
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

  it('dice dónde tutea: Grupo Ciisa (18-10) lo hacía sólo en la confirmación', () => {
    const issues = emailIssues('Asunto: Líderes\nLaura, vi la integración. ¿Le sirve?', {
      confirmation: 'Laura, confirmamos: [día y hora]. Te llevaré un diagnóstico para tu equipo.',
    });
    assert.ok(issues.some((i) => i.includes('Tutea al decisor en la confirmación')), issues.join(' | '));
  });

  it('los plazos y horarios de agenda no son cifras sin fuente; una cifra de la empresa sí', () => {
    const agenda = emailIssues('Asunto: Líderes\nLaura, vi la integración. ¿Le sirve?', {
      meeting_ask: '¿Le queda el miércoles a las 10 de la mañana o el jueves a las 2 p. m.? Algo en los próximos 7 a 14 días, de 20 a 30 minutos.',
    });
    assert.ok(!agenda.some((i) => i.includes('cifras sin fuente')), agenda.join(' | '));
    assert.deepEqual(unsupportedNumbers('Abrieron 14 sedes nuevas.', []), ['14']);
    assert.deepEqual(unsupportedNumbers('En los próximos 14 días o en 12 horas.', []), []);
  });

  it('Auteco (19-10): un dato de hace más de un año no se dice como actual (salvo con su año)', () => {
    const facts = [...FACTS, fact('F9', 'El grupo tiene más de 5.000 colaboradores indirectos.', '2024-10-17', 'size_presence')];
    const build = (reason: string) =>
      verifyPack(
        contentForChannel(
          parseWriterSubmission(
            raw({
              approach: 'problem',
              reason_to_call: { text: reason, fact_refs: ['F9'] },
              messages: [{ channel: 'email', text: 'Asunto: Equipos\nLaura, ¿cómo lo están viviendo? ¿Le sirve?', fact_refs: ['F9'], variants: [] }],
            }),
            ['email'],
          ),
          'email',
        ),
        facts,
        'email',
        { nowMs: NOW },
      );
    assert.ok(build('Está en expansión con más de 5.000 colaboradores indirectos.').some((i) => i.includes('más de un año (2024-10-17)')));
    assert.ok(!build('En 2024 contaban más de 5.000 colaboradores indirectos.').some((i) => i.includes('más de un año')));
  });

  it('Auteco (19-10): «muchas empresas de manufactura usan…» es prueba social inventada; el redactor no afirma faltantes', () => {
    const issues = emailIssues('Asunto: Diagnóstico\nLaura, le ofrezco algo que muchas empresas de manufactura usan antes de cualquier otra cosa. ¿Le sirve?');
    assert.ok(issues.some((i) => i.includes('UBITS que la biblioteca no respalda')), issues.join(' | '));
    assert.match(buildWriterSystemPrompt(), /«Lo que no se encontró» o en las hipótesis NO es un hecho/);
  });

  it('Auteco (19-10): citar la fuente por nombre («… Report 2025») no es una cifra sin fuente', () => {
    const issues = emailIssues(
      'Asunto: Un dato\nLaura, según el LinkedIn Workplace Learning Report 2025, el 88 % de las organizaciones está preocupado por retener talento. ¿Le sirve que le cuente más?',
    );
    assert.ok(!issues.some((i) => i.includes('cifras sin fuente')), issues.join(' | '));
    // Un año que no está en ninguna fuente sigue marcándose.
    const invented = emailIssues('Asunto: Un dato\nLaura, en 2019 abrieron 7 sedes nuevas. ¿Le sirve?');
    assert.ok(invented.some((i) => i.includes('2019')), invented.join(' | '));
  });

  it('Asdeporte (19-10): «trabajo con empresas…» y «otros líderes me comentan» también son clientes inventados', () => {
    for (const claim of ['Trabajo con empresas que tienen equipos en varias ciudades.', 'Otros equipos de RR. HH. me comentan lo mismo.']) {
      const issues = emailIssues(`Asunto: Equipos\nLaura, ${claim} ¿Le sirve?`);
      assert.ok(issues.some((i) => i.includes('UBITS que la biblioteca no respalda')), `${claim} → ${issues.join(' | ')}`);
    }
  });

  it('Asdeporte (18-10): no promete «sin costo» ni da por hecha una llamada', () => {
    const free = emailIssues('Asunto: Diagnóstico\nLaura, le ofrezco un diagnóstico rápido, sin costo ni compromiso. ¿Le sirve?');
    assert.ok(free.some((i) => i.includes('gratis o sin costo')), free.join(' | '));
    const prior = emailIssues('Asunto: Líderes\nLaura, llamé porque vi la integración. ¿Le sirve que le cuente?');
    assert.ok(prior.some((i) => i.includes('ya hubo contacto')), prior.join(' | '));
  });

  it('con el enfoque «evento reciente», la noticia citada debe tener menos de 90 días', () => {
    const issues = emailIssues('Asunto: Líderes\nLaura, vi la nueva sede. ¿Le sirve?', {
      reason_to_call: { text: 'Abrió una sede en Cali.', fact_refs: ['F2'] },
    });
    assert.ok(issues.some((i) => i.includes('más de 90 días')), issues.join(' | '));
  });

  it('Asdeporte (18-10): el mensaje si no contesta no puede ser el guion copiado', () => {
    const submission = parseWriterSubmission(
      raw({ messages: [{ channel: 'call', text: SCRIPT, fact_refs: ['F1'], variants: [] }] }),
      ['call'],
    );
    const issues = verifyPack(contentForChannel(submission, 'call'), FACTS, 'call', { nowMs: NOW });
    assert.ok(issues.some((i) => i.includes('repite el guion')), issues.join(' | '));
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
    assert.ok(issues.some((i) => i.includes('«Por el problema»') && i.includes('clientes de UBITS')), issues.join(' | '));
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
        outcome: { result: 'meeting_booked', at: '2026-10-18T10:00:00Z', approach: 'insight' },
      },
    });
    assert.equal(pack.content?.approach, 'trigger');
    assert.deepEqual(pack.content?.variants?.map((v) => v.approach), ['insight']);
    assert.equal(pack.content?.meetingAsk, 'martes o jueves');
    assert.deepEqual(pack.outcome, { result: 'meeting_booked', at: '2026-10-18T10:00:00Z', approach: 'insight' });
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
    assert.match(summaryText({ ...selection, approaches: [] }, [], true), /Enfoques: todos los que apliquen, una versión de cada uno/);
  });
});

describe('HubSpot en la ficha', () => {
  const NOW_MS = Date.UTC(2026, 9, 18);
  it('omite fechas imposibles y lee un número en segundos', () => {
    assert.equal(hubspotActivityDay('1970-01-21T00:00:00Z', NOW_MS), null);
    assert.equal(hubspotActivityDay('2026-09-30T14:00:00Z', NOW_MS), '2026-09-30');
    assert.equal(hubspotActivityDay('1759240800', NOW_MS), '2025-09-30');
    assert.equal(hubspotActivityDay('1759240800000', NOW_MS), '2025-09-30');
    assert.equal(hubspotActivityDay('2030-01-01', NOW_MS), null);
    assert.equal(hubspotActivityDay('no es fecha', NOW_MS), null);
    assert.equal(hubspotActivityDay(null, NOW_MS), null);
  });
});

describe('aviso al terminar', () => {
  const contacts = [{ id: 'c1', name: 'Emily Cerdas', title: 'Head of Human Resources' }];
  const selection = { contactIds: ['c1'], channels: ['call', 'email'] as const, goals: ['book_meeting'] as const, productKeys: [], approaches: [], referralNote: null };

  it('confirma cuántas, para quién y por dónde, y cuántas revisar', () => {
    const notice = firstContactDoneToast(['draft', 'needs_review'], firstContactRunDetail({ ...selection, channels: [...selection.channels], goals: [...selection.goals] }, contacts));
    assert.equal(notice.tone, 'success');
    assert.equal(notice.title, '¡Primer contacto listo!');
    assert.equal(notice.description, '2 preparaciones para Emily Cerdas por Llamada y Correo. Una tiene avisos para revisar antes de usarla.');
  });

  it('avisa las que no se pudieron escribir', () => {
    const notice = firstContactDoneToast(['draft', 'failed'], firstContactRunDetail({ ...selection, channels: [...selection.channels], goals: [...selection.goals] }, contacts));
    assert.equal(notice.tone, 'warning');
    assert.match(notice.description, /^Una preparación para Emily Cerdas .* Lista para usar\. Una no se pudo escribir/);
  });
});

describe('«Todos»: una versión con cada enfoque que aplique', () => {
  it('el recomendado primero; sin noticia no hay «evento reciente», sin nombre no hay referencia, nunca «Pares»', () => {
    assert.deepEqual(allApplicableApproaches('problem', { hasRecentSignal: false, hasReferral: false, countryCode: 'CR' }), [
      'problem',
      'insight',
      'value_first',
      'permission',
      'who_decides',
    ]);
    const withNews = allApplicableApproaches('trigger', { hasRecentSignal: true, hasReferral: true, countryCode: 'CO' });
    assert.equal(withNews[0], 'trigger');
    assert.ok(withNews.includes('referral'));
    assert.ok(!withNews.includes('peers'));
    assert.deepEqual(allApplicableApproaches('permission', { hasRecentSignal: true, hasReferral: false, countryCode: 'PE' }), ['permission']);
  });
});

describe('pestaña «Primer contacto»', () => {
  const pack = (id: string, channel: string, status: string, createdAt: string, contactId = 'c1') =>
    ({ id, channel, status, createdAt, contactId }) as unknown as Parameters<typeof channelTabs>[0][number];

  it('una pestaña por canal, en el orden de siempre, con SOLO la preparación más nueva (dueña 19-10)', () => {
    const tabs = channelTabs([
      pack('a', 'linkedin', 'draft', '2026-10-18T01:00:00Z'),
      pack('b', 'call', 'draft', '2026-10-17T01:00:00Z'),
      pack('c', 'call', 'needs_review', '2026-10-18T01:00:00Z'),
    ]);
    assert.deepEqual(tabs.map((t) => t.channel), ['call', 'linkedin']);
    assert.deepEqual(tabs[0].packs.map((p) => p.id), ['c']);
  });

  it('vigentes: una por decisor y canal, la más reciente usable (las de otras corridas no cuentan)', () => {
    const current = currentPacks([
      pack('call-old', 'call', 'draft', '2026-10-18T01:00:00Z'),
      pack('call-new', 'call', 'needs_review', '2026-10-19T11:44:00Z'),
      pack('call-failed', 'call', 'failed', '2026-10-19T12:00:00Z'),
      pack('email-c2', 'email', 'draft', '2026-10-18T01:00:00Z', 'c2'),
      pack('email-c1', 'email', 'used', '2026-10-17T01:00:00Z'),
    ]);
    assert.deepEqual(current.map((p) => p.id).sort(), ['call-new', 'email-c1', 'email-c2']);
  });

  it('esconde la fallida que ya tiene una preparación más nueva del mismo decisor y canal', () => {
    const closed = visibleClosedPacks([
      pack('old', 'email', 'failed', '2026-10-17T20:19:00Z'),
      pack('new', 'email', 'needs_review', '2026-10-18T01:54:00Z'),
      pack('other', 'email', 'failed', '2026-10-17T20:19:00Z', 'c2'),
      pack('gone', 'call', 'discarded', '2026-10-17T20:19:00Z'),
    ]);
    assert.deepEqual(closed.map((p) => p.id).sort(), ['gone', 'other']);
  });
});
