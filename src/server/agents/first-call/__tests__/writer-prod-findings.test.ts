/**
 * Lo que mostró la corrida de Davivienda en Prod (19-10, 5 decisores): el redactor
 * inventaba prueba social («otros bancos lo han resuelto»), ponía fechas exactas para la
 * reunión y a veces un canal salía sin preguntas ni objeciones. Sin red.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { unsupportedNumbers } from '../numbers';
import { contentForChannel, parseWriterSubmission, verifyPack, withoutClaimingVariants } from '../pack-verifier';
import type { ResearchFact } from '../types';
import { buildWriterSystemPrompt } from '../writer-prompt';
import { UBITS_OBJECTIONS, UBITS_OFFERS } from '../ubits-messaging-library';

const FACTS: ResearchFact[] = [
  { id: 'F1', topic: 'recent_signal', statement: 'Integró a Scotiabank y tiene 653 sucursales.', quote: null, sourceKind: 'news', sourceUrl: null, sourceLabel: 'Noticia', publishedOn: '2026-09-20' },
];
const NOW = Date.parse('2026-10-19T12:00:00Z');

function emailPack(text: string) {
  const submission = parseWriterSubmission(
    {
      approach: 'trigger',
      reason_to_call: { text: 'Integró a Scotiabank y tiene 653 sucursales.', fact_refs: ['F1'] },
      angle: 'Alinear a la gente nueva.',
      call_script: { text: '', fact_refs: [] },
      messages: [{ channel: 'email', text, fact_refs: ['F1'] }],
      questions: ['¿Cómo forman hoy a la gente nueva?', '¿Quién define la inducción?', '¿Cómo miden el avance?'],
      objections: [{ library_key: 'not_interested', objection: 'No me interesa.', response: 'Es justo. ¿Es porque ya lo tienen resuelto?' }],
      next_step: 'Pedir 20 minutos.',
      meeting_ask: '¿Le parece si lo vemos 20 minutos el martes a las 10 o el jueves a las 3?',
      if_no: 'Preguntar si le escribo el próximo trimestre.',
      confirmation: 'Quedamos el martes a las 10. Agenda: la integración.',
      cautions: [],
    },
    ['email'],
  );
  return contentForChannel(submission, 'email');
}

describe('cifras de agenda (Prod 19-10)', () => {
  it('una fecha para la reunión no es una cifra sin fuente; un dato redondeado sí', () => {
    assert.deepEqual(unsupportedNumbers('¿El jueves 17 a las 3 o el martes 20 de enero a las 10?', []), []);
    assert.deepEqual(unsupportedNumbers('Con más de 650 sucursales', ['tiene 653 sucursales']), ['650']);
  });
});

describe('prueba social inventada (Prod 19-10)', () => {
  const base = 'Asunto: La integración\nCordial saludo, Juliana:\nVi que Davivienda integró a Scotiabank y tiene 653 sucursales. ';
  for (const phrase of [
    'Otros bancos de la región han resuelto integraciones así.',
    'Otros bancos están capacitando en integraciones como la de ustedes.',
    'Trabajo con bancos que necesitan formar a miles de personas.',
    'Hemos estado ayudando a otros bancos con programas de formación.',
    'Muchas empresas como ustedes nos usan para la formación.',
  ]) {
    it(`se marca: «${phrase}»`, () => {
      const issues = verifyPack(emailPack(`${base}${phrase} ¿Le sirve que le comparta una idea?`), FACTS, 'email', { nowMs: NOW, countryCode: 'CO' });
      assert.ok(issues.some((i) => /experiencia, clientes o casos/.test(i)), issues.join(' | '));
    });
  }
  it('el patrón del proceso y la oferta tal cual sí se pueden decir', () => {
    const text = `${base}En integraciones así suele pasar que la gente nueva tarda en alinearse. ¿Le sirve que le comparta una demo con casos de su sector?`;
    const issues = verifyPack(emailPack(text), FACTS, 'email', { nowMs: NOW, countryCode: 'CO' });
    assert.equal(issues.some((i) => /experiencia, clientes o casos/.test(i)), false, issues.join(' | '));
  });
  it('el redactor recibe los ejemplos prohibidos y lo permitido', () => {
    const system = buildWriterSystemPrompt();
    assert.match(system, /otros bancos de la región lo han resuelto/);
    assert.match(system, /en integraciones así suele pasar que/);
    assert.match(system, /653, nunca «650»/);
    assert.match(system, /SIN número de día ni mes/);
  });
});

describe('la biblioteca no contradice al verificador (Prod 19-10)', () => {
  it('ninguna respuesta a objeciones ni oferta aprobada se marca como «afirma clientes»', () => {
    const base = 'Asunto: La integración\nCordial saludo, Juliana:\nVi que Davivienda integró a Scotiabank y tiene 653 sucursales. ¿Le sirve que le comparta una idea?';
    for (const objection of UBITS_OBJECTIONS) {
      const pack = { ...emailPack(base), objections: [{ objection: objection.objection, response: objection.response, libraryKey: objection.key }] };
      const issues = verifyPack(pack, FACTS, 'email', { nowMs: NOW, countryCode: 'CO' });
      assert.equal(issues.some((i) => /experiencia, clientes o casos/.test(i)), false, `${objection.key}: ${objection.response}`);
    }
    for (const offer of UBITS_OFFERS) {
      const pack = { ...emailPack(base), meetingAsk: `¿Le parece el martes a las 10? ${offer.text}` };
      const issues = verifyPack(pack, FACTS, 'email', { nowMs: NOW, countryCode: 'CO' });
      assert.equal(issues.some((i) => /experiencia, clientes o casos/.test(i)), false, `${offer.key}: ${offer.text}`);
    }
  });
});

describe('enfoques que no invitan a inventar clientes (Prod 19-10)', () => {
  it('el redactor no ve el enfoque apagado «Pares del sector» ni su regla', () => {
    const system = buildWriterSystemPrompt();
    assert.doesNotMatch(system, /Cuenta qué hicieron empresas parecidas/);
    assert.doesNotMatch(system, /- peers \|/);
    assert.match(system, /El motivo es un hecho de SU empresa, no tu experiencia/);
  });
});

describe('versiones que siguen inventando clientes tras corregir (auditoría 21-10)', () => {
  const base = 'Asunto: La integración\nCordial saludo, Juliana:\nVi que Davivienda integró a Scotiabank y tiene 653 sucursales. ';
  for (const phrase of [
    'Mi equipo trabaja con CEOs en tecnología que están pasando por lo mismo.',
    'Lo que hemos visto en bancos que atraviesan esto es que un plan por equipos ayuda.',
    'Lo que vemos en otras aseguradoras es que la formación llega tarde.',
  ]) {
    it(`se marca: «${phrase}»`, () => {
      const issues = verifyPack(emailPack(`${base}${phrase} ¿Le sirve que le comparta una idea?`), FACTS, 'email', { nowMs: NOW, countryCode: 'CO' });
      assert.ok(issues.some((i) => /experiencia, clientes o casos/.test(i)), issues.join(' | '));
    });
  }

  it('«hemos visto» sobre la propia empresa no es prueba social', () => {
    const issues = verifyPack(emailPack(`${base}Hemos visto en la noticia que crecieron mucho. ¿Le sirve que le comparta una idea?`), FACTS, 'email', { nowMs: NOW, countryCode: 'CO' });
    assert.equal(issues.some((i) => /experiencia, clientes o casos/.test(i)), false, issues.join(' | '));
  });

  it('se quita la versión alternativa que inventa clientes; la principal y las limpias se quedan', () => {
    const submission = parseWriterSubmission(
      {
        approach: 'trigger',
        reason_to_call: { text: 'Integró a Scotiabank.', fact_refs: ['F1'] },
        call_script: { text: 'Buenos días, le habla Elkin, de UBITS. Vi que integraron Scotiabank.', fact_refs: ['F1'] },
        call_script_variants: [
          { approach: 'problem', text: 'Buenos días. Lo que hemos visto en bancos que atraviesan esto es que la gente nueva tarda.' },
          { approach: 'permission', text: 'Buenos días, sé que la llamo sin aviso. ¿Me regala 30 segundos?' },
        ],
        messages: [
          {
            channel: 'email',
            text: 'Asunto: La integración\nVi que integraron Scotiabank. ¿Conversamos?',
            fact_refs: ['F1'],
            variants: [
              { approach: 'permission', text: 'Asunto: Una pregunta\nMi equipo trabaja con bancos en integraciones. ¿Conversamos?' },
              { approach: 'who_decides', text: 'Asunto: Una consulta\n¿Quién lleva la formación de la gente nueva?' },
            ],
          },
        ],
      },
      ['call', 'email'],
    );
    const { submission: cleaned, dropped } = withoutClaimingVariants(submission);
    assert.deepEqual(dropped.sort(), ['permission', 'problem']);
    assert.deepEqual(cleaned.callScriptVariants.map((v) => v.approach), ['permission']);
    assert.deepEqual(cleaned.messageVariants.email?.map((v) => v.approach), ['who_decides']);
    assert.equal(cleaned.shared.callScript.text, submission.shared.callScript.text);
    assert.equal(withoutClaimingVariants(cleaned).dropped.length, 0, 'sin nada que quitar devuelve lo mismo');
  });
});
