// Agente 2A — EL COPY de «Buscar más números», y su frontera con «Ver más números»
// (AGENT2A-SEARCH-MORE-PHONES-1 · divulgación pre-clic desde 1J)
//
// Las dos operaciones viven a centímetros una de otra en el mismo panel: una es GRATIS y
// abre lo ya guardado, la otra PAGA y consulta a un proveedor. El riesgo real no es un copy
// feo, es que el operador confunda cuál es cuál. Esta suite vigila esa frontera en las DOS
// direcciones, leyendo los dos archivos.
//
// ═══════════════════════════════════════════════════════════════════
// 1J — LA CONFIRMACIÓN SE FUE; SUS ASERCIONES NO
// ═══════════════════════════════════════════════════════════════════
//
// 1J retira el modal: «Buscar más números» es una acción DIRECTA. Con él se van cuatro
// constantes (`SEARCH_MORE_CONFIRM_TITLE`, `…_BODY`, `…_CANCEL_LABEL`, `…_ACCEPT_LABEL`) y las
// dos líneas del `<dl>` que sólo ese diálogo montaba (`getSearchMoreProviderLine`,
// `getSearchMoreMaxCreditsLine`).
//
// NINGUNA de sus reglas se relaja: las tres que protegían algo real —nombrar a LUSHA, no
// prometer un hallazgo, y presentar el techo como MÁXIMO y jamás como precio— se reafirman
// aquí sobre `getSearchMoreCostDisclosure`, que es la línea que ahora se lee ANTES del clic.
// Y la frase de honestidad sobrevive palabra por palabra bajo su nombre nuevo
// (`SEARCH_MORE_COST_HONESTY_COPY`): sin diálogo intermedio es la ÚNICA advertencia del flujo,
// así que se vigila MÁS, no menos.
//
// Lo que sí desaparece es la aserción de «las dos salidas, y cancelar es una de ellas»: no
// hay diálogo del que salir, y el operador cancela no pulsando. Mantenerla habría exigido
// conservar dos etiquetas de botones que no se renderizan.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  SEARCH_MORE_CTA_LABEL,
  SEARCH_MORE_RUNNING_LABEL,
  SEARCH_MORE_NO_NEW_PHONES_COPY,
  SEARCH_MORE_EXHAUSTED_COPY,
  SEARCH_MORE_PROVIDER_ERROR_COPY,
  SEARCH_MORE_PRIVACY_BLOCKED_COPY,
  getSearchMoreSuccessCopy,
  getSearchMoreCostDisclosure,
  getSearchMoreDisabledCopy,
  SEARCH_MORE_COST_HONESTY_COPY,
  SEARCH_MORE_NO_NEW_DISTINCT_PHONES_COPY,
  SEARCH_MORE_BUDGET_NOT_CONFIGURED_COPY,
  SEARCH_MORE_INSUFFICIENT_CREDITS_COPY,
  SEARCH_MORE_BUDGET_UNAVAILABLE_COPY,
} from '../search-more-phones-copy';
import { PHONE_REVEAL_IDENTITY_BLOCKED_COPY } from '@/modules/contact-enrichment/phone-reveal-identity-eligibility';

const here = dirname(fileURLToPath(import.meta.url));
const SEARCH_MORE_FILE = join(here, '..', 'search-more-phones-copy.ts');
const STORED_PHONES_FILE = join(here, '..', 'candidate-stored-phones-copy.ts');

const searchMoreSource = readFileSync(SEARCH_MORE_FILE, 'utf8');
const storedPhonesSource = readFileSync(STORED_PHONES_FILE, 'utf8');

