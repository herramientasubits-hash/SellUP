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

import { claimingSentences, contentForChannel, parseWriterSubmission, verifyPack, withRecordNameSpelling, withoutNameSigns } from '../pack-verifier';
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

describe('Binga! — revisión de código', () => {
  it('un nombre de una palabra no se limpia dos veces y da igual la mayúscula', () => {
    assert.equal(withoutNameSigns('Yahoo!! Qué bien', 'Yahoo!'), 'Yahoo! Qué bien');
    assert.equal(withoutNameSigns('Vi que BINGA! crece', COMPANY), 'Vi que BINGA crece');
  });

  it('con el género del cargo, el aviso dice que no coincide', () => {
    const text = 'Buenos días, ¿hablo con Julián? Le habla Elkin, de UBITS. ¿Me permite 30 segundos para contarle por qué la llamo?';
    const issues = verifyPack(pack('call', text), FACTS, 'call', { ...opts, decisionMakerTitle: 'Director General' });
    assert.ok(issues.some((i) => /no coincide con el cargo/.test(i)), issues.join(' | '));
  });
});

describe('Binga! (2.ª corrida, 21-10) — lo que todavía se escapaba', () => {
  it('«qué están haciendo otros líderes de marketplaces…» es un cliente inventado', () => {
    const email = pack(
      'email',
      'Asunto: Retención\n\nBuenos días, Julian:\n\nEl 88 % de las organizaciones está preocupado por retener talento. ¿Le sirve que le comparta qué están haciendo otros líderes de marketplaces y distribuidoras en Chile para que el equipo se quede?',
    );
    assert.ok(verifyPack(email, FACTS, 'email', opts).some((i) => /experiencia, clientes o casos/.test(i)));
    assert.equal(claimingSentences(email).length, 1);
    const alsoAfter = pack('email', 'Asunto: Equipo\n\nBuenos días, Julian:\n\nOtras empresas de su tamaño están logrando que la gente rinda desde el primer día. ¿Lo conversamos?');
    assert.ok(verifyPack(alsoAfter, FACTS, 'email', opts).some((i) => /experiencia, clientes o casos/.test(i)));
  });

  it('una cifra de la biblioteca con otro sentido se marca; dicha como en la fuente, no', () => {
    const bent = pack('linkedin', 'Hola, Julian. El 88 % dice que la formación rápida en los primeros meses es clave. ¿Le sirve que hablemos?');
    assert.ok(verifyPack(bent, FACTS, 'linkedin', opts).some((i) => /cifra de la biblioteca con otro sentido/.test(i)));
    const faithful = pack('linkedin', 'Hola, Julian. El 88 % de las organizaciones está preocupado por retener talento. ¿Le sirve que hablemos?');
    assert.equal(verifyPack(faithful, FACTS, 'linkedin', opts).some((i) => /otro sentido/.test(i)), false);
    const fromFact = verifyPack(bent, [...FACTS, { ...FACTS[0], id: 'F2', statement: 'El 88 % de sus ventas son por la app.' }], 'linkedin', opts);
    assert.equal(fromFact.some((i) => /otro sentido/.test(i)), false, 'si la cifra sale de un hecho de la ficha, no es de la biblioteca');
  });

  it('el nombre queda como en la ficha en todos los textos; palabras comunes no se tocan', () => {
    const content = pack('call', 'Buenos días, ¿hablo con Julián? Le habla Elkin, de UBITS.');
    const fixed = withRecordNameSpelling(content, 'Julian Helman');
    assert.match(fixed.callScript.text, /hablo con Julian\?/);
    assert.doesNotMatch(JSON.stringify(fixed), /Julián/);
    assert.equal(withRecordNameSpelling('Hola, Julián.', 'Julian'), 'Hola, Julian.');
    assert.equal(withRecordNameSpelling('Hola, Julian.', 'Julián'), 'Hola, Julián.');
    assert.equal(withRecordNameSpelling('Queremos paz en el equipo, Paz.', 'María Paz'), 'Queremos paz en el equipo, Paz.');
    assert.equal(withRecordNameSpelling('Hola, Maria.', 'María Paz'), 'Hola, María.');
    assert.equal(withRecordNameSpelling('Julianita', 'Julián'), 'Julianita');
  });
});

describe('Binga! — la biblioteca no se contradice a sí misma', () => {
  it('cada afirmación con cifra, dicha tal cual, nombra su tema', async () => {
    const { UBITS_CLAIMS } = await import('../ubits-messaging-library');
    const { distortedLibraryClaims } = await import('../pack-verifier');
    for (const claim of UBITS_CLAIMS) {
      assert.deepEqual(distortedLibraryClaims([claim.text], []), [], claim.key);
    }
  });
});

