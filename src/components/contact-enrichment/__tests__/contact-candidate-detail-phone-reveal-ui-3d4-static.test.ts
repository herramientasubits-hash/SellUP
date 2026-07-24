/**
 * Static safety guards — PHONE-3D.4 (Apollo phone reveal UI modal)
 *
 * PHONE-3D.4 agrega SOLO la UI de reveal en el detalle del candidato: botón,
 * modal de confirmación de costo, selector de base de tratamiento y llamada al
 * server action `revealCandidatePhoneAction` (PHONE-3D.3). Este test lee el
 * código fuente en disco y verifica que la UI:
 *   - INTRODUCE el botón + modal + copy de costo + selector de base (presencia).
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

describe('PHONE-3D.4 — presencia de la UI de reveal', () => {
  it('agrega el botón "Revelar teléfono" y el modal con su título', () => {
    assert.ok(/Revelar teléfono/.test(detailSheet));
    assert.ok(detailSheet.includes('Revelar teléfono del candidato'));
  });

  it('muestra el costo "hasta … créditos" (tope 8) con constante, no mágico', () => {
    assert.ok(/PHONE_REVEAL_MAX_CREDITS\s*=\s*8/.test(detailSheet));
    assert.ok(/hasta \{PHONE_REVEAL_MAX_CREDITS\} créditos/.test(detailSheet));
    // El botón de confirmar repite el tope de créditos.
    assert.ok(/hasta \$\{PHONE_REVEAL_MAX_CREDITS\} créditos/.test(detailSheet));
  });

  it('incluye el vocabulario aprobado de base de tratamiento', () => {
    for (const label of [
      'Interés legítimo B2B',
      'Consentimiento obtenido',
      'Relación comercial existente',
      'Contacto solicitado por cliente',
      'Otra base aprobada',
    ]) {
      assert.ok(detailSheet.includes(label), `falta label: ${label}`);
    }
    for (const value of [
      'legitimate_interest_b2b',
      'consent_obtained',
      'existing_business_relationship',
      'customer_requested_contact',
      'other_approved_basis',
    ]) {
      assert.ok(detailSheet.includes(value), `falta value: ${value}`);
    }
  });

  it('exige nota (textarea) para other_approved_basis', () => {
    assert.ok(detailSheet.includes('Justificación de la base aprobada'));
    assert.ok(/phoneRevealBasis === 'other_approved_basis'/.test(detailSheet));
  });

  it('llama al server action revealCandidatePhoneAction', () => {
    assert.ok(
      detailSheet.includes(
        "import { revealCandidatePhoneAction } from '@/modules/contact-enrichment/phone-reveal-actions'",
      ),
    );
    assert.ok(/revealCandidatePhoneAction\(\{/.test(detailSheet));
  });
});

describe('PHONE-3D.4 — contrato de la llamada al action (sin PII)', () => {
  const block = revealActionCallBlock(detailSheet);

  it('envía candidateId + confirmCost + expectedMaxCredits + base (+ nota condicional)', () => {
    assert.ok(block.includes('candidateId: candidate.id'));
    assert.ok(block.includes('confirmCost: true'));
    assert.ok(block.includes('expectedMaxCredits: PHONE_REVEAL_MAX_CREDITS'));
    assert.ok(block.includes('phoneProcessingBasis: phoneRevealBasis'));
    assert.ok(block.includes('phoneProcessingBasisNote'));
  });

  it('NO envía teléfono, email, linkedin, nombre ni payload crudo', () => {
    assert.equal(/\bemail\b/.test(block), false);
    assert.equal(/linkedin/i.test(block), false);
    assert.equal(/\bphone\b/.test(block), false);
    assert.equal(/first_name|last_name|full_name|\bname\b/.test(block), false);
    assert.equal(/payload|raw_data|apollo/i.test(block), false);
  });
});

describe('PHONE-3D.4 — invariantes de privacidad / seguridad', () => {
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
