/**
 * Static safety guards — PHONE-3D.1
 *
 * PHONE-3D.1 solo hace scaffolding seguro del futuro Apollo phone reveal:
 * un flag OFF por default y un helper puro de payload. Este hito NO debe
 * activar reveal real en ninguna ruta. Estas pruebas leen el código fuente
 * en disco y verifican los invariantes. Sin red, sin DB, sin proveedores.
 *
 * Invariantes vigilados:
 *  - `reveal_phone_number: true` vive SOLO en apollo-phone-reveal.ts.
 *  - Completion / runner / routing / bulk / Lusha / UI NO envían
 *    `reveal_phone_number: true`.
 *  - `automaticPhoneRevealEnabled` sigue false en guardrails.
 *  - `isLushaPhoneRevealEnabled` sigue hard-off (returns false).
 *  - No existe server action `revealCandidatePhone`, botón "Revelar teléfono",
 *    modal de costo ni migración 095.
 *  - El helper es puro (sin fetch / supabase / env / logs).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { isLushaPhoneRevealEnabled } from '@/lib/feature-flags.server';

const here = dirname(fileURLToPath(import.meta.url));
const toolkitDir = join(here, '..');
// __tests__ → toolkit → agents → server → src → repo root
const repoRoot = join(here, '..', '..', '..', '..', '..');

function readToolkit(relative: string): string {
  return readFileSync(join(toolkitDir, relative), 'utf8');
}
function readRepo(relative: string): string {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

const REVEAL_TRUE = /reveal_phone_number\s*:\s*true/;

// Archivos de runtime sensibles que NUNCA deben activar reveal de teléfono.
const RUNTIME_FILES_WITHOUT_REVEAL_TRUE: readonly string[] = [
  'src/server/agents/contact-enrichment-toolkit/contact-completion-adapter.ts',
  'src/server/agents/contact-enrichment-toolkit/apollo-enrichment-runner.ts',
  'src/server/agents/contact-enrichment-toolkit/apollo-people-adapter.ts',
  'src/server/agents/contact-enrichment-toolkit/contact-enrichment-runner.ts',
  'src/server/agents/contact-enrichment-toolkit/contact-enrichment-routing-orchestrator.ts',
  'src/server/agents/contact-enrichment-toolkit/lusha-enrichment-runner.ts',
  'src/modules/contact-enrichment/bulk-enrichment-runner.ts',
  'src/modules/contact-enrichment/candidate-review-core.ts',
  'src/components/contact-enrichment/contact-candidate-detail-sheet.tsx',
];

describe('PHONE-3D.1 — reveal_phone_number: true está aislado', () => {
  it('el helper apollo-phone-reveal.ts SÍ contiene reveal_phone_number: true', () => {
    const helper = readToolkit('apollo-phone-reveal.ts');
    assert.equal(REVEAL_TRUE.test(helper), true);
  });

  for (const rel of RUNTIME_FILES_WITHOUT_REVEAL_TRUE) {
    it(`${rel} NO envía reveal_phone_number: true`, () => {
      const source = readRepo(rel);
      assert.equal(
        REVEAL_TRUE.test(source),
        false,
        `${rel} no debe activar reveal_phone_number`,
      );
    });
  }
});

describe('PHONE-3D.1 — el helper es puro', () => {
  const helper = readToolkit('apollo-phone-reveal.ts');
  // La pureza se evalúa sobre el CÓDIGO, no sobre los comentarios (que
  // mencionan intencionalmente "fetch", "Supabase", "env" para documentar
  // qué NO se hace). Se eliminan comentarios de bloque y de línea.
  const code = helper
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('sin fetch / axios', () => {
    assert.equal(/\bfetch\s*\(/.test(code), false);
    assert.equal(/\baxios\b/.test(code), false);
  });

  it('sin Supabase', () => {
    assert.equal(/createSupabase|supabase\./i.test(code), false);
  });

  it('sin process.env (no lee flags ni secretos)', () => {
    assert.equal(/process\.env/.test(code), false);
  });

  it('sin logs (console.*)', () => {
    assert.equal(/console\.\w+\s*\(/.test(code), false);
  });

  it('solo importa el tipo MatchPersonParams (import type, sin runtime)', () => {
    const importLines = helper
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line));
    assert.equal(importLines.length, 1, `imports: ${importLines.join(' | ')}`);
    assert.equal(/import\s+type\b/.test(importLines[0]), true);
    assert.equal(/apollo-client/.test(importLines[0]), true);
  });
});

describe('PHONE-3D.1 — flags de reveal siguen apagados', () => {
  it('guardrails de Apollo: automaticPhoneRevealEnabled sigue false', () => {
    const guardrails = readRepo('src/lib/apollo-guardrails.ts');
    assert.equal(/automaticPhoneRevealEnabled\s*:\s*false/.test(guardrails), true);
    assert.equal(/automaticPhoneRevealEnabled\s*:\s*true/.test(guardrails), false);
  });

  it('isLushaPhoneRevealEnabled() sigue hard-off (returns false)', () => {
    assert.equal(isLushaPhoneRevealEnabled(), false);
  });

  it('feature-flags: isLushaPhoneRevealEnabled conserva el tipo de retorno false', () => {
    const flags = readRepo('src/lib/feature-flags.server.ts');
    assert.equal(
      /export function isLushaPhoneRevealEnabled\(\)\s*:\s*false/.test(flags),
      true,
    );
    // El flag nuevo NO debe leer NEXT_PUBLIC (server-only, sin exposición al cliente).
    assert.equal(
      /ENABLE_APOLLO_PHONE_REVEAL/.test(flags),
      true,
      'debe declararse el flag de Apollo phone reveal',
    );
    assert.equal(
      /NEXT_PUBLIC_ENABLE_APOLLO_PHONE_REVEAL/.test(flags),
      false,
      'el flag no debe exponerse como NEXT_PUBLIC',
    );
  });
});

describe('PHONE-3D.1 — no hay superficie de reveal (action/UI/migración)', () => {
  // PHONE-3D.3 introduce legítimamente la server action revealCandidatePhone en
  // los archivos dedicados phone-reveal-actions.ts / phone-reveal-core.ts. La
  // invariante de 3D.1 que sigue vigente es que la acción NO se filtra a módulos
  // no relacionados y sigue detrás del flag (sin UI). Los archivos dedicados de
  // 3D.3 quedan exentos de este chequeo.
  it('revealCandidatePhone solo aparece en los archivos dedicados de 3D.3', () => {
    const modulesDir = join(repoRoot, 'src', 'modules', 'contact-enrichment');
    const DEDICATED_3D3 = new Set(['phone-reveal-actions.ts', 'phone-reveal-core.ts']);
    const files = readdirSync(modulesDir).filter((f) => f.endsWith('.ts'));
    for (const f of files) {
      if (DEDICATED_3D3.has(f)) continue;
      const source = readFileSync(join(modulesDir, f), 'utf8');
      assert.equal(
        /revealCandidatePhone/.test(source),
        false,
        `${f} no debe declarar revealCandidatePhone`,
      );
    }
  });

  it('la UI de detalle no expone reveal_phone_number (aislado a este helper)', () => {
    // NOTA (PHONE-3D.4): el botón "Revelar teléfono" + modal de costo son parte
    // de PHONE-3D.4, no de 3D.1. La invariante que sigue importándole a 3D.1 es
    // que la literal `reveal_phone_number` viva SOLO en este helper y nunca en
    // la UI. La presencia del botón/modal la verifica el guard de 3D.4.
    const detailSheet = readRepo(
      'src/components/contact-enrichment/contact-candidate-detail-sheet.tsx',
    );
    assert.equal(/reveal_phone_number/.test(detailSheet), false);
  });

  // La migración 095 (auditoría de phone reveal) la introduce PHONE-3D.2, no
  // 3D.1. El invariante que le importa a 3D.1 es que ninguna migración active
  // un reveal real: si 095 existe, debe ser puramente aditiva y NO ejecutar
  // reveal (sin `reveal_phone_number`, sin DDL destructiva).
  it('la migración 095 (si existe) no ejecuta reveal ni es destructiva', () => {
    const migrationsDir = join(repoRoot, 'supabase', 'migrations');
    if (!existsSync(migrationsDir)) return; // sin migraciones en disco → nada que activar
    const file = readdirSync(migrationsDir).find((f) => /^095[_-]/.test(f));
    if (!file) return; // 095 aún no creada → nada que verificar
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    assert.equal(
      REVEAL_TRUE.test(sql),
      false,
      'ninguna migración debe activar reveal_phone_number',
    );
    assert.equal(/\bDROP\s+(TABLE|COLUMN)\b/i.test(sql), false);
    assert.equal(/\bDELETE\s+FROM\b/i.test(sql), false);
    assert.equal(/\bTRUNCATE\b/i.test(sql), false);
  });
});

describe('PHONE-3D.1 — completion automático no cambió su contrato', () => {
  const adapter = readToolkit('contact-completion-adapter.ts');

  it('buildMatchParams sigue omitiendo reveal_phone_number', () => {
    // El adapter documenta la ausencia en un comentario; nunca lo activa.
    assert.equal(REVEAL_TRUE.test(adapter), false);
  });

  it('el adapter no importa el helper de reveal (completion no lo usa)', () => {
    assert.equal(/apollo-phone-reveal/.test(adapter), false);
  });
});
