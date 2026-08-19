// Agente 2A — EL COPY de «Buscar más números», y su frontera con «Ver más números»
// (AGENT2A-SEARCH-MORE-PHONES-1)
//
// Las dos operaciones viven a centímetros una de otra en el mismo panel: una es GRATIS y
// abre lo ya guardado, la otra PAGA y consulta a un proveedor. El riesgo real no es un copy
// feo, es que el operador confunda cuál es cuál. Esta suite vigila esa frontera en las DOS
// direcciones, leyendo los dos archivos.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  SEARCH_MORE_CTA_LABEL,
  SEARCH_MORE_RUNNING_LABEL,
  SEARCH_MORE_CONFIRM_TITLE,
  SEARCH_MORE_CONFIRM_BODY,
  SEARCH_MORE_CONFIRM_ACCEPT_LABEL,
  SEARCH_MORE_CONFIRM_CANCEL_LABEL,
  SEARCH_MORE_NO_NEW_PHONES_COPY,
  SEARCH_MORE_EXHAUSTED_COPY,
  SEARCH_MORE_PROVIDER_ERROR_COPY,
  SEARCH_MORE_PRIVACY_BLOCKED_COPY,
  getSearchMoreSuccessCopy,
  getSearchMoreProviderLine,
  getSearchMoreMaxCreditsLine,
  getSearchMoreDeferredProvidersLine,
  getSearchMoreDisabledCopy,
} from '../search-more-phones-copy';
import { PHONE_REVEAL_IDENTITY_BLOCKED_COPY } from '@/modules/contact-enrichment/phone-reveal-identity-eligibility';

const here = dirname(fileURLToPath(import.meta.url));
const SEARCH_MORE_FILE = join(here, '..', 'search-more-phones-copy.ts');
const STORED_PHONES_FILE = join(here, '..', 'candidate-stored-phones-copy.ts');

const searchMoreSource = readFileSync(SEARCH_MORE_FILE, 'utf8');
const storedPhonesSource = readFileSync(STORED_PHONES_FILE, 'utf8');

describe('AGENT2A-SEARCH-MORE-PHONES-1 · el costo se nombra ANTES del clic que gasta', () => {
  it('la confirmación dice explícitamente que puede consumir créditos', () => {
    assert.match(SEARCH_MORE_CONFIRM_BODY, /puede consumir créditos/i);
  });

  it('la confirmación NO promete encontrar nada', () => {
    // El resultado honesto más probable es que no haya números adicionales. Un copy que
    // prometiera hallazgos dejaría al operador leyendo el resultado como un fallo.
    assert.match(SEARCH_MORE_CONFIRM_BODY, /intentará/i);
    assert.doesNotMatch(SEARCH_MORE_CONFIRM_BODY, /encontrarás|obtendrás|garantiza/i);
  });

  it('la confirmación ofrece las DOS salidas, y cancelar es una de ellas', () => {
    assert.equal(SEARCH_MORE_CONFIRM_CANCEL_LABEL, 'Cancelar');
    assert.ok(SEARCH_MORE_CONFIRM_ACCEPT_LABEL.length > 0);
    assert.notEqual(SEARCH_MORE_CONFIRM_CANCEL_LABEL, SEARCH_MORE_CONFIRM_ACCEPT_LABEL);
  });

  it('el techo se presenta como MÁXIMO, nunca como precio', () => {
    assert.equal(getSearchMoreMaxCreditsLine(5), 'Máximo autorizado: 5 créditos.');
    assert.equal(getSearchMoreMaxCreditsLine(1), 'Máximo autorizado: 1 crédito.');
    for (const line of [getSearchMoreMaxCreditsLine(5), getSearchMoreMaxCreditsLine(8)]) {
      assert.doesNotMatch(String(line), /costará|precio|cuesta/i);
    }
  });

  it('un techo ausente o absurdo NO produce una línea de costo', () => {
    for (const value of [0, -1, 2.5, Number.NaN]) {
      assert.equal(getSearchMoreMaxCreditsLine(value), null, String(value));
    }
  });

  it('la fuente se nombra cuando se puede, y NUNCA se escribe «ninguna fuente»', () => {
    assert.equal(getSearchMoreProviderLine(['lusha']), 'Fuente que se consultará: Lusha.');
    assert.equal(getSearchMoreProviderLine(['apollo']), 'Fuente que se consultará: Apollo.');
    assert.equal(
      getSearchMoreProviderLine(['lusha', 'apollo']),
      'Fuentes que se consultarán: Lusha, Apollo.',
    );
    assert.equal(getSearchMoreProviderLine([]), null, 'sin fuente, se omite la línea');
  });

  it('avisa cuando aún quedará otra fuente después de esta corrida', () => {
    // Sin esto, el operador leería el resultado de UNA fuente como el veredicto de todas.
    assert.match(String(getSearchMoreDeferredProvidersLine(['apollo'])), /otra fuente/i);
    assert.equal(getSearchMoreDeferredProvidersLine([]), null);
  });
});