describe('Binga! — revisión de código (2)', () => {
  it('preguntas sobre la propia empresa no se marcan', () => {
    for (const text of [
      '¿Qué están usando hoy en otros equipos de Binga! para la inducción?',
      'Otros equipos de su área lograron ordenar la inducción. ¿Cómo lo vive usted?',
      '¿Tiene 21 minutos el jueves para verlo?',
    ]) {
      const issues = verifyPack(pack('linkedin', `Hola, Julian. ${text}`), FACTS, 'linkedin', opts);
      assert.equal(issues.some((i) => /experiencia, clientes o casos|otro sentido/.test(i)), false, `${text} → ${issues.join(' | ')}`);
    }
  });

  it('«88 por ciento» con otro sentido también se marca', () => {
    const issues = verifyPack(pack('linkedin', 'Hola, Julian. El 88 por ciento dice que la formación rápida es clave. ¿Hablamos?'), FACTS, 'linkedin', opts);
    assert.ok(issues.some((i) => /otro sentido/.test(i)));
  });
});

describe('Binga! (3.ª corrida, 22-10) — la raíz: ofrecer contar lo que hacen otros', () => {
  const base = 'Asunto: Equipo nuevo\n\nBuenos días, Julian:\n\nVi que Binga! está creciendo en la Región Metropolitana. ';
  for (const phrase of [
    '¿Le sirve que le comparta cómo otros equipos de su tamaño aceleran la inducción?',
    '¿Le sirve que le comparta cómo otros en su rubro lo están resolviendo?',
    '¿Le sirve que le comparta cómo empresas de consumo masivo de su tamaño lo están resolviendo?',
    '¿Le muestro qué están haciendo empresas como la suya?',
    '¿Le cuento lo que hacen negocios similares para retener a la gente nueva?',
    'Empresas de su rubro aceleran la inducción con planes cortos.',
  ]) {
    it(`se marca: «${phrase}»`, () => {
      const issues = verifyPack(pack('email', `${base}${phrase}`), FACTS, 'email', opts);
      assert.ok(issues.some((i) => /experiencia, clientes o casos/.test(i)), issues.join(' | '));
    });
  }

  for (const phrase of [
    '¿Le muestro cómo podría verse en Binga!?',
    '¿Cómo lo están resolviendo hoy en Binga!?',
    '¿Le comparto cómo sus equipos podrían arrancar más rápido?',
    'Le cuento que en empresas de su tamaño suele pasar que la gente nueva tarda en rendir. ¿Cómo lo viven ustedes?',
    '¿Le muestro una demo de 20 minutos con casos de su sector?',
    '¿Cómo coordinan hoy la inducción con sus otros equipos?',
  ]) {
    it(`no se marca: «${phrase}»`, () => {
      const issues = verifyPack(pack('email', `${base}${phrase}`), FACTS, 'email', opts);
      assert.equal(issues.some((i) => /experiencia, clientes o casos/.test(i)), false, issues.join(' | '));
    });
  }

  it('las frases textuales llegan a la vuelta extra del redactor', () => {
    const claims = claimingSentences(pack('email', `${base}¿Le sirve que le comparta cómo otros en su rubro lo están resolviendo?`));
    assert.deepEqual(claims, ['¿Le sirve que le comparta cómo otros en su rubro lo están resolviendo?']);
  });

  it('el redactor recibe la regla y la alternativa permitida', () => {
    const system = buildWriterSystemPrompt();
    assert.match(system, /NUNCA ofrezcas contar o mostrar lo que hacen otros/);
    assert.match(system, /cómo podría verse EN ESA EMPRESA/);
  });
});

describe('Binga! — revisión de la regla de terceros (22-10)', () => {
  const base = 'Asunto: Equipo nuevo\n\nBuenos días, Julian:\n\nVi que Binga! está creciendo en la Región Metropolitana. ';
  for (const phrase of [
    '¿Le muestro cómo podrían verlo las otras sedes de Binga!?',
    '¿Le sirve que le muestre cómo se ve en otras áreas de su empresa?',
    '¿Le muestro cómo otras áreas de Binga! podrían usar la plataforma?',
    '¿Le muestro cómo lo verían los otros líderes de su equipo?',
    '¿Le muestro cómo se vería con las otras gerencias de Binga!?',
    '¿Le cuento cómo funciona en la práctica?',
    '¿Le parece si lo vemos en otro momento?',
  ]) {
    it(`de la propia empresa, no se marca: «${phrase}»`, () => {
      const issues = verifyPack(pack('email', `${base}${phrase}`), FACTS, 'email', opts);
      assert.equal(issues.some((i) => /experiencia, clientes o casos/.test(i)), false, issues.join(' | '));
    });
  }
  for (const phrase of [
    '¿Le gustaría ver cómo lo logran otras empresas de consumo masivo?',
    '¿Le comparto lo que están haciendo los demás bancos?',
    'Muchas empresas similares a Binga! lo resuelven con planes cortos.',
    '¿Le muestro ejemplos de cómo la competencia acelera la inducción?',
    '¿Le comparto algunos casos de empresas parecidas a la suya?',
  ]) {
    it(`se marca: «${phrase}»`, () => {
      const issues = verifyPack(pack('email', `${base}${phrase}`), FACTS, 'email', opts);
      assert.ok(issues.some((i) => /experiencia, clientes o casos/.test(i)), issues.join(' | '));
    });
  }
});
