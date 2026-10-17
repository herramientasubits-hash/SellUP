/**
 * AGENT3-FIRST-CONTACT-2 — la cascada con varias selecciones y las reglas nuevas del
 * verificador (salidas de la corrida real de Davivienda del 17-10).
 *
 * Sin red ni base de datos: todo con datos de ejemplo.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { nextAgent3Status } from '../account-status';
import { companySizeStatement } from '../internal-facts';
import { extractNumbers } from '../numbers';
import { newsToDocuments } from '../research-documents';
import { contentForChannel, parseWriterSubmission, verifyPack } from '../pack-verifier';
import { buildWriterSubmitTool, buildWriterUserMessage } from '../writer-prompt';
import { goalsLabel, type ResearchFact } from '../types';
import { mapPackRow } from '../row-mappers';
import { UBITS_PRODUCTS, ubitsProductName, ubitsProductNames } from '../ubits-messaging-library';
import { parseFirstCallRequest } from '../../../../modules/speech/first-call-request';

const ACCOUNT = '7d2b8c5e-1f3a-4b6c-9d8e-0a1b2c3d4e5f';
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';

function fact(id: string, statement: string, quote: string | null = null): ResearchFact {
  return { id, topic: 'size_presence', statement, quote, sourceKind: 'news', sourceUrl: null, sourceLabel: 'Noticia', publishedOn: null };
}

const FACTS: ResearchFact[] = [
  fact('F5', 'Opera 509 oficinas en Colombia.', 'Number of locations: 509 (2025)'),
  fact('F6', 'Tras integrar Scotiabank cuenta con 653 sucursales en la región.', 'a network that includes 653 branches'),
  fact('F8', 'Academia Vibra impactó a más de 15000 personas.', 'La iniciativa impactó a más de 15.000 personas'),
];

const SCRIPT_WORDS = 'Cuando una empresa crece así suele costar que cada líder nuevo llegue listo y alineado con la cultura. '.repeat(5);

function raw(overrides: Record<string, unknown> = {}) {
  return {
    reason_to_call: { text: 'Integró Scotiabank y opera 653 sucursales en la región.', fact_refs: ['F6'] },
    angle: 'Que los líderes nuevos lleguen alineados.',
    product_key: 'aprendizaje_planes',
    call_script: { text: `Buenos días Fabián, Elkin de UBITS. Vi que ahora operan 653 sucursales. ${SCRIPT_WORDS}¿Lo vemos 20 minutos?`, fact_refs: ['F6'] },
    messages: [
      { channel: 'call', text: 'Fabián, le dejo este mensaje por la integración con Scotiabank; ¿lo vemos 20 minutos?', fact_refs: ['F6'] },
      { channel: 'whatsapp', text: 'Fabián, vi la integración con Scotiabank. ¿Cómo están alineando a los líderes nuevos?', fact_refs: ['F6'] },
      { channel: 'email', text: 'Asunto: Líderes nuevos tras la integración\nFabián, vi que integraron Scotiabank. ¿Lo conversamos?', fact_refs: ['F6'] },
    ],
    questions: ['¿Cómo forman hoy a los líderes nuevos?', '¿Quién define la inducción?', '¿Cómo miden el avance?'],
    objections: [{ library_key: 'send_info', objection: 'Mándame información.', response: 'Con gusto, ¿cuál es hoy el reto principal?' }],
    next_step: 'Agendar 20 minutos.',
    cautions: ['Que la formación sea un problema es una hipótesis.'],
    ...overrides,
  };
}

describe('solicitud con varias selecciones', () => {
  it('acepta varios decisores, canales y productos, sin repetir', () => {
    const parsed = parseFirstCallRequest({
      accountId: ACCOUNT,
      contactIds: [C1, C2, C1],
      channels: ['call', 'email', 'call'],
      productKeys: ['desempeno_360', 'aprendizaje_planes'],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.request.contactIds, [C1, C2]);
    assert.deepEqual(parsed.request.channels, ['call', 'email']);
    assert.deepEqual(parsed.request.productKeys, ['desempeno_360', 'aprendizaje_planes']);
  });

  it('acepta varios objetivos y los ordena como la conversación', () => {
    const parsed = parseFirstCallRequest({ accountId: ACCOUNT, channels: ['call'], goals: ['validate_owner', 'book_meeting', 'validate_owner'] });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.deepEqual(parsed.request.goals, ['book_meeting', 'validate_owner']);
    const legacy = parseFirstCallRequest({ accountId: ACCOUNT, channel: 'call', goal: 'open_conversation' });
    assert.equal(legacy.ok && legacy.request.goals.join(), 'open_conversation');
  });

  it('sigue aceptando la forma de la v1 (un decisor, un canal, un producto)', () => {
    const parsed = parseFirstCallRequest({ accountId: ACCOUNT, contactId: C1, channel: 'linkedin', productFocus: 'desempeno_pdi' });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.request.contactIds, [C1]);
    assert.deepEqual(parsed.request.channels, ['linkedin']);
    assert.deepEqual(parsed.request.productKeys, ['desempeno_pdi']);
  });

  it('rechaza sin canal, con más de 5 decisores o con productos de la v1', () => {
    assert.equal(parseFirstCallRequest({ accountId: ACCOUNT, channels: [] }).ok, false);
    assert.equal(parseFirstCallRequest({ accountId: ACCOUNT }).ok, false);
    const many = Array.from({ length: 6 }, (_, i) => `${i}${C1.slice(1)}`);
    assert.equal(parseFirstCallRequest({ accountId: ACCOUNT, channels: ['call'], contactIds: many }).ok, false);
    assert.equal(parseFirstCallRequest({ accountId: ACCOUNT, channels: ['call'], productKeys: ['learning'] }).ok, false);
  });
});

describe('objetivos guardados', () => {
  it('varios objetivos se guardan y se leen en orden; uno viejo o raro cae en «reunión»', () => {
    const many = mapPackRow({ id: 'p', account_id: 'a', status: 'draft', channel: 'call', goal: 'book_meeting,validate_owner', pack: {}, created_at: '2026-10-17T00:00:00Z' });
    assert.deepEqual(many.goals, ['book_meeting', 'validate_owner']);
    assert.equal(many.goal, 'book_meeting');
    assert.equal(goalsLabel(many.goals), 'Conseguir una reunión · Saber quién decide');
    const odd = mapPackRow({ id: 'p', account_id: 'a', status: 'draft', channel: 'call', goal: 'x', pack: {}, created_at: '2026-10-17T00:00:00Z' });
    assert.deepEqual(odd.goals, ['book_meeting']);
  });
});

describe('productos de UBITS (menú de la plataforma)', () => {
  it('cada producto tiene familia, nombre y frase, y las claves no se repiten', () => {
    const keys = UBITS_PRODUCTS.map((p) => p.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const p of UBITS_PRODUCTS) assert.ok(p.family && p.name && p.pitch && p.fitsWhen.length > 0, p.key);
    assert.ok(UBITS_PRODUCTS.some((p) => p.name === 'Evaluaciones 360'));
    assert.ok(!UBITS_PRODUCTS.some((p) => p.name === 'Créditos'));
  });

  it('las preparaciones viejas siguen mostrando su producto', () => {
    assert.equal(ubitsProductName('performance'), 'Desempeño');
    assert.deepEqual(ubitsProductNames('desempeno_360,aprendizaje_planes,raro'), ['Evaluaciones 360', 'Planes de Formación']);
    assert.equal(ubitsProductName(null), null);
  });
});

describe('redactor con varios canales', () => {
  it('pide un mensaje por canal y el guion sólo si hay llamada', () => {
    const tool = buildWriterSubmitTool(['whatsapp', 'email']);
    const messages = tool.input_schema.properties.messages;
    assert.equal(messages.minItems, 2);
    assert.deepEqual(messages.items.properties.channel.enum, ['whatsapp', 'email']);
    assert.match(tool.input_schema.properties.call_script.description, /No se pidió llamada/);
  });

  it('el mensaje al redactor nombra los canales y los productos pedidos', () => {
    const text = buildWriterUserMessage({
      companyName: 'Davivienda',
      countryName: 'Colombia',
      addressForm: 'usted',
      sellerName: 'Elkin',
      decisionMaker: { name: 'Fabián Martínez', title: 'Learning Leader', roleFocus: 'x' },
      channels: ['call', 'linkedin'],
      goals: ['book_meeting', 'validate_owner'],
      productKeys: ['desempeno_360', 'aprendizaje_planes'],
      briefStatus: 'sufficient',
      summary: null,
      facts: FACTS,
      hypotheses: [],
      gaps: [],
      hubspotWarning: null,
      regenerationReason: null,
    });
    assert.match(text, /Canales: Llamada, LinkedIn/);
    assert.match(text, /Objetivos \(en este orden\): Conseguir una reunión → Saber quién decide/);
    assert.match(text, /Evaluaciones 360 \(desempeno_360\), Planes de Formación \(aprendizaje_planes\)/);
  });

  it('separa la entrega por canal: el guion queda sólo en la llamada', () => {
    const submission = parseWriterSubmission(raw(), ['call', 'whatsapp', 'email']);
    const call = contentForChannel(submission, 'call');
    const whatsapp = contentForChannel(submission, 'whatsapp');
    assert.ok(call.callScript.text.length > 0);
    assert.equal(whatsapp.callScript.text, '');
    assert.match(whatsapp.shortMessage.text, /líderes nuevos/);
    assert.equal(whatsapp.productKey, 'aprendizaje_planes');
    assert.deepEqual(verifyPack(call, FACTS, 'call', { decisionMakerName: 'Fabián Martínez' }), []);
    assert.deepEqual(verifyPack(whatsapp, FACTS, 'whatsapp'), []);
  });

  it('un canal sin mensaje queda marcado como faltante', () => {
    const submission = parseWriterSubmission(raw({ messages: [] }), ['whatsapp', 'email']);
    const issues = verifyPack(contentForChannel(submission, 'email'), FACTS, 'email');
    assert.ok(issues.includes('Falta el mensaje del canal.'));
  });
});

describe('verificador · lo que salió mal en Davivienda', () => {
  it('no deja comparar cifras de hechos distintos («pasó de 509 a 653»)', () => {
    const submission = parseWriterSubmission(
      raw({ reason_to_call: { text: 'Pasó de 509 a 653 sucursales en la región.', fact_refs: ['F6'] } }),
      ['call'],
    );
    const issues = verifyPack(contentForChannel(submission, 'call'), FACTS, 'call');
    assert.ok(issues.some((i) => i.includes('509')), issues.join(' | '));
  });

  it('no deja afirmar clientes o experiencia de UBITS', () => {
    for (const claim of ['nosotros trabajamos con bancos que pasaron por lo mismo', 'bancos como ustedes lo resuelven así', 'Nuestros clientes lo logran']) {
      const submission = parseWriterSubmission(
        raw({ messages: [{ channel: 'whatsapp', text: `Fabián, ${claim}. ¿Lo vemos?`, fact_refs: [] }] }),
        ['whatsapp'],
      );
      const issues = verifyPack(contentForChannel(submission, 'whatsapp'), FACTS, 'whatsapp');
      assert.ok(issues.some((i) => i.includes('clientes o casos de UBITS')), claim);
    }
  });

  it('no deja «[nombre]» si se conoce el decisor', () => {
    const submission = parseWriterSubmission(
      raw({ messages: [{ channel: 'whatsapp', text: 'Buenos días [nombre], vi la integración. ¿Lo vemos?', fact_refs: ['F6'] }] }),
      ['whatsapp'],
    );
    const content = contentForChannel(submission, 'whatsapp');
    assert.ok(verifyPack(content, FACTS, 'whatsapp', { decisionMakerName: 'Fabián Martínez' }).some((i) => i.includes('[nombre]')));
    assert.deepEqual(verifyPack(content, FACTS, 'whatsapp', { decisionMakerName: null }), []);
  });
});

describe('verificador · sin falsas alarmas (revisión de código)', () => {
  it('la objeción del prospecto puede decir «ya trabajamos con…» y una hipótesis puede decir «en empresas como la suya»', () => {
    const submission = parseWriterSubmission(
      raw({
        angle: 'En empresas como la suya suele pasar que los líderes nuevos tardan en alinearse.',
        objections: [
          { library_key: 'have_provider', objection: 'Ya trabajamos con empresas de capacitación.', response: 'Tiene sentido. ¿Qué le gustaría mejorar de lo que tienen?' },
        ],
      }),
      ['call'],
    );
    const issues = verifyPack(contentForChannel(submission, 'call'), FACTS, 'call');
    assert.ok(!issues.some((i) => i.includes('clientes o casos de UBITS')), issues.join(' | '));
  });

  it('el guion y el mensaje pueden repetir la cifra de la razón sin volver a citarla', () => {
    const submission = parseWriterSubmission(
      raw({
        messages: [{ channel: 'whatsapp', text: 'Fabián, vi que ya son 653 sucursales tras la integración. ¿Lo vemos?', fact_refs: [] }],
      }),
      ['whatsapp'],
    );
    assert.deepEqual(verifyPack(contentForChannel(submission, 'whatsapp'), FACTS, 'whatsapp'), []);
  });
});

describe('estado de la empresa con el agente', () => {
  it('avanza al investigar y al quedar lista, nunca retrocede ni toca archivadas', () => {
    assert.equal(nextAgent3Status('new', 'research_in_progress'), 'research_in_progress');
    assert.equal(nextAgent3Status('ready_for_research', 'ready_for_outreach'), 'ready_for_outreach');
    assert.equal(nextAgent3Status('ready_for_outreach', 'research_in_progress'), null);
    assert.equal(nextAgent3Status('research_in_progress', 'research_in_progress'), null);
    assert.equal(nextAgent3Status('archived', 'ready_for_outreach'), null);
  });
});

describe('investigación · lo que salió mal en Davivienda', () => {
  it('el informe anual en un subdominio de la empresa es sitio oficial, no una noticia', () => {
    const docs = newsToDocuments(
      [
        { url: 'https://ir.davivienda.com/wp-content/uploads/2026/03/Informe-Anual-2025.pdf', title: 'Informe anual', content: 'Academia Vibra impactó a más de 15.000 personas en Colombia durante el año.'.repeat(2), publishedOn: null },
        { url: 'https://www.financecolombia.com/scotiabank', title: 'Scotiabank', content: 'Scotiabank completes transfer of Colombia operations to Davivienda Group this year.'.repeat(2), publishedOn: '2025-11-27' },
      ],
      'davivienda.com',
    );
    assert.equal(docs[0].kind, 'official_site');
    assert.equal(docs[0].label, 'Sitio oficial · Informe');
    assert.equal(docs[1].kind, 'news');
  });

  it('el tamaño registrado se lee como empleados y sus cifras siguen verificables', () => {
    assert.equal(companySizeStatement('25000'), 'Unos 25.000 empleados (tamaño registrado en SellUp).');
    assert.equal(companySizeStatement('1001-5000'), 'Entre 1.001 y 5.000 empleados (tamaño registrado en SellUp).');
    assert.equal(companySizeStatement('10001+'), 'Más de 10.001 empleados (tamaño registrado en SellUp).');
    assert.equal(companySizeStatement('Grande'), 'Tamaño registrado: Grande.');
    assert.deepEqual(extractNumbers(companySizeStatement('25000')).map((t) => t.digits), extractNumbers('25000').map((t) => t.digits));
  });
});
