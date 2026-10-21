/**
 * Binga! en Prod (21-10, «Binga! Tu Marketplace de Pizza!», CL, CEO Julián): las 4
 * preparaciones quedaron «para revisar» por tres cosas que no estaban bien:
 *   1. el «!» del nombre de la empresa contaba como exclamación sin «¡» (falso aviso);
 *   2. la frase de permiso del país decía «por qué la llamo» a un hombre;
 *   3. la versión principal seguía con «cómo otras empresas de su tamaño están resolviendo…»
 *      después de corregir (sólo se quitaban las versiones alternativas).
 * Sin red.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { claimingSentences, contentForChannel, parseWriterSubmission, verifyPack, withoutNameSigns } from '../pack-verifier';
import { buildWriterSystemPrompt } from '../writer-prompt';
import { renderCountryStyle } from '../country-style';
import type { ResearchFact } from '../types';

const COMPANY = 'Binga! Tu Marketplace de Pizza!';
const FACTS: ResearchFact[] = [
  { id: 'F1', topic: 'business', statement: 'Binga! es un marketplace de pizza en la Región Metropolitana.', quote: null, sourceKind: 'official_site', sourceUrl: null, sourceLabel: 'Sitio', publishedOn: null },
];
const NOW = Date.parse('2026-10-21T17:00:00Z');

function pack(channel: 'email' | 'call' | 'linkedin', text: string, extra: Record<string, unknown> = {}) {
  const submission = parseWriterSubmission(
    {
      approach: 'insight',
      reason_to_call: { text: 'Binga! crece en la Región Metropolitana.', fact_refs: ['F1'] },
      angle: 'Que la gente nueva llegue lista.',
      call_script: { text: channel === 'call' ? text : '', fact_refs: ['F1'] },
      messages: [{ channel, text: channel === 'call' ? 'Hola Julián, soy Elkin de UBITS. Le dejo el motivo de mi llamada por aquí.' : text, fact_refs: ['F1'] }],
      questions: ['¿Cómo están resolviendo hoy la inducción en Binga!?', '¿Cuánto tarda alguien nuevo en rendir?', '¿Quién acompaña la formación?'],
      objections: [{ library_key: 'send_info', objection: 'Mándame información.', response: 'Con gusto. ¿Cuál es hoy el reto principal cuando entra alguien nuevo a Binga!?' }],
      next_step: 'Pedir 20 minutos.',
      meeting_ask: '¿Le acomoda el martes a las 10 o el jueves a las 3? Le llevo una demo con casos de su sector.',
      if_no: 'Preguntar si le escribo el próximo trimestre.',
      confirmation: 'Quedamos el martes a las 10.',
      cautions: [],
      ...extra,
    },
    [channel],
  );
  return contentForChannel(submission, channel);
}

const opts = { nowMs: NOW, countryCode: 'CL', companyName: COMPANY, decisionMakerName: 'Julián Helman', decisionMakerTitle: 'CEO' };

describe('Binga! — el «!» del nombre no es una exclamación', () => {
  it('quita los signos de las palabras del nombre, no los del texto', () => {
    assert.equal(withoutNameSigns('Vi que Binga! crece. ¡Felicitaciones!', COMPANY), 'Vi que Binga crece. ¡Felicitaciones!');
    assert.equal(withoutNameSigns('¿Cómo va?', null), '¿Cómo va?');
  });

  it('un guion que nombra «Binga!» ya no queda «para revisar» por el signo de apertura', () => {
    const issues = verifyPack(pack('call', 'Buenos días, ¿hablo con Julián? Le habla Elkin, de UBITS. Vi que Binga! está creciendo en la Región Metropolitana. ¿Cómo lo están viviendo con la gente nueva?'), FACTS, 'call', opts);
    assert.equal(issues.some((i) => /signo de apertura/.test(i)), false, issues.join(' | '));
  });

  it('una exclamación de verdad sin «¡» se sigue marcando', () => {
    const issues = verifyPack(pack('call', 'Buenos días, ¿hablo con Julián? Le habla Elkin, de UBITS. Qué buen momento para Binga! Felicitaciones por el crecimiento!'), FACTS, 'call', opts);
    assert.ok(issues.some((i) => /signo de apertura/.test(i)), issues.join(' | '));
  });
});

describe('Binga! — «por qué la llamo» a un hombre', () => {
  it('la frase de permiso de cada país ya no trae el género', () => {
    for (const code of ['CO', 'MX', 'CL', 'PE', 'EC', 'AR', 'CR', 'US']) {
      const style = renderCountryStyle(code, code) ?? '';
      assert.doesNotMatch(style, /por qué (la|lo) llamo/, code);
    }
  });

  it('el verificador lo marca si el cargo no dice el género o no coincide', () => {
    const text = 'Buenos días, ¿hablo con Julián? Le habla Elkin, de UBITS. ¿Me permite 30 segundos para contarle por qué la llamo?';
    assert.ok(verifyPack(pack('call', text), FACTS, 'call', opts).some((i) => /por qué la\/lo llamo/.test(i)));
    assert.ok(verifyPack(pack('call', text), FACTS, 'call', { ...opts, decisionMakerTitle: 'Director General' }).some((i) => /por qué la\/lo llamo/.test(i)));
    assert.equal(verifyPack(pack('call', text), FACTS, 'call', { ...opts, decisionMakerTitle: 'Directora General' }).some((i) => /por qué la\/lo llamo/.test(i)), false);
    const neutral = 'Buenos días, ¿hablo con Julián? Le habla Elkin, de UBITS. ¿Me permite 30 segundos para contarle el motivo de mi llamada?';
    assert.equal(verifyPack(pack('call', neutral), FACTS, 'call', opts).some((i) => /por qué la\/lo llamo/.test(i)), false);
  });

  it('el redactor recibe la regla', () => {
    assert.match(buildWriterSystemPrompt(), /el motivo de mi llamada/);
  });
});

describe('Binga! — clientes inventados que quedaban en la versión principal', () => {
  it('encuentra las frases textuales del correo, del LinkedIn y del pedido de reunión', () => {
    const email = pack(
      'email',
      'Asunto: Retención en equipos que crecen\n\nBuenos días, Julian:\n\nVi que Binga! está en la Región Metropolitana. ¿Le sirve que le comparta cómo otras empresas de su tamaño en la región están resolviendo que la gente nueva sea productiva?',
      { meeting_ask: '¿Le acomoda el martes a las 10? Quería mostrarle cómo otros equipos de su tamaño en consumo masivo lo están resolviendo con formación.' },
    );
    const claims = claimingSentences(email);
    assert.equal(claims.length, 2, claims.join(' | '));
    assert.ok(claims[0].includes('otras empresas de su tamaño'));
    assert.ok(claims[1].includes('otros equipos de su tamaño'));
  });

  it('lo permitido no se manda a corregir', () => {
    const clean = pack('email', 'Asunto: Gente nueva\n\nBuenos días, Julian:\n\nEn empresas que crecen así suele pasar que la gente nueva tarda en rendir. ¿Cómo lo están resolviendo hoy en Binga!?');
    assert.deepEqual(claimingSentences(clean), []);
  });
});
