/**
 * Static safety guards — PHONE-3B
 *
 * PHONE-3B es SOLO UI/typing/tests: visualiza el tipo/fuente de teléfono que
 * PHONE-3A conservó. Este test lee el código fuente en disco y verifica que el
 * hito NO introdujo activación de phone reveal, ni banderas peligrosas, ni un
 * botón de "Revelar teléfono". Sin red, sin DB, sin proveedores.
 *
 * Invariantes vigilados en `contact-candidate-detail-sheet.tsx`:
 *  - No `reveal_phone_number` (mucho menos `: true`).
 *  - No toca `automaticPhoneRevealEnabled`.
 *  - No toca `isLushaPhoneRevealEnabled` ni `phone_reveal_enabled`.
 *  - No agrega botón "Revelar teléfono".
 *  - No introduce confirmación de costo de teléfono.
 *  - No llama a proveedores reales (Apollo/Lusha) ni hace fetch.
 *  - No modifica el run viewer / history para mostrar teléfono.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const componentsDir = join(here, '..');

function readSource(relative: string): string {
  return readFileSync(join(componentsDir, relative), 'utf8');
}

describe('PHONE-3B — static safety guards', () => {
  const detailSheet = readSource('contact-candidate-detail-sheet.tsx');

  it('no envía ni menciona reveal_phone_number', () => {
    assert.equal(/reveal_phone_number\s*:\s*true/.test(detailSheet), false);
    assert.equal(/reveal_phone_number/.test(detailSheet), false);
  });

  it('no toca automaticPhoneRevealEnabled', () => {
    assert.equal(/automaticPhoneRevealEnabled/.test(detailSheet), false);
  });

  it('no toca isLushaPhoneRevealEnabled ni phone_reveal_enabled', () => {
    assert.equal(/isLushaPhoneRevealEnabled/.test(detailSheet), false);
    assert.equal(/phone_reveal_enabled/.test(detailSheet), false);
  });

  it('no agrega un botón "Revelar teléfono"', () => {
    assert.equal(/revelar\s+tel[eé]fono/i.test(detailSheet), false);
    // Tampoco un verbo de reveal genérico en botones/labels visibles.
    assert.equal(/reveal\s*phone/i.test(detailSheet), false);
  });

  it('no introduce confirmación de costo de teléfono en este hito', () => {
    assert.equal(/confirmar\s+costo/i.test(detailSheet), false);
    assert.equal(/confirmPhoneCost/i.test(detailSheet), false);
  });

  it('no llama a proveedores reales ni hace fetch desde el componente', () => {
    assert.equal(/\bfetch\s*\(/.test(detailSheet), false);
    assert.equal(/\baxios\b/.test(detailSheet), false);
    // No importa clientes de Apollo/Lusha ni servicios de proveedor.
    assert.equal(/from\s+['"]@\/server\/services\/(apollo|lusha)/i.test(detailSheet), false);
  });

  it('conserva el vocabulario de tipo/fuente conocido (contrato con PHONE-3A)', () => {
    // Labels prudentes clave presentes.
    assert.ok(detailSheet.includes('Móvil / posible personal'));
    assert.ok(detailSheet.includes('Tipo desconocido'));
    assert.ok(detailSheet.includes('Apollo búsqueda'));
    // Copy prudente: nunca afirma personal garantizado/confirmado.
    assert.equal(/personal\s+garantizado/i.test(detailSheet), false);
    assert.equal(/personal\s+confirmado/i.test(detailSheet), false);
  });

  it('no modifica el run viewer / history para mostrar teléfono', () => {
    const runViewer = readSource('contact-enrichment-run-viewer.tsx');
    const runHistory = readSource('account-agents-run-history.tsx');
    // Ninguno de los dos debe introducir metadata de teléfono nueva.
    assert.equal(/enrichment_metadata(\?)?\.phone\b/.test(runViewer), false);
    assert.equal(/enrichment_metadata(\?)?\.phone\b/.test(runHistory), false);
  });
});
