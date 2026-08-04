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
