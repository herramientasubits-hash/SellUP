/**
 * Pruebas estáticas de la CADENA de copy de fallo de persistencia.
 *
 * A1-APOLLO-PERSISTENCE-READINESS-4 · § 8.
 *
 * El copy correcto no sirve si la UI no lo pide. Estas pruebas de texto fuente
 * sostienen la cadena completa contra ediciones futuras:
 *
 *   1. la acción del servidor envía `persistenceOutcome`;
 *   2. el wizard cliente lo guarda y lo pasa hacia abajo;
 *   3. el resumen lo transporta;
 *   4. el panel resuelve el texto con el resolutor de PRIORIDAD, no con el de
 *      historial/calidad a secas — que es el que produjo el copy engañoso de
 *      LIVE-QA-2;
 *   5. el panel NO deja el titular de «no encontramos empresas nuevas»
 *      codificado a fuego para el caso de fallo de almacenamiento.
 *
 * Sin DOM, sin red, sin base de datos.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();

const FILES = {
  action: join(
    ROOT,
    'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts',
  ),
  wizard: join(ROOT, 'src/components/prospect-batches/chat-wizard/prospect-chat-wizard.tsx'),
  summary: join(
    ROOT,
    'src/components/prospect-batches/chat-wizard/wizard-conversation-summary.tsx',
  ),
  panels: join(ROOT, 'src/components/prospect-batches/chat-wizard/wizard-execution-panels.tsx'),
  copy: join(ROOT, 'src/modules/prospect-batches/chat-wizard-execution/wizard-result-copy.ts'),
  errorMap: join(
    ROOT,
    'src/components/prospect-batches/chat-wizard/wizard-execution-error-map.ts',
  ),
  types: join(
    ROOT,
    'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-types.ts',
  ),
};

const src = Object.fromEntries(
  Object.entries(FILES).map(([key, path]) => [key, readFileSync(path, 'utf8')]),
) as Record<keyof typeof FILES, string>;

describe('§ 8 — la cadena de copy llega entera desde el servidor', () => {
  it('la acción proyecta persistenceOutcome hacia el cliente', () => {
    assert.match(src.action, /persistenceOutcome/);
    assert.match(src.action, /completed_with_errors/);
  });

  it('el wizard cliente guarda el resultado de persistencia y lo pasa hacia abajo', () => {
    assert.match(src.wizard, /setPersistenceOutcome\(result\.persistenceOutcome\)/);
    assert.match(src.wizard, /persistenceOutcome=\{persistenceOutcome\}/);
  });

  it('el resumen sólo transporta la prop', () => {
    assert.match(src.summary, /persistenceOutcome=\{persistenceOutcome\}/);
  });
});

describe('§ 8 — el panel usa el resolutor de PRIORIDAD', () => {
  it('importa y llama a resolveWizardResultCopy', () => {
    assert.match(src.panels, /resolveWizardResultCopy/);
  });

  it('ya NO llama directamente al resolutor de historial/calidad', () => {
    // Llamarlo directamente es lo que hacía imposible que el fallo de
    // almacenamiento ganara: ese resolutor no conoce la persistencia.
    assert.doesNotMatch(src.panels, /resolveNoNewCandidatesCopy\(/);
  });

  it('el titular de «no encontramos empresas nuevas» ya no está fijado a fuego', () => {
    assert.match(src.panels, /resultCopy\.heading/);
  });

  it('el panel de fallo de almacenamiento no ofrece reeditar y relanzar', () => {
    // El copy pide explícitamente NO repetir la búsqueda; poner el botón a un
    // clic contradiría el texto.
    const block = src.panels.slice(
      src.panels.indexOf("status === 'completed_with_errors'"),
      src.panels.indexOf("status === 'no_new_candidates'"),
    );
    assert.ok(block.length > 0, 'debe existir la rama de completed_with_errors');
    assert.doesNotMatch(block, /onEditSearch/);
  });
});

// ── A1-APOLLO-PERSISTENCE-READINESS-4-FIX § 1, § 2 y § 3 ──────────────────────
//
// El otro extremo de la cadena: el FALLO. El copy del writer llegaba entero, pero
// el del preflight se perdía en `mapExecutionError`, que descarta el resultado
// estructurado y sustituye el `retryable` del servidor por un literal de tabla.

describe('§ 1 — el wizard resuelve PERSISTENCE_NOT_READY por su vía estructurada', () => {
  it('el cliente NO manda el código al mapa estático a secas', () => {
    assert.match(src.wizard, /result\.code === 'PERSISTENCE_NOT_READY'/);
    assert.match(src.wizard, /mapPersistenceNotReady\(/);
  });

  it('le pasa el motivo del servidor Y el retryable del servidor', () => {
    // Ambos argumentos importan: sin el primero los dos motivos dirían lo mismo;
    // sin el segundo la UI impondría su propia reintentabilidad.
    assert.match(
      src.wizard,
      /mapPersistenceNotReady\(result\.persistenceNotReady,\s*result\.retryable\)/,
    );
  });
});

describe('§ 1 — la pantalla no ofrece relanzar de inmediato', () => {
  it('el gate de «Generar prospectos» conoce el bloqueo de persistencia', () => {
    assert.match(src.summary, /isPersistenceBlocked/);
    assert.match(src.summary, /executionError\?\.code === 'PERSISTENCE_NOT_READY'/);
  });

  it('el botón de generación y el selector de proveedor comparten ese gate', () => {
    // Un selector visible junto a un botón ausente sugeriría que se puede elegir
    // con qué reintentar algo que no se puede reintentar.
    //
    // Se afirman las DOS conjunciones concretas en vez de contar apariciones del
    // token: un contador se rompe en cuanto un comentario menciona el nombre, y
    // eso lo vuelve una prueba sobre la prosa en vez de sobre el gate.
    assert.match(
      src.summary,
      /executionEnabled && !isPersistenceBlocked && \(\s*<Button/,
      'el botón «Generar prospectos» debe estar gateado por !isPersistenceBlocked',
    );
    assert.match(
      src.summary,
      /!isPersistenceBlocked &&\s*\n\s*onRequestedProviderChange !== undefined/,
      'el selector de proveedor debe estar gateado por !isPersistenceBlocked',
    );
  });

  it('el gate NO rompe la conjunción que fija el guardrail STRICT-ALL de Lusha', () => {
    // `prospect-wizard-route-static.test.ts` fija literalmente esta conjunción.
    // Insertar el nuevo gate en medio la partía; va después a propósito.
    assert.match(
      src.summary,
      /!useLushaFinalSearch && !isLushaBlocked && executionEnabled/,
    );
  });
});

describe('§ 3 — el mapa de errores no puede volver a olvidar un código', () => {
  it('el catálogo de códigos server-side es una tupla enumerable compartida', () => {
    assert.match(src.types, /export const WIZARD_EXECUTION_FAILURE_CODES = \[/);
    assert.match(src.types, /'PERSISTENCE_NOT_READY',/);
    assert.match(
      src.types,
      /export type WizardExecutionFailureCode = \(typeof WIZARD_EXECUTION_FAILURE_CODES\)\[number\]/,
    );
  });

  it('el mapa se tipa contra ese catálogo, no contra `string`', () => {
    // `Record<WizardExecutionFailureCode, …>` es lo que hace que un código nuevo
    // sin copy no compile. Con `Record<string, …>` compilaba y fallaba en runtime
    // mostrando el mensaje genérico.
    assert.match(src.errorMap, /Record<WizardExecutionFailureCode, ExecutionErrorPresentation>/);
    assert.match(src.errorMap, /PERSISTENCE_NOT_READY:\s*\{/);
  });

  it('el copy del preflight no reutiliza el texto genérico de fallo', () => {
    const generic = 'No fue posible completar la generación de prospectos.';
    const persistenceCopy = src.errorMap.slice(
      src.errorMap.indexOf('PERSISTENCE_NOT_READY_LEAD ='),
      src.errorMap.indexOf('PERSISTENCE_NOT_READY_REASON_MESSAGES'),
    );
    assert.ok(persistenceCopy.length > 0);
    assert.ok(!persistenceCopy.includes(generic));
  });
});

describe('§ 8 — el núcleo de copy no importa nada con efectos', () => {
  it('el resolutor es puro: sin React, sin Supabase, sin env', () => {
    assert.doesNotMatch(src.copy, /from 'react'/);
    assert.doesNotMatch(src.copy, /process\.env/);
    assert.doesNotMatch(src.copy, /supabase/i);
    assert.doesNotMatch(src.copy, /'use client'/);
  });

  it('el texto de fallo no contiene el código técnico ni el error del motor', () => {
    assert.doesNotMatch(src.copy, /schema cache/);
    assert.doesNotMatch(src.copy, /PGRST/);
  });
});
