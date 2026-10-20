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
import type { FirstCallChannel, ResearchFact } from '../types';
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
