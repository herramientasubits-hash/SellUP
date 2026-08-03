/**
 * Static safety guards — Apollo phone reveal UI one-click (APOLLO-PHONE-ASYNC-5)
 *
 * Producto eliminó el modal de confirmación/base legal: el botón "Revelar
 * teléfono" ahora solicita la revelación asíncrona en UN clic con base fija.
 * Este test lee el código fuente en disco y verifica que la UI:
 *   - CONSERVA el botón "Revelar teléfono" y el copy de costo (tope 8 créditos).
 *   - Llama directamente al server action `revealCandidatePhoneAction` con base
 *     fija `legitimate_interest_b2b`, confirmCost=true y expectedMaxCredits=8.
 *   - ELIMINA el modal y todo su vocabulario (selector de base, botón "Solicitar
 *     revelación", "Consentimiento obtenido", etc.).
 *   - NO activa el flag ni lo lee desde el cliente (sin process.env, sin
 *     NEXT_PUBLIC_*).
 *   - NO imprime teléfonos ni payloads (sin console.*).
 *   - NO expone `reveal_phone_number` (vive solo en el helper 3D.1) ni llama
 *     proveedores reales / fetch desde el componente.
 *   - NO permite bulk, NO toca Lusha / completion automático / runner /
 *     provider_usage_logs / run viewer / history / migraciones.
 *
 * Sin red, sin DB, sin proveedores: es un test de lectura de archivos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const componentsDir = join(here, '..');
// __tests__ → contact-enrichment → components → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');

function readComponent(relative: string): string {
  return readFileSync(join(componentsDir, relative), 'utf8');
}
function readRepo(relative: string): string {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

/**
 * Elimina comentarios para que los guards negativos vigilen CÓDIGO, no prosa.
 * (La documentación describe deliberadamente las invariantes — "no lee
 * process.env", "no revelar teléfonos" — y no debe disparar falsos positivos.)
 * Conserva `https://` al exigir que `//` no venga precedido de `:`.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // bloques /* ... */ y JSDoc
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // línea // ... (no toca ://)
}

const detailSheet = readComponent('contact-candidate-detail-sheet.tsx');
const dataTable = readComponent('contact-candidates-data-table-client.tsx');
const panel = readComponent('contact-candidates-panel.tsx');

// Versiones sin comentarios para los guards negativos.
const detailSheetCode = stripComments(detailSheet);
const dataTableCode = stripComments(dataTable);
const panelCode = stripComments(panel);

/** Argumento literal pasado a revealCandidatePhoneAction({ ... }). */
function revealActionCallBlock(source: string): string {
  const match = source.match(/revealCandidatePhoneAction\(\{([\s\S]*?)\}\)/);
  return match ? match[1] : '';
}

/** Handler onClick del botón "Revelar teléfono" (código sin comentarios). */
function revealButtonBlock(source: string): string {
  // Buscamos el <Button ...> cuyo children incluye "Revelar teléfono".
  //
  // La ventana hacia atrás cubre el bloque COMPLETO del botón: `disabled`, el
  // `onClick` condicional y el ternario del spinner. Se amplió de 600 a 1600 en
  // AGENT2A-PHONE-WATERFALL-2, cuando el bloque creció (comentario del botón único +
  // la condición de la ruta legacy) y el `onClick` dejó de caber en 600. La
  // invariante que se verifica NO cambió: solo la heurística de extracción.
  const idx = source.indexOf('Revelar teléfono');
  if (idx === -1) return '';
  return source.slice(Math.max(0, idx - 1600), idx + 200);
}

