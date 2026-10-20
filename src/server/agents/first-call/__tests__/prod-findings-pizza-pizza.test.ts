/**
 * Lo que mostró la corrida de Pizza Pizza en Prod (19-10, investigación nueva): notas de
 * «pizza» en general en la prensa, medios de España en Chile, «Estimada Juvenal», una
 * etiqueta interna en el mensaje de voz, una cifra de la biblioteca tomada por hecho
 * inexistente y un primer WhatsApp que pedía reunión. Sin red.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resultMentionsCompany } from '../curated-match';
import { cleanToolText, contentForChannel, genderFromTitle, parseWriterSubmission, verifyPack } from '../pack-verifier';
import { REGIONAL_BUSINESS_PRESS, REGIONAL_HR_MEDIA, sourcesForAccount } from '../research-catalog';
import { newsToDocuments } from '../research-documents';
import type { FirstCallChannel, FirstCallPackContent, ResearchFact } from '../types';
import { UBITS_CLAIMS } from '../ubits-messaging-library';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const FACTS: ResearchFact[] = [
  { id: 'F1', topic: 'talent', statement: 'Busca pizzeros y repartidores.', quote: null, sourceKind: 'official_site', sourceUrl: null, sourceLabel: 'Sitio oficial', publishedOn: null },
];

function pack(channel: FirstCallChannel, text: string, extra: Record<string, unknown> = {}) {
  const submission = parseWriterSubmission(
    {
      approach: 'problem',
      reason_to_call: { text: 'Busca pizzeros y repartidores.', fact_refs: ['F1'] },
      angle: 'Que cada ingreso llegue listo.',
      call_script: { text: '', fact_refs: [] },
      messages: [{ channel, text, fact_refs: ['F1'] }],
      questions: ['¿Cómo forman hoy a la gente nueva?', '¿Quién define la inducción?', '¿Cómo miden el avance?'],
      objections: [{ library_key: 'not_interested', objection: 'No me interesa.', response: 'Es justo. ¿Es porque ya lo tienen resuelto?' }],
      next_step: 'Pedir 20 minutos.',
      meeting_ask: '¿Le parece si lo vemos 20 minutos el martes a las 10 o el jueves a las 3?',
      if_no: 'Preguntar si le escribo el próximo trimestre.',
      confirmation: 'Quedamos el martes a las 10. Agenda: la inducción.',
      cautions: [],
      ...extra,
    },
    [channel],
  );
  return contentForChannel(submission, channel);
}

describe('investigación: fuentes del país y resultados de la empresa (Pizza Pizza, Prod 19-10)', () => {
  it('los medios de un solo país (España, Centroamérica) no van en la lista regional', () => {
    for (const domain of ['expansion.com', 'forbescentroamerica.com']) assert.equal(REGIONAL_BUSINESS_PRESS.includes(domain), false, domain);
    for (const domain of ['rrhhdigital.com', 'orgdch.org']) assert.equal(REGIONAL_HR_MEDIA.includes(domain), false, domain);
    assert.equal(sourcesForAccount('CL', 'Retail').hrMedia.includes('rrhhdigital.com'), false, 'en Chile no');
    assert.ok(sourcesForAccount('ES', 'Retail').hrMedia.includes('rrhhdigital.com'), 'en España sí');
  });

  it('en la prensa sólo entra lo que nombra a la empresa (o su dominio)', () => {
    const results = [
      { url: 'https://www.latercera.com/dia-de-la-pizza', title: 'Este viernes se celebra el Día de la Pizza', content: 'Domino’s Pizza: pizza mediana 3 ingredientes a $5.990 y otras promociones para el día de la pizza.', publishedOn: '2026-07-10' },
      { url: 'https://www.df.cl/pizza-pizza-abre', title: 'Pizza Pizza abre 10 locales', content: 'La cadena chilena Pizza Pizza anunció la apertura de 10 locales en regiones durante este año.', publishedOn: '2026-09-01' },
    ];
    const docs = newsToDocuments(results, 'pizzapizza.cl', 'prensa', 'Pizza Pizza');
    assert.deepEqual(docs.map((d) => d.url), ['https://www.df.cl/pizza-pizza-abre']);
    // Las búsquedas abiertas de siempre no se filtran (lo decide el verificador de citas).
    assert.equal(newsToDocuments(results, 'pizzapizza.cl', 'noticias', 'Pizza Pizza').length, 2);
  });

  it('el dominio también cuenta («oreillyauto» en «O’Reilly Auto Parts»)', () => {
    assert.ok(resultMentionsCompany('O’Reilly Auto Parts abrió su centro de distribución en Monterrey.', 'O’Reilly Autopartes México', 'oreillyauto.mx'));
    assert.equal(resultMentionsCompany('Las pizzerías de Nueva York triunfan en Madrid.', 'Pizza Pizza', 'pizzapizza.cl'), false);
  });
});

describe('mensajes (Pizza Pizza, Prod 19-10)', () => {
  it('se quitan las etiquetas internas del comienzo; el asunto del correo no se toca', () => {
    assert.equal(cleanToolText('Mensaje de voz si no contesta (enfoque insight): Hola Andrés, le habla Elkin.'), 'Hola Andrés, le habla Elkin.');
    assert.equal(cleanToolText('Guion: Buenos días, Juvenal.'), 'Buenos días, Juvenal.');
    assert.equal(cleanToolText('Asunto: Turnos de noche\nBuenos días, Juvenal:'), 'Asunto: Turnos de noche\nBuenos días, Juvenal:');
  });

  it('una cifra de la biblioteca citada por su clave no es un «hecho inexistente»', () => {
    const claim = UBITS_CLAIMS[0];
    const issues = verifyPack(
      pack('linkedin', 'Juvenal, vi que Pizza Pizza busca pizzeros y repartidores. Sigo de cerca cómo forman a la gente nueva en retail.', {
        messages: [{ channel: 'linkedin', text: 'Juvenal, vi que Pizza Pizza busca pizzeros y repartidores. Sigo de cerca cómo forman a la gente nueva en retail.', fact_refs: ['F1', claim.key] }],
      }),
      FACTS,
      'linkedin',
      { nowMs: NOW },
    );
    assert.equal(issues.some((i) => /no existen en la ficha/.test(i)), false, issues.join(' | '));
  });

  it('el género sale del cargo, nunca del nombre', () => {
    assert.equal(genderFromTitle('Directora de Personas'), 'f');
    assert.equal(genderFromTitle('Jefe de Formación'), 'm');
    assert.equal(genderFromTitle('Gerente de RR. HH.'), null);
    assert.equal(genderFromTitle('Human Resources Director'), null);
    const email = (greeting: string) =>
      `Asunto: Turnos de noche\n${greeting}\nVi que Pizza Pizza busca pizzeros y repartidores. ¿Le sirve que le comparta una idea?`;
    const check = (greeting: string, title: string) =>
      verifyPack(pack('email', email(greeting)), FACTS, 'email', { nowMs: NOW, decisionMakerTitle: title }).filter((i) => /saludo|Saluda/.test(i));
    assert.equal(check('Estimada Juvenal:', 'Gerente de Operaciones').length, 1, '«Estimada» sin saber el género');
    assert.equal(check('Estimado Juvenal:', 'Directora de Personas').length, 1, 'no coincide con el cargo');
    assert.equal(check('Estimada Andrea:', 'Directora de Personas').length, 0);
    assert.equal(check('Buenos días, Juvenal:', 'Gerente de Operaciones').length, 0, 'neutro siempre vale');
  });

  it('el primer WhatsApp y la nota de LinkedIn no piden reunión; el correo puede pedir interés', () => {
    const wa = verifyPack(pack('whatsapp', 'Hola, Andrés. Vi que Pizza Pizza busca pizzeros. ¿Le acomoda que nos veamos 20 minutos?'), FACTS, 'whatsapp', { nowMs: NOW });
    assert.ok(wa.some((i) => /WhatsApp pide reunión/.test(i)), wa.join(' | '));
    const li = verifyPack(pack('linkedin', 'Andrés, vi que Pizza Pizza busca pizzeros. ¿Le interesa conversar 20 minutos?'), FACTS, 'linkedin', { nowMs: NOW });
    assert.ok(li.some((i) => /LinkedIn pide reunión/.test(i)), li.join(' | '));
    const okWa = verifyPack(pack('whatsapp', 'Hola, Andrés. Vi que Pizza Pizza busca pizzeros. ¿Le puedo escribir por aquí sobre eso?'), FACTS, 'whatsapp', { nowMs: NOW });
    assert.equal(okWa.some((i) => /pide reunión/.test(i)), false, okWa.join(' | '));
  });
});

describe('falsos positivos del primer WhatsApp (banco 19-10)', () => {
  it('si el principal sólo pide permiso, una versión alternativa no lo marca', () => {
    const p = pack('whatsapp', 'Hola, Andrea. Elkin de UBITS. ¿Le puedo escribir por aquí de vez en cuando sobre formación en Auteco?', {
      messages: [
        {
          channel: 'whatsapp',
          text: 'Hola, Andrea. Elkin de UBITS. ¿Le puedo escribir por aquí de vez en cuando sobre formación en Auteco?',
          fact_refs: ['F1'],
          variants: [{ approach: 'insight', text: 'Andrea, un dato del sector. ¿Le sirve que lo veamos 20 minutos?', fact_refs: [] }],
        },
      ],
    });
    const issues = verifyPack(p, FACTS, 'whatsapp', { nowMs: NOW });
    assert.equal(issues.some((i) => /pide reunión/.test(i)), false, issues.join(' | '));
  });
});

describe('investigación que llega como texto JSON (Itaú en el banco, 19-10)', () => {
  it('los datos en texto JSON se leen igual', async () => {
    const { extractResearchSubmission } = await import('../research-verifier');
    const submission = extractResearchSubmission([
      {
        type: 'tool_use',
        id: 'r1',
        name: 'submit_account_research',
        input: { summary: 'x', facts: '[{"ref":"W1","topic":"business","statement":"s","quote":"q","doc_id":"D1","source_url":null,"published_on":null}]', hypotheses: '[]', gaps: '[]' },
      } as never,
    ]);
    assert.equal(Array.isArray(submission?.facts), true);
    assert.equal((submission!.facts as unknown[]).length, 1);
  });
});

describe('los 20 países tienen normas de formación verificadas (19-10)', () => {
  it('cada país del catálogo tiene al menos una norma; El Salvador nombra el INCAF, no el INSAFORP', async () => {
    const { trainingContextFor, stripTrainingNormIds } = await import('../country-training-context');
    const { COUNTRY_SOURCE_CATALOG } = await import('../research-catalog-data');
    for (const country of Object.keys(COUNTRY_SOURCE_CATALOG)) {
      assert.ok(trainingContextFor(country).length > 0, country);
    }
    const sv = JSON.stringify(trainingContextFor('SV'));
    assert.match(sv, /INCAF/);
    // El INSAFORP sólo aparece como el que fue reemplazado, nunca como vigente.
    assert.equal(sv.replace('reemplazó al INSAFORP', '').includes('INSAFORP'), false);
    assert.equal(stripTrainingNormIds('Con la Ley 2101 de 2021 y la Resolución 0312 de 2019', 'CO').match(/\d/g), null);
  });
});

describe('«sin costo» como inciso se quita (banco 20-10)', () => {
  it('entre comas o al comienzo de la frase', () => {
    assert.equal(
      cleanToolText('Le llevo un diagnóstico rápido de las brechas de su equipo, sin costo, para que vea dónde están.'),
      'Le llevo un diagnóstico rápido de las brechas de su equipo, para que vea dónde están.',
    );
    assert.equal(cleanToolText('¿Le sirve? Sin costo, lo llevamos la próxima semana.'), '¿Le sirve? Lo llevamos la próxima semana.');
    assert.equal(cleanToolText('Le muestro el diagnóstico, sin costo.'), 'Le muestro el diagnóstico.');
    // Dicho como afirmación, no se toca: lo marca el verificador.
    assert.equal(cleanToolText('El diagnóstico es gratis para ustedes.'), 'El diagnóstico es gratis para ustedes.');
  });
});

describe('Prod 20-10 (Sally Beauty, EE. UU.)', () => {
  const base = (over: Partial<FirstCallPackContent>): FirstCallPackContent => ({
    reasonToCall: { text: 'Implementaron una plataforma con Circana.', factRefs: ['F8'] },
    angle: 'La formación rápida marca la diferencia.',
    callScript: { text: '', factRefs: [] },
    shortMessage: { text: 'Madison, vi la plataforma nueva con Circana. ¿Cómo coordinan la capacitación?', factRefs: ['F8'] },
    questions: ['¿Cómo forman hoy?', '¿Quién decide?', '¿Cómo miden?'],
    objections: [{ objection: 'Mándame información.', response: 'Con gusto, ¿cuál es el reto?', libraryKey: null }],
    nextStep: 'Pedir 20 minutos.',
    cautions: [],
    ...over,
  });
  const FACTS: ResearchFact[] = [
    { id: 'F8', topic: 'recent_signal', statement: 'Acuerdo con Circana.', quote: 'Circana', sourceKind: 'news', sourceUrl: 'https://x.example', publishedOn: '2026-03-11' } as ResearchFact,
  ];

  it('la referencia a un dato («F12») no es una cifra sin fuente', () => {
    const issues = verifyPack(base({ angle: 'Su propia convicción (F8, F12) es lo que importa.' }), FACTS, 'whatsapp', { countryCode: 'US' });
    assert.equal(issues.some((i) => i.startsWith('Usa cifras')), false, issues.join(' | '));
  });

  it('«La mayoría de CEOs de retail dice que…» sin fuente se marca', () => {
    const msg = 'Madison, la mayoría de CEOs de retail con múltiples sedes dice que el reto es ejecutar igual. ¿Cómo lo resuelven?';
    const issues = verifyPack(base({ shortMessage: { text: msg, factRefs: ['F8'] } }), FACTS, 'whatsapp', { countryCode: 'US' });
    assert.ok(issues.includes('Atribuye una opinión a «la mayoría» sin fuente: usa un dato de la biblioteca o quítalo.'));
    const fine = verifyPack(base({}), FACTS, 'whatsapp', { countryCode: 'US' });
    assert.equal(fine.some((i) => i.includes('la mayoría')), false);
  });
});

