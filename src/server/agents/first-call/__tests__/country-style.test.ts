/**
 * Que el primer contacto suene natural en cada país (dueña 19-10): el estilo que recibe
 * el redactor y lo que el verificador marca. Sin red.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { countryStyleFor, foreignWordsIn, renderCountryStyle } from '../country-style';
import { contentForChannel, parseWriterSubmission, verifyPack } from '../pack-verifier';
import type { ResearchFact } from '../types';
import { buildWriterSystemPrompt, buildWriterUserMessage } from '../writer-prompt';
import { BANNED_PHRASES } from '../ubits-messaging-library';

const FACTS: ResearchFact[] = [
  { id: 'F1', topic: 'recent_signal', statement: 'Abrió dos centros de distribución.', quote: null, sourceKind: 'news', sourceUrl: null, sourceLabel: 'Noticia', publishedOn: '2026-09-20' },
];

const SCRIPT =
  'Buenos días, ¿hablo con Andrea? Le habla Laura, de UBITS. Sé que no esperaba mi llamada. ¿Me permite 30 segundos para contarle por qué la llamo, y usted decide si seguimos? ' +
  'La llamo porque vi que abrieron dos centros de distribución. Cuando se abren sedes así, lo que más cuesta es que los supervisores nuevos lleguen listos. '.repeat(2) +
  '¿Cómo lo están resolviendo hoy?';

function callPack(script: string, message = 'Andrea, le dejé un correo sobre los nuevos centros. Le escribo por ahí.') {
  const submission = parseWriterSubmission(
    {
      approach: 'trigger',
      reason_to_call: { text: 'Abrió dos centros de distribución.', fact_refs: ['F1'] },
      angle: 'Supervisores listos.',
      call_script: { text: script, fact_refs: ['F1'] },
      messages: [{ channel: 'call', text: message, fact_refs: ['F1'] }],
      questions: ['¿Cómo forman hoy a los supervisores?', '¿Quién define la inducción?', '¿Cómo miden el avance?'],
      objections: [{ library_key: 'not_interested', objection: 'No me interesa.', response: 'Es justo. ¿Es porque ya lo tienen resuelto?' }],
      next_step: 'Pedir 20 minutos.',
      meeting_ask: '¿Le parece si lo vemos 20 minutos el martes a las 10 o el jueves a las 4?',
      if_no: 'Preguntar si le escribo el próximo trimestre.',
      confirmation: 'Quedamos el martes a las 10. Agenda: los supervisores nuevos.',
      cautions: [],
    },
    ['call'],
  );
  return contentForChannel(submission, 'call');
}

const NOW = Date.parse('2026-10-19T12:00:00Z');

describe('estilo por país', () => {
  it('cada país con su forma; Colombia pide los 30 segundos a su manera y no dice «licenciado»', () => {
    assert.match(countryStyleFor('CO').permissionAsk, /me regala/i);
    assert.match(countryStyleFor('MX').permissionAsk, /me permite/i);
    assert.ok(countryStyleFor('MX').naturalWords.includes('platicar'));
    assert.ok(countryStyleFor('ES').foreignWords.includes('agendar'));
    assert.ok(countryStyleFor('AR').directness > countryStyleFor('GT').directness, 'Argentina más directa que Guatemala');
    assert.equal(countryStyleFor('JP'), countryStyleFor(null), 'sin estilo propio: el neutro');
  });

  it('el redactor recibe el estilo de su país y las reglas para no sonar a plantilla', () => {
    const message = buildWriterUserMessage({
      companyName: 'Andina',
      countryName: 'México',
      addressForm: 'usted',
      sellerName: 'Laura',
      decisionMaker: { name: 'Andrea', title: 'Gerente de Talento', roleFocus: 'x' },
      channels: ['call'],
      goals: ['book_meeting'],
      productKeys: [],
      approaches: [],
      recommendedApproach: 'problem',
      referralNote: null,
      countryCode: 'MX',
      briefStatus: 'sufficient',
      summary: null,
      facts: FACTS,
      hypotheses: [],
      gaps: [],
      hubspotWarning: null,
      regenerationReason: null,
    });
    assert.match(message, /Estilo para México/);
    assert.match(message, /NO uses \(suena a otro país\):.*me regala/);
    const system = buildWriterSystemPrompt();
    assert.match(system, /signos de apertura|abre siempre las preguntas/);
    assert.match(system, /me encantaría/);
    assert.ok(BANNED_PHRASES.includes('sinergia'));
  });

  it('las palabras de otro país se detectan enteras («vale la pena» no cuenta)', () => {
    assert.deepEqual(foreignWordsIn('¿Le parece si platicamos?', 'CO'), ['platicamos']);
    assert.deepEqual(foreignWordsIn('¿Le parece si lo platicamos? Ahorita le escribo.', 'CO'), ['platicamos', 'ahorita']);
    assert.deepEqual(foreignWordsIn('Quisiera platicar con usted.', 'CO'), ['platicar']);
    assert.deepEqual(foreignWordsIn('Quisiera platicar con usted.', 'MX'), []);
    assert.deepEqual(foreignWordsIn('Vale la pena conversarlo.', 'CO'), []);
    assert.deepEqual(foreignWordsIn('¿Podemos agendar una reunión?', 'ES'), ['agendar']);
    assert.deepEqual(foreignWordsIn('¿Podemos agendar una reunión?', 'CO'), []);
  });
});

describe('verificador: estilo del país', () => {
  it('un guion natural para México pasa', () => {
    assert.deepEqual(verifyPack(callPack(SCRIPT), FACTS, 'call', { nowMs: NOW, countryCode: 'MX', decisionMakerName: 'Andrea' }), []);
  });

  it('marca las palabras que suenan a otro país', () => {
    const issues = verifyPack(callPack(SCRIPT.replace('contarle', 'platicarle')), FACTS, 'call', { nowMs: NOW, countryCode: 'CL' });
    assert.ok(issues.some((i) => /suenan a otro: «platicar/.test(i)), issues.join(' | '));
  });

  it('marca el voseo en el primer contacto', () => {
    const issues = verifyPack(callPack(SCRIPT.replace('¿Cómo lo están resolviendo hoy?', '¿Vos cómo lo resolvés? ¿Tenés un minuto?')), FACTS, 'call', { nowMs: NOW, countryCode: 'AR' });
    assert.ok(issues.some((i) => /Tutea al decisor/.test(i)), issues.join(' | '));
  });

  it('marca una pregunta sin su «¿» (marca de texto traducido)', () => {
    const issues = verifyPack(callPack(SCRIPT.replace('¿Cómo lo están resolviendo hoy?', 'Cómo lo están resolviendo hoy?')), FACTS, 'call', { nowMs: NOW, countryCode: 'MX' });
    assert.ok(issues.some((i) => /signo de apertura/.test(i)), issues.join(' | '));
  });

  it('marca frases de plantilla o de IA', () => {
    const issues = verifyPack(callPack(SCRIPT.replace('¿Cómo lo están resolviendo hoy?', 'Me encantaría explorar sinergias. ¿Cómo lo están resolviendo hoy?')), FACTS, 'call', { nowMs: NOW, countryCode: 'MX' });
    assert.ok(issues.some((i) => /me encantaría/.test(i) && /sinergia/.test(i)), issues.join(' | '));
  });

  it('el bloque de estilo dice qué tan directo y cuánta cortesía', () => {
    assert.match(renderCountryStyle('AR', 'Argentina'), /directo/);
    assert.match(renderCountryStyle('GT', 'Guatemala'), /muy indirecto/);
  });
});

describe('normas de formación del país como contexto', () => {
  it('sólo lo verificado, y el redactor lo recibe con su fuente', async () => {
    const { renderTrainingContext, trainingContextFor } = await import('../country-training-context');
    assert.ok(trainingContextFor('MX').some((i) => i.name.startsWith('NOM-035')));
    assert.deepEqual(trainingContextFor('JP'), []);
    assert.equal(renderTrainingContext('JP', 'Japón'), null);
    assert.match(renderTrainingContext('CL', 'Chile')!, /SENCE.*1 %/);
    assert.match(renderTrainingContext('CL', 'Chile')!, /nunca para decir que la empresa incumple/);
  });

  it('nombrar la norma del país no cuenta como cifra sin fuente; en otro país sí', () => {
    const script = SCRIPT.replace('¿Cómo lo están resolviendo hoy?', 'Con la NOM-035 muchas áreas revisan cómo forman a sus líderes. ¿Cómo lo están resolviendo hoy?');
    const mx = verifyPack(callPack(script), FACTS, 'call', { nowMs: NOW, countryCode: 'MX' });
    assert.equal(mx.some((i) => /cifras/.test(i)), false, mx.join(' | '));
    const co = verifyPack(callPack(script), FACTS, 'call', { nowMs: NOW, countryCode: 'CO' });
    assert.ok(co.some((i) => /cifras/.test(i)), co.join(' | '));
  });
});

describe('las cifras de las normas no abren la puerta a cifras inventadas (revisión 19-10)', () => {
  it('en México una cifra o un porcentaje inventado sigue sin fuente aunque coincida con una norma', () => {
    const script = SCRIPT.replace('¿Cómo lo están resolviendo hoy?', 'Redujeron la rotación un 25 % y abrieron 16 sedes desde 2018. ¿Cómo lo están resolviendo hoy?');
    const issues = verifyPack(callPack(script), FACTS, 'call', { nowMs: NOW, countryCode: 'MX' });
    const numbers = issues.find((i) => /cifras/.test(i)) ?? '';
    assert.match(numbers, /25%/);
    assert.match(numbers, /16/);
    assert.match(numbers, /2018/);
  });

  it('sólo el nombre de la norma se limpia', async () => {
    const { stripTrainingNormIds } = await import('../country-training-context');
    assert.equal(stripTrainingNormIds('Con la NOM-035 y la ley 21.643', 'MX'), 'Con la NOM y la ley 21.643');
    assert.equal(stripTrainingNormIds('Con la Ley 21.643 (Ley Karin)', 'CL'), 'Con la Ley (Ley Karin)');
  });
});

describe('los nombres propios no cuentan como tuteo ni como palabra de otro país (revisión 19-10)', () => {
  it('«Aldeas Infantiles SOS» no es voseo', () => {
    const script = SCRIPT.replace('abrieron dos centros de distribución.', 'Aldeas Infantiles SOS abrió dos centros de distribución.');
    const issues = verifyPack(callPack(script), FACTS, 'call', { nowMs: NOW, countryCode: 'CO', companyName: 'Aldeas Infantiles SOS' });
    assert.equal(issues.some((i) => /Tutea/.test(i)), false, issues.join(' | '));
  });
});