describe('ASYNC-5 — presencia del botón one-click (sin modal)', () => {
  it('conserva el botón "Revelar teléfono"', () => {
    assert.ok(/Revelar teléfono/.test(detailSheet));
  });

  it('sin waterfall el botón dispara la revelación directamente (one-click, sin modal)', () => {
    const block = revealButtonBlock(detailSheetCode);
    // AGENT2A-PHONE-WATERFALL-1: el onClick pasó a ser condicional. La invariante
    // ASYNC-5 no cambió — con `ENABLE_PHONE_REVEAL_WATERFALL` apagado
    // (`waterfallActive === false`, el default de producción) el botón sigue
    // llamando a handlePhoneReveal sin diálogo intermedio. Lo que se verifica aquí
    // es exactamente esa rama; la rama del waterfall abre su modal ÚNICO y está
    // cubierta por contact-candidate-detail-phone-waterfall-ui.test.tsx.
    assert.ok(
      /onClick=\{[\s\S]*waterfallActive[\s\S]*\}/.test(block),
      'el onClick debe estar gobernado por waterfallActive',
    );
    assert.ok(
      /:\s*\(\)\s*=>\s*handlePhoneReveal\(\)/.test(block),
      'la rama sin waterfall debe llamar handlePhoneReveal directamente',
    );
    assert.ok(
      /\?\s*\(\)\s*=>\s*setShowWaterfallConfirm\(true\)/.test(block),
      'la rama con waterfall debe abrir el modal único, no revelar directo',
    );
  });

  it('define una base legal FIJA legitimate_interest_b2b', () => {
    assert.ok(
      /PHONE_REVEAL_PROCESSING_BASIS\s*:\s*PhoneProcessingBasis\s*=\s*'legitimate_interest_b2b'/.test(
        detailSheet,
      ),
    );
  });

  it('muestra el costo "hasta … créditos" (tope 8) con constante, no mágico', () => {
    assert.ok(/PHONE_REVEAL_MAX_CREDITS\s*=\s*8/.test(detailSheet));
    assert.ok(detailSheet.includes('Consulta individual con Apollo'));
    assert.ok(detailSheet.includes('{PHONE_REVEAL_MAX_CREDITS} créditos'));
  });

  it('conserva el microcopy no bloqueante de base aplicada', () => {
    assert.ok(detailSheet.includes('Base aplicada: interés legítimo B2B.'));
  });
});

describe('ASYNC-5 — el modal y su vocabulario fueron eliminados', () => {
  it('no queda el título del modal ni el botón "Solicitar revelación"', () => {
    assert.equal(/Revelar teléfono del candidato/.test(detailSheetCode), false);
    assert.equal(/Solicitar revelación/.test(detailSheetCode), false);
  });

  it('no queda el label "Base de tratamiento" ni el selector de opciones', () => {
    assert.equal(/Base de tratamiento/.test(detailSheetCode), false);
    assert.equal(/PHONE_PROCESSING_BASIS_OPTIONS/.test(detailSheetCode), false);
    assert.equal(/phone-reveal-basis/.test(detailSheetCode), false);
    assert.equal(/showPhoneRevealDialog/.test(detailSheetCode), false);
  });

  it('no quedan las otras bases seleccionables del viejo modal', () => {
    for (const label of [
      'Consentimiento obtenido',
      'Relación comercial existente',
      'Contacto solicitado por cliente',
      'Otra base aprobada',
      'Justificación de la base aprobada',
    ]) {
      assert.equal(detailSheetCode.includes(label), false, `no debe quedar: ${label}`);
    }
  });
});

describe('ASYNC-5 — contrato de la llamada al action (sin PII)', () => {
  const block = revealActionCallBlock(detailSheet);

  it('envía candidateId + confirmCost + expectedMaxCredits + base fija', () => {
    assert.ok(block.includes('candidateId: candidate.id'));
    assert.ok(block.includes('confirmCost: true'));
    assert.ok(block.includes('expectedMaxCredits'));
    // AGENT2A-PHONE-WATERFALL-1: el tope pasó a ser un parámetro de
    // handlePhoneReveal para que el waterfall pueda enviar 13. El DEFAULT sigue
    // siendo PHONE_REVEAL_MAX_CREDITS (8), así que la ruta Apollo-only conserva
    // exactamente el tope de ASYNC-5.
    assert.ok(
      /handlePhoneReveal\(\s*expectedMaxCredits:\s*number\s*=\s*PHONE_REVEAL_MAX_CREDITS\s*\)/.test(
        detailSheet,
      ),
      'el tope por defecto debe seguir siendo PHONE_REVEAL_MAX_CREDITS',
    );
    assert.ok(block.includes('phoneProcessingBasis: PHONE_REVEAL_PROCESSING_BASIS'));
    // Base fija: la nota se manda explícitamente como undefined.
    assert.ok(block.includes('phoneProcessingBasisNote: undefined'));
  });

  it('NO envía teléfono, email, linkedin, nombre ni payload crudo', () => {
    assert.equal(/\bemail\b/.test(block), false);
    assert.equal(/linkedin/i.test(block), false);
    assert.equal(/\bphone\b/.test(block), false);
    assert.equal(/first_name|last_name|full_name|\bname\b/.test(block), false);
    assert.equal(/payload|raw_data|apollo/i.test(block), false);
  });
});