describe('AGENT2A-SEARCH-MORE-PHONES-1 · el resultado no afirma más de lo que se sabe', () => {
  it('«sin números nuevos» habla de ADICIONALES, no de la existencia del teléfono', () => {
    assert.match(SEARCH_MORE_NO_NEW_PHONES_COPY, /adicionales/i);
    // El contacto SÍ tiene teléfono: sigue visible arriba. Decir lo contrario sería falso.
    assert.doesNotMatch(SEARCH_MORE_NO_NEW_PHONES_COPY, /no tiene teléfono|sin teléfono/i);
  });

  it('el éxito dice CUÁNTOS y dice ADICIONALES', () => {
    assert.equal(getSearchMoreSuccessCopy(1), 'Encontramos 1 número adicional.');
    assert.equal(getSearchMoreSuccessCopy(3), 'Encontramos 3 números adicionales.');
  });

  it('el fallo del proveedor se dice como fallo, no como «no encontramos»', () => {
    assert.match(SEARCH_MORE_PROVIDER_ERROR_COPY, /no pudimos completar/i);
    assert.doesNotMatch(SEARCH_MORE_PROVIDER_ERROR_COPY, /no encontramos/i);
  });

  it('el agotamiento NO invita a reintentar: la carencia es estructural', () => {
    assert.doesNotMatch(SEARCH_MORE_EXHAUSTED_COPY, /vuelve a intentar|más tarde|reintent/i);
  });

  it('el bloqueo de privacidad REUTILIZA el copy del reveal, no escribe otro', () => {
    // Dos redacciones del mismo bloqueo se separarían en cuanto una se corrigiera.
    assert.equal(SEARCH_MORE_PRIVACY_BLOCKED_COPY, PHONE_REVEAL_IDENTITY_BLOCKED_COPY);
  });

  it('ningún copy de resultado nombra un proveedor: el operador no compra por marca', () => {
    for (const copy of [
      SEARCH_MORE_NO_NEW_PHONES_COPY,
      SEARCH_MORE_EXHAUSTED_COPY,
      SEARCH_MORE_PROVIDER_ERROR_COPY,
      getSearchMoreSuccessCopy(2),
    ]) {
      assert.doesNotMatch(copy, /apollo|lusha/i, copy);
    }
  });
});

describe('AGENT2A-SEARCH-MORE-PHONES-1 · el botón deshabilitado explica el bloqueo', () => {
  it('`no_stored_phone` NO produce copy: ahí toca «Revelar teléfono», no un botón muerto', () => {
    assert.equal(getSearchMoreDisabledCopy('no_stored_phone'), null);
  });

  it('`feature_disabled` NO produce copy: un permiso apagado se resuelve NO renderizando', () => {
    // La lección de #287: «disabled» no es mostrar una función que no existe.
    assert.equal(getSearchMoreDisabledCopy('feature_disabled'), null);
  });

  it('el agotamiento y la falta de fuente comparten el copy honesto', () => {
    assert.equal(getSearchMoreDisabledCopy('providers_exhausted'), SEARCH_MORE_EXHAUSTED_COPY);
    assert.equal(getSearchMoreDisabledCopy('no_additional_provider'), SEARCH_MORE_EXHAUSTED_COPY);
  });

  it('los tres bloqueos de privacidad comparten copy y NINGUNO revela cuál fue', () => {
    // Distinguirlos en pantalla filtraría si la persona ejerció una DSAR.
    const suppressed = getSearchMoreDisabledCopy('blocked_suppressed');
    assert.equal(getSearchMoreDisabledCopy('do_not_contact'), suppressed);
    assert.equal(getSearchMoreDisabledCopy('suppression_check_unavailable'), suppressed);
    assert.equal(getSearchMoreDisabledCopy('missing_person_identity'), suppressed);
    assert.doesNotMatch(String(suppressed), /suprim|dsar|bloquead|lista/i);
  });

  it('una corrida activa se explica sin invitar a un segundo clic', () => {
    assert.match(String(getSearchMoreDisabledCopy('active_run_exists')), /en curso/i);
  });
});

describe('AGENT2A-SEARCH-MORE-PHONES-1 · la frontera con «Ver más números»', () => {
  it('el CTA de ESTA acción dice BUSCAR, no VER', () => {
    assert.match(SEARCH_MORE_CTA_LABEL, /^Buscar/);
    assert.doesNotMatch(SEARCH_MORE_CTA_LABEL, /^Ver/);
    assert.match(SEARCH_MORE_RUNNING_LABEL, /Buscando/);
  });

  it('el título de la confirmación también dice BUSCAR', () => {
    assert.match(SEARCH_MORE_CONFIRM_TITLE, /Buscar/);
  });

  it('«Ver más números» sigue SIN usar ningún verbo de búsqueda', () => {
    // El ratchet de 4O-G, releído desde este lado: si alguien «unificara» los dos copys, la
    // acción gratuita empezaría a parecer pagada y al revés.
    const ctaBlock = storedPhonesSource
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n');
    assert.doesNotMatch(ctaBlock, /Buscar|Buscando|Encontrar|Revelar|Enriquecer/i);
  });

  it('este archivo NO reutiliza «Ver …más» como su propia acción', () => {
    const declarations = searchMoreSource
      .split('\n')
      .filter((line) => /^\s*(export const|return)\s/.test(line))
      .join('\n');
    assert.doesNotMatch(declarations, /'Ver \d|'Ver más/);
  });

  it('ningún copy de este archivo contiene un número de teléfono', () => {
    const literals = [...searchMoreSource.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    for (const literal of literals) {
      assert.doesNotMatch(literal, /\+\d{6,}|\d{7,}/, literal);
    }
  });
});
