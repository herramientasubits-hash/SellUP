/**
 * Static safety guards — PHONE-3A
 *
 * Asegura que el hito NO introdujo activación de phone reveal ni banderas
 * peligrosas en los archivos tocados. Lee el código fuente en disco y hace
 * asserts de contenido. Sin red, sin DB, sin proveedores.
 *
 * Invariantes vigilados:
 *  - No `reveal_phone_number: true`.
 *  - No cambio de `automaticPhoneRevealEnabled` (sigue false en guardrails).
 *  - No cambio de `phone_reveal_enabled` de Lusha (sigue false).
 *  - El módulo de clasificación es puro (sin fetch / supabase / imports de red).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const toolkitDir = join(here, '..');

function readSource(relative: string): string {
  return readFileSync(join(toolkitDir, relative), 'utf8');
}

describe('PHONE-3A — static safety guards', () => {
  const phoneClassification = readSource('phone-classification.ts');
  const contactNormalizer = readSource('contact-normalizer.ts');

  it('phone-classification.ts no envía reveal_phone_number: true', () => {
    assert.equal(/reveal_phone_number\s*:\s*true/.test(phoneClassification), false);
    assert.equal(/reveal_phone_number/.test(phoneClassification), false);
  });

  it('contact-normalizer.ts no envía reveal_phone_number: true', () => {
    assert.equal(/reveal_phone_number\s*:\s*true/.test(contactNormalizer), false);
    assert.equal(/reveal_phone_number/.test(contactNormalizer), false);
  });

  it('los archivos tocados no modifican automaticPhoneRevealEnabled', () => {
    assert.equal(/automaticPhoneRevealEnabled\s*[:=]/.test(phoneClassification), false);
    assert.equal(/automaticPhoneRevealEnabled\s*[:=]/.test(contactNormalizer), false);
  });

  it('los archivos tocados no tocan phone_reveal_enabled (Lusha)', () => {
    assert.equal(/phone_reveal_enabled/.test(phoneClassification), false);
    assert.equal(/phone_reveal_enabled/.test(contactNormalizer), false);
  });

  it('phone-classification.ts es puro: sin fetch / supabase / axios / imports de red', () => {
    // Sin llamadas de red ni clientes reales (se ignoran menciones en comentarios).
    assert.equal(/\bfetch\s*\(/.test(phoneClassification), false);
    assert.equal(/\baxios\b/.test(phoneClassification), false);
    // Sin imports: el módulo no debe traer clientes de proveedores ni Supabase.
    const importLines = phoneClassification
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line));
    assert.equal(importLines.length, 0, `no debe importar nada, encontró: ${importLines.join(' | ')}`);
    assert.equal(/createSupabase|supabase\./i.test(phoneClassification), false);
  });

  it('guardrails de Apollo siguen con automaticPhoneRevealEnabled = false', () => {
    const guardrails = readFileSync(
      join(toolkitDir, '..', '..', '..', 'lib', 'apollo-guardrails.ts'),
      'utf8',
    );
    assert.equal(/automaticPhoneRevealEnabled\s*:\s*false/.test(guardrails), true);
    assert.equal(/automaticPhoneRevealEnabled\s*:\s*true/.test(guardrails), false);
  });
});