describe('ASYNC-5 — invariantes de privacidad / seguridad', () => {
  it('no lee el flag desde el cliente: sin process.env ni NEXT_PUBLIC_*', () => {
    for (const [name, src] of [
      ['detailSheet', detailSheetCode],
      ['dataTable', dataTableCode],
    ] as const) {
      assert.equal(/process\.env/.test(src), false, `${name} usa process.env`);
    }
    for (const src of [detailSheetCode, dataTableCode, panelCode]) {
      assert.equal(/NEXT_PUBLIC_ENABLE_APOLLO_PHONE_REVEAL/.test(src), false);
      assert.equal(/NEXT_PUBLIC_[A-Z_]*PHONE_REVEAL/.test(src), false);
    }
  });

  it('no imprime nada por consola (ni teléfono ni payload)', () => {
    assert.equal(/console\.(log|info|debug|warn|error)\s*\(/.test(detailSheetCode), false);
  });

  it('no expone reveal_phone_number (vive solo en el helper 3D.1)', () => {
    assert.equal(/reveal_phone_number/.test(detailSheetCode), false);
    const helper = readRepo(
      'src/server/agents/contact-enrichment-toolkit/apollo-phone-reveal.ts',
    );
    assert.ok(/reveal_phone_number/.test(helper));
  });

  it('no llama proveedores reales ni hace fetch desde el componente', () => {
    assert.equal(/\bfetch\s*\(/.test(detailSheetCode), false);
    assert.equal(/\baxios\b/.test(detailSheetCode), false);
    assert.equal(/from\s+['"]@\/server\/services\/(apollo|lusha)/i.test(detailSheetCode), false);
    assert.equal(/from\s+['"]@\/server\/integrations\/apollo/i.test(detailSheetCode), false);
  });

  it('no toca completion automático, runner, Lusha ni sus flags', () => {
    assert.equal(/automaticPhoneRevealEnabled/.test(detailSheetCode), false);
    assert.equal(/isLushaPhoneRevealEnabled/.test(detailSheetCode), false);
    assert.equal(/isApolloPhoneRevealEnabled/.test(detailSheetCode), false);
  });

  it('no permite bulk reveal (acción individual por candidato)', () => {
    assert.equal(/candidateIds|bulkReveal|revealMany|revealAll/i.test(detailSheetCode), false);
    assert.ok(revealActionCallBlock(detailSheet).includes('candidateId: candidate.id'));
  });

  it('no toca provider_usage_logs ni escribe SQL/migraciones desde la UI', () => {
    for (const src of [detailSheetCode, dataTableCode, panelCode]) {
      assert.equal(/provider_usage_logs/.test(src), false);
      assert.equal(/ALTER TABLE|CREATE TABLE|apply_migration/i.test(src), false);
    }
  });

  it('no modifica el run viewer / history para mostrar teléfonos revelados', () => {
    const runViewer = stripComments(readComponent('contact-enrichment-run-viewer.tsx'));
    const runHistory = stripComments(readComponent('account-agents-run-history.tsx'));
    for (const src of [runViewer, runHistory]) {
      assert.equal(/revealCandidatePhoneAction/.test(src), false);
      assert.equal(/Revelar tel[eé]fono/i.test(src), false);
    }
  });
});