describe('AGENT2A-SEARCH-MORE-PHONES-1 · el costo se nombra ANTES del clic que gasta', () => {
  // La divulgación canónica del flujo: UN proveedor, el techo real de 5.
  const DISCLOSURE = getSearchMoreCostDisclosure(['lusha'], 5);

  it('la divulgación pre-clic dice explícitamente que puede consumir créditos', () => {
    assert.match(SEARCH_MORE_COST_HONESTY_COPY, /puede consumir créditos/i);
  });

  it('la advertencia de costo cubre el caso en que Lusha NO encuentre nada', () => {
    // El punto entero de la frase. El desenlace más probable de esta compra es
    // `no_new_distinct_phone`: Lusha contesta, cobra, y devuelve lo que ya estaba. Si la
    // divulgación no dice eso, el operador cree que sólo paga cuando gana algo — y desde 1J
    // no hay un diálogo detrás que se lo repita.
    assert.match(SEARCH_MORE_COST_HONESTY_COPY, /aunque/i);
    assert.match(SEARCH_MORE_COST_HONESTY_COPY, /no encuentre/i);
  });

  it('§9 el techo de 5 créditos se lee ANTES del clic, no dentro de un diálogo', () => {
    // 1J: no hay confirmación, así que ésta es la única oportunidad de decir el techo.
    assert.match(String(DISCLOSURE), /hasta 5 créditos/);
    // Ni el techo de Apollo ni el del waterfall completo.
    assert.doesNotMatch(String(DISCLOSURE), /8 créditos|13 créditos/);
  });

  it('la divulgación NOMBRA a Lusha: el operador autoriza un gasto concreto', () => {
    // v1 es Lusha-only, así que «otra fuente disponible» sería una abstracción innecesaria
    // sobre una decisión de compra. Se nombra el proveedor que se va a cobrar.
    assert.match(String(DISCLOSURE), /lusha/i);
    assert.doesNotMatch(
      String(DISCLOSURE),
      /apollo/i,
      'Apollo no se consulta en esta operación: nombrarlo sería falso',
    );
  });

  it('la divulgación NO promete encontrar nada', () => {
    // El resultado honesto más probable es que no haya números adicionales. Un copy que
    // prometiera hallazgos dejaría al operador leyendo el resultado como un fallo.
    for (const copy of [String(DISCLOSURE), SEARCH_MORE_COST_HONESTY_COPY]) {
      assert.doesNotMatch(copy, /encontrarás|obtendrás|garantiza/i, copy);
    }
  });

  it('el techo se presenta como MÁXIMO, nunca como precio', () => {
    // Heredado de `getSearchMoreMaxCreditsLine`, que 1J retira con el `<dl>` del modal. La
    // regla sobrevive: «hasta» es un techo; «costará» inventaría una cifra que sólo el
    // proveedor conoce, y que suele ser menor.
    assert.equal(getSearchMoreCostDisclosure(['lusha'], 5), 'Consulta con Lusha · hasta 5 créditos');
    assert.equal(getSearchMoreCostDisclosure(['lusha'], 1), 'Consulta con Lusha · hasta 1 crédito');
    for (const credits of [1, 5, 8]) {
      assert.doesNotMatch(
        String(getSearchMoreCostDisclosure(['lusha'], credits)),
        /costará|precio|cuesta/i,
      );
    }
  });

  it('un techo ausente o absurdo NO produce divulgación, y por tanto NO produce botón', () => {
    // Fail-closed. La UI trata este null como «no renderizar»: con el modal fuera, un botón
    // pagado sin línea de costo sería un clic que gasta sin advertencia previa.
    for (const value of [0, -1, 2.5, Number.NaN]) {
      assert.equal(getSearchMoreCostDisclosure(['lusha'], value), null, String(value));
    }
  });

  it('la fuente se nombra cuando se puede, y NUNCA se escribe «ninguna fuente»', () => {
    assert.equal(getSearchMoreCostDisclosure([], 5), null, 'sin fuente, no hay divulgación');
  });

  it('las cuatro constantes del modal NO pueden volver por la puerta de atrás', () => {
    // 1J retira la confirmación. Reintroducir cualquiera de sus etiquetas sería el primer
    // paso para volver a montar el diálogo sobre el drawer.
    for (const removed of [
      'SEARCH_MORE_CONFIRM_TITLE',
      'SEARCH_MORE_CONFIRM_BODY',
      'SEARCH_MORE_CONFIRM_ACCEPT_LABEL',
      'SEARCH_MORE_CONFIRM_CANCEL_LABEL',
      'SEARCH_MORE_CONFIRM_COST_WARNING',
    ]) {
      assert.equal(
        searchMoreSource.includes(`export const ${removed}`),
        false,
        `${removed} pertenece al modal que 1J retira`,
      );
    }
  });

  it('NO existe una línea de «fuentes diferidas», porque sería una promesa falsa', () => {
    // Con UN solo proveedor, una corrida elegible agota todas las fuentes disponibles.
    // Anunciar que «quedará otra fuente por consultar aparte» prometería una segunda
    // operación que no existe — el tipo exacto de afirmación que este archivo prohíbe.
    assert.doesNotMatch(
      searchMoreSource,
      /export function getSearchMoreDeferredProvidersLine/,
      'la línea de diferidos no puede volver mientras v1 sea Lusha-only',
    );
    assert.doesNotMatch(searchMoreSource, /quedará otra fuente/i);
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

  it('§18: el fallo del proveedor TAMPOCO promete un reintento', () => {
    // Una corrida `search_more` terminal agota Lusha para este candidato, y eso incluye el
    // desenlace `error`. Prometer «vuelve a intentarlo» ofrecería una compra que el
    // planificador ya no autoriza, y el operador encontraría el botón deshabilitado.
    assert.doesNotMatch(
      SEARCH_MORE_PROVIDER_ERROR_COPY,
      /vuelve a intentar|inténtalo de nuevo|reintent/i,
    );
    // Lo que SÍ dice: que no se perdió nada. El teléfono que ya había sigue ahí.
    assert.match(SEARCH_MORE_PROVIDER_ERROR_COPY, /sigue disponible/i);
  });

  it('el bloqueo de privacidad REUTILIZA el copy del reveal, no escribe otro', () => {
    // Dos redacciones del mismo bloqueo se separarían en cuanto una se corrigiera.
    assert.equal(SEARCH_MORE_PRIVACY_BLOCKED_COPY, PHONE_REVEAL_IDENTITY_BLOCKED_COPY);
  });

  // ── El desenlace que SÓLO esta operación produce ──────────────

  it('«no hay números DISTINTOS» es una cadena propia, no un alias de «no encontramos»', () => {
    // Los dos hechos son distintos y el copy no puede colapsarlos: en `no_phone_found`
    // Lusha no tiene nada; en `no_new_distinct_phone` Lusha tiene, cobró, y es el mismo.
    assert.notEqual(
      SEARCH_MORE_NO_NEW_DISTINCT_PHONES_COPY,
      SEARCH_MORE_NO_NEW_PHONES_COPY,
    );
    assert.match(SEARCH_MORE_NO_NEW_DISTINCT_PHONES_COPY, /diferentes/i);
    assert.doesNotMatch(
      SEARCH_MORE_NO_NEW_DISTINCT_PHONES_COPY,
      /no tiene teléfono|sin teléfono|no encontramos números adicionales/i,
      'Lusha SÍ tiene teléfono para esta persona: es el que ya está guardado',
    );
  });

  it('ningún copy de resultado afirma que el contacto NO tiene teléfono', () => {
    for (const copy of [
      SEARCH_MORE_NO_NEW_PHONES_COPY,
      SEARCH_MORE_NO_NEW_DISTINCT_PHONES_COPY,
      SEARCH_MORE_EXHAUSTED_COPY,
      SEARCH_MORE_PROVIDER_ERROR_COPY,
      getSearchMoreSuccessCopy(2),
    ]) {
      assert.doesNotMatch(copy, /no tiene teléfono|sin teléfono/i, copy);
    }
  });

  // INVERSIÓN DELIBERADA (v1 Lusha-only). La versión anterior de esta suite exigía que
  // NINGÚN copy de resultado nombrara un proveedor, con el argumento de que «el operador no
  // compra por marca». La decisión de la dueña invierte la premisa: v1 consulta a Lusha y
  // sólo a Lusha, así que el resultado puede —y debe— decir DE QUÉ FUENTE habla. La regla
  // que sobrevive, y que es la que realmente protegía algo, es que NINGÚN copy pueda nombrar
  // a APOLLO: Apollo no se consulta aquí, y nombrarlo describiría una operación inexistente.
  it('ningún copy de esta operación nombra a APOLLO', () => {
    for (const copy of [
      SEARCH_MORE_CTA_LABEL,
      SEARCH_MORE_RUNNING_LABEL,
      SEARCH_MORE_COST_HONESTY_COPY,
      SEARCH_MORE_NO_NEW_PHONES_COPY,
      SEARCH_MORE_NO_NEW_DISTINCT_PHONES_COPY,
      SEARCH_MORE_EXHAUSTED_COPY,
      SEARCH_MORE_PROVIDER_ERROR_COPY,
      getSearchMoreSuccessCopy(2),
      String(getSearchMoreCostDisclosure(['lusha'], 5)),
    ]) {
      assert.doesNotMatch(copy, /apollo/i, copy);
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

  it('la divulgación pre-clic tampoco reusa el verbo VER', () => {
    // 1J retira el título del modal, que era donde antes se afirmaba el verbo por segunda
    // vez. La línea que lo sustituye habla de CONSULTAR una fuente, que es lo que ocurre, y
    // en ningún caso de VER algo ya guardado — el verbo del CTA gratuito de al lado.
    const disclosure = String(getSearchMoreCostDisclosure(['lusha'], 5));
    assert.match(disclosure, /^Consulta con/);
    assert.doesNotMatch(disclosure, /\bVer\b/);
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

// ═══════════════════════════════════════════════════════════════
// 1K — LOS TRES HECHOS DE PRESUPUESTO, Y QUE SIGUEN SIENDO TRES
// ═══════════════════════════════════════════════════════════════
//
// El síntoma de Producción era una frase: «No pudimos iniciar la búsqueda. No se consumió
// ningún crédito.» — el genérico del clic — para una condición que el servidor ya conocía
// antes de pintar la pantalla. Estos casos fijan que cada uno de los tres hechos tenga su
// propia frase, que ninguna afirme lo que no se comprobó, y que ninguna hable de la persona.

describe('AGENT2A-SEARCH-MORE-PHONES-1K · el presupuesto se explica sin mentir', () => {
  const BUDGET_REASONS = [
    'budget_not_configured',
    'insufficient_credits',
    'credit_balance_unavailable',
  ] as const;

  it('los tres motivos producen copy, y TRES cadenas DISTINTAS', () => {
    const copies = BUDGET_REASONS.map((reason) => getSearchMoreDisabledCopy(reason));
    for (const [index, copy] of copies.entries()) {
      assert.ok(copy, `${BUDGET_REASONS[index]} tiene que poder explicarse`);
    }
    assert.equal(
      new Set(copies).size,
      3,
      'colapsarlas mandaría al operador a la gestión equivocada: créditos vs configuración vs reintento',
    );
  });

  it('«no hay presupuesto» NO habla de créditos: lo que falta es la regla', () => {
    assert.equal(
      getSearchMoreDisabledCopy('budget_not_configured'),
      SEARCH_MORE_BUDGET_NOT_CONFIGURED_COPY,
    );
    assert.match(SEARCH_MORE_BUDGET_NOT_CONFIGURED_COPY, /presupuesto/i);
    assert.doesNotMatch(
      SEARCH_MORE_BUDGET_NOT_CONFIGURED_COPY,
      /créditos suficientes|saldo insuficiente/i,
      'mandar a conseguir créditos no desbloquearía nada: no hay regla contra la que reservar',
    );
  });

  it('«no alcanza» SÍ habla de créditos, y nombra la fuente concreta', () => {
    assert.equal(
      getSearchMoreDisabledCopy('insufficient_credits'),
      SEARCH_MORE_INSUFFICIENT_CREDITS_COPY,
    );
    assert.match(SEARCH_MORE_INSUFFICIENT_CREDITS_COPY, /créditos/i);
    assert.match(SEARCH_MORE_INSUFFICIENT_CREDITS_COPY, /lusha/i);
  });

  it('«no se pudo verificar» no afirma NI que falte saldo NI que falte regla', () => {
    assert.equal(
      getSearchMoreDisabledCopy('credit_balance_unavailable'),
      SEARCH_MORE_BUDGET_UNAVAILABLE_COPY,
    );
    assert.match(SEARCH_MORE_BUDGET_UNAVAILABLE_COPY, /no pudimos verificar/i);
    assert.doesNotMatch(
      SEARCH_MORE_BUDGET_UNAVAILABLE_COPY,
      /no hay créditos|no hay presupuesto activo/i,
      'no se pudo mirar el pozo: decir por qué sería inventarse el hecho',
    );
  });

  it('ninguna de las tres dice nada sobre la PERSONA ni sobre su teléfono', () => {
    for (const copy of [
      SEARCH_MORE_BUDGET_NOT_CONFIGURED_COPY,
      SEARCH_MORE_INSUFFICIENT_CREDITS_COPY,
      SEARCH_MORE_BUDGET_UNAVAILABLE_COPY,
    ]) {
      assert.doesNotMatch(
        copy,
        /no tiene teléfono|sin teléfono|no encontramos|contacto no|privacidad/i,
        `un hecho de tesorería no puede leerse como un hecho sobre el contacto: ${copy}`,
      );
      assert.doesNotMatch(copy, /apollo/i, copy);
    }
  });

  it('ninguna de las tres expone la forma INTERNA del presupuesto', () => {
    // Ni el id de la regla, ni su scope, ni el consumo exacto, ni el techo. El operador
    // necesita saber qué hacer, no cómo está modelado el pozo.
    for (const copy of [
      SEARCH_MORE_BUDGET_NOT_CONFIGURED_COPY,
      SEARCH_MORE_INSUFFICIENT_CREDITS_COPY,
      SEARCH_MORE_BUDGET_UNAVAILABLE_COPY,
    ]) {
      assert.doesNotMatch(copy, /budget_rules|scope|regla id|uuid|[0-9a-f]{8}-[0-9a-f]{4}/i, copy);
      assert.doesNotMatch(copy, /\d+\s*(créditos|crédito)/i, copy);
    }
  });

  it('el genérico del clic NO es el copy de ninguna de las tres', () => {
    // Ese texto existe para lo que de verdad se descubre al pulsar. Usarlo para una condición
    // conocida ANTES del clic es exactamente lo que la QA de Producción vio.
    for (const copy of [
      SEARCH_MORE_BUDGET_NOT_CONFIGURED_COPY,
      SEARCH_MORE_INSUFFICIENT_CREDITS_COPY,
      SEARCH_MORE_BUDGET_UNAVAILABLE_COPY,
    ]) {
      assert.doesNotMatch(copy, /No pudimos iniciar la búsqueda/i, copy);
    }
  });
});
