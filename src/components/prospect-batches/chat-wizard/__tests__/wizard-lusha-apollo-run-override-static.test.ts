/**
 * wizard-lusha-apollo-run-override-static.test.ts — lo que la corrección de
 * HALLAZGO-B NO puede haber introducido.
 *
 * A1-LUSHA-APOLLO-RUN-OVERRIDE § HALLAZGO-B.
 *
 * Las pruebas de render demuestran que el selector sobrevive al bloqueo. Estas
 * demuestran lo contrario: que sobrevivir no trajo de contrabando un reset
 * silencioso, un bypass de la autorización server-derived, una ejecución
 * automática de Lusha, ni un dedo en billing, flags o Agente 2A.
 *
 * Texto fuente puro: sin DOM, sin red, sin base de datos.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();
const SUMMARY_PATH = join(
  ROOT,
  'src/components/prospect-batches/chat-wizard/wizard-conversation-summary.tsx',
);
const SELECTOR_PATH = join(
  ROOT,
  'src/components/prospect-batches/chat-wizard/wizard-run-provider-selector.tsx',
);
const WIZARD_PATH = join(
  ROOT,
  'src/components/prospect-batches/chat-wizard/prospect-chat-wizard.tsx',
);

const summary = readFileSync(SUMMARY_PATH, 'utf8');
const selector = readFileSync(SELECTOR_PATH, 'utf8');
const wizard = readFileSync(WIZARD_PATH, 'utf8');

/** Quita comentarios: nombrar una prohibición en prosa no puede violarla. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const summaryCode = stripComments(summary);
const selectorCode = stripComments(selector);
const wizardCode = stripComments(wizard);

describe('HALLAZGO-B — no hay reset automático de requestedProvider', () => {
  it('el resumen nunca invoca el callback de cambio de proveedor: sólo lo entrega', () => {
    // Un `onRequestedProviderChange('tavily')` en cualquier parte del render (o de
    // un efecto) sería el reset silencioso que el hito prohíbe: la pantalla
    // decidiendo por la usuaria a qué proveedor vuelve tras un fallo.
    assert.doesNotMatch(summaryCode, /onRequestedProviderChange\s*\(/);
    assert.match(summaryCode, /onChange=\{onRequestedProviderChange\}/);
  });

  it('el resumen no tiene estado ni efectos propios de proveedor', () => {
    assert.doesNotMatch(summaryCode, /useEffect/);
    assert.doesNotMatch(summaryCode, /setRequestedProvider/);
  });

  it('el único escritor de `requestedProvider` sigue siendo el `useState` del wizard', () => {
    assert.match(wizardCode, /const \[requestedProvider, setRequestedProvider\] = React\.useState</);
    // Se entrega tal cual al resumen: nadie interpone una función que lo reescriba.
    assert.match(wizardCode, /onRequestedProviderChange=\{setRequestedProvider\}/);
  });

  it('el único `setRequestedProvider` del wizard es el reinicio de CORRIDA NUEVA', () => {
    // Existe UNA escritura automática y es anterior a este hito: al acuñar un
    // `clientRequestId` nuevo la elección de proveedor vuelve al automático,
    // porque pertenece a la corrida que termina. No la dispara ningún fallo, y
    // «Editar búsqueda» conserva el id — y por tanto la elección.
    const writes = [...wizardCode.matchAll(/setRequestedProvider\s*\(/g)];
    assert.equal(writes.length, 1, 'una escritura automática y sólo una');
    assert.match(
      wizardCode,
      /if \(!clientRequestIdRef\.current\) \{[\s\S]{0,200}?setRequestedProvider\(undefined\);/,
      'la única escritura vive en el nacimiento de una corrida nueva',
    );
    // Y ningún fallo la dispara: nada la ata a un código de error ni a un bloqueo.
    assert.doesNotMatch(
      wizardCode,
      /(BUDGET_EXCEEDED|PERSISTENCE_NOT_READY|executionError)[\s\S]{0,200}?setRequestedProvider\(/,
    );
  });
});

describe('HALLAZGO-B — no hay bypass de la autorización server-derived', () => {
  it('la escotilla sigue exigiendo la capacidad sanitizada por el servidor', () => {
    assert.match(
      summaryCode,
      /canOverrideLushaWithApollo =\s*\n\s*lushaRouteInEffect &&\s*\n\s*isProviderOptionEnabled\(providerOverrideCapability, 'apollo_organizations'\)/,
    );
  });

  it('la excepción al gate de bloqueo NO es un término suelto', () => {
    // `runProviderAlreadyChosen` sólo puede relajar el bloqueo DENTRO de la
    // conjunción que ya exige capacidad y ruta Lusha. Si apareciera como término
    // de primer nivel unido por `||`, un `requestedProvider` cualquiera montaría
    // el selector por sí solo.
    assert.match(
      summaryCode,
      /\(runProviderAlreadyChosen \|\| \(!isPersistenceBlocked && !isBudgetBlocked\)\)/,
    );
    assert.doesNotMatch(summaryCode, /\|\|\s*runProviderAlreadyChosen\s*;/);
  });

  it('ni el resumen ni el selector leen rol, sesión, flags ni env', () => {
    for (const code of [summaryCode, selectorCode]) {
      assert.doesNotMatch(code, /process\.env/);
      assert.doesNotMatch(code, /\bisAdmin\b/);
      assert.doesNotMatch(code, /ENABLE_[A-Z_]+/);
      assert.doesNotMatch(code, /createClient|supabase/i);
    }
  });

  it('el selector conserva su autocensura por capacidad', () => {
    assert.match(selectorCode, /if \(!capability\.canSelectDiscoveryProvider\) return null;/);
  });
});

describe('HALLAZGO-B — Lusha nunca se ejecuta sola', () => {
  it('el resumen no importa ni llama a la acción de Lusha', () => {
    assert.doesNotMatch(summaryCode, /lusha-pending-review-actions/);
    assert.doesNotMatch(summaryCode, /generateLushaPendingReviewBatchAction/);
    assert.doesNotMatch(summaryCode, /previewLushaCompaniesAction/);
  });

  it('la ruta Lusha sigue teniendo exactamente un punto de montaje, y es declarativo', () => {
    assert.equal([...summaryCode.matchAll(/<WizardLushaFinalSearch/g)].length, 1);
    assert.match(summaryCode, /\{lushaExecutionOffered && lushaCriteria\.input && \(/);
  });

  it('el bloqueo de persistencia también cierra la ruta Lusha', () => {
    assert.match(
      summaryCode,
      /const lushaExecutionOffered = useLushaFinalSearch && !isPersistenceBlocked;/,
    );
  });
});

describe('HALLAZGO-B — el cambio no toca billing, flags ni Agente 2A', () => {
  it('el resumen no reserva créditos ni reimplementa el preflight', () => {
    // La reserva atómica (`try_reserve_wizard_credits`) es server-side y sigue
    // siendo la única autoridad económica: esta pantalla ni la nombra en código.
    assert.doesNotMatch(summaryCode, /try_reserve_wizard_credits/);
    assert.doesNotMatch(summaryCode, /wizard-budget-preflight\.server/);
    // El único cálculo de presupuesto que hace es llamar al núcleo puro de siempre.
    assert.equal(
      [...summaryCode.matchAll(/resolveWizardPreExecutionBudgetBlock\(/g)].length,
      1,
    );
  });

  it('el resumen no conoce el dominio de Agente 2A (contactos / teléfonos)', () => {
    assert.doesNotMatch(summaryCode, /contact-enrichment|phone_reveal|phoneReveal|hubspot/i);
  });
});
