/**
 * legacy-cross-provider-lusha-wiring-static.test.ts
 * (Agente 2A · AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1)
 *
 * Guardas ESTÁTICAS sobre el cableado. Las propiedades que fijan no se pueden escribir
 * con dobles, porque tratan de QUÉ decide el borde de I/O — y ese borde es justo el
 * lugar donde un doble diría que sí a todo:
 *
 *   * la vía de PAGO está atada al mismo gate que la resolución de identidad, así que
 *     con `ENABLE_PHONE_REVEAL_WATERFALL` apagado (y la migración 124 sin aplicar) no
 *     se lee `contact_provider_identities`, no se reserva ningún crédito de búsqueda y
 *     el código queda presente e INERTE;
 *   * el disparo manual `legacy_lusha_only` la tiene DESACTIVADA de forma explícita: su
 *     UI enseña 5, su autorización reserva UNA pata de teléfono, y heredar la vía de
 *     pago le dejaría gastar un crédito que el operador nunca vio;
 *   * no se añade ninguna migración: la modalidad nueva reutiliza el `operation_key` de
 *     la 124 y el RPC ya es genérico sobre las patas.
 *
 * Lee CÓDIGO, no prosa: los comentarios se eliminan antes de mirar, para que describir
 * una invariante no pueda hacerse pasar por implementarla.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = join(here, '..');
const repoRoot = join(here, '..', '..', '..', '..');

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readModule(relative: string): string {
  return stripComments(readFileSync(join(moduleDir, relative), 'utf8'));
}

const deps = readModule('phone-reveal-waterfall-deps.ts');
const engine = readModule('legacy-lusha-only-reveal-engine.ts');
const core = readModule('phone-reveal-waterfall-core.ts');

describe('cableado — la vía de pago se enciende con el MISMO gate que la resolución', () => {
  it('`identitySearchAllowed` cae por defecto en `isPhoneRevealWaterfallEnabled()`', () => {
    assert.ok(
      /identitySearchAllowed\s*=\s*\n?\s*options\?\.identitySearchAllowed\s*\?\?\s*isPhoneRevealWaterfallEnabled\(\)/.test(
        deps,
      ),
      deps.slice(deps.indexOf('identitySearchAllowed'), deps.indexOf('identitySearchAllowed') + 400),
    );
  });

  it('los hechos de identidad se leen SÓLO cuando esa misma decisión lo permite', () => {
    // Si se leyeran siempre, un entorno sin la migración 124 rompería la ruta legacy
    // entera — y la evidencia legacy es lo primero que se carga.
    assert.ok(
      /loadLegacyEvidenceForWaterfall\(candidateId,\s*\{\s*includeIdentityFacts:\s*identitySearchAllowed,?\s*\}\)/.test(
        deps,
      ),
    );
  });

  it('el disparo manual la DESACTIVA explícitamente', () => {
    assert.ok(/identitySearchAllowed:\s*false/.test(deps));
    // Y el motor manual sigue sin pasar ningún techo aceptado: su modalidad es la de 5.
    assert.equal(/acceptedMaxCredits/.test(engine), false);
  });

  it('el core no puede comprar la búsqueda sin permiso explícito', () => {
    // El default del core es `false`: `identitySearchAuthorized: options?... === true`.
    assert.ok(
      /identitySearchAuthorized:\s*options\?\.identitySearchAuthorized\s*===\s*true/.test(core),
    );
  });
});

describe('techo humano — el arranque legacy compara ANTES de tocar el presupuesto', () => {
  it('el corte por techo aparece antes de la reserva en el orden del archivo', () => {
    const ceilingAt = core.indexOf("reason: 'authorization_ceiling_mismatch'");
    const reserveAt = core.indexOf('legacyLushaOnly: true');
    assert.ok(ceilingAt > 0, 'el rechazo por techo tiene que existir en la ruta legacy');
    assert.ok(reserveAt > 0, 'la reserva legacy tiene que resolver su modalidad');
    assert.ok(
      ceilingAt < reserveAt,
      'comparar después de reservar seguiría siendo un gasto por encima de lo autorizado',
    );
  });

  it('el suelo legacy NO se deriva del suelo del waterfall completo', () => {
    assert.ok(
      /export function normalizeLegacyPhoneRevealAcceptedMaxCredits[\s\S]{0,400}PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS/.test(
        core,
      ),
    );
  });
});

describe('sin migración nueva: la modalidad reutiliza el esquema de la 124', () => {
  it('`operation_key` ya admite `contact_search`, así que no hace falta tocar el CHECK', () => {
    const m124 = readFileSync(
      join(repoRoot, 'supabase', 'migrations', '124_cross_provider_phone_identity.sql'),
      'utf8',
    );
    assert.ok(/operation_key/.test(m124));
    assert.ok(/'phone_reveal',\s*'contact_search'/.test(m124));
  });

  it('ninguna migración menciona la modalidad nueva: es vocabulario de APLICACIÓN', () => {
    // El `run_mode` que se escribe sigue siendo `legacy_lusha_only` —la 103 no cambia—
    // y lo único que varía es cuántas patas reserva su preflight. Si alguien tuviera
    // que nombrar la modalidad en SQL, significaría que el esquema sí cambió, y eso es
    // una decisión que hay que tomar explícitamente, no arrastrar en un diff.
    const dir = join(repoRoot, 'supabase', 'migrations');
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(join(dir, name), 'utf8');
      assert.equal(
        sql.includes('legacy_lusha_with_identity_search'),
        false,
        name,
      );
    }
  });

  it('el RPC atómico es genérico sobre las patas: no enumera modalidades', () => {
    const m124 = readFileSync(
      join(repoRoot, 'supabase', 'migrations', '124_cross_provider_phone_identity.sql'),
      'utf8',
    );
    // Itera `p_legs` y agrupa por pozo; no hay ninguna rama por modalidad que haya que
    // ampliar para que dos patas de Lusha se reserven juntas.
    assert.ok(/jsonb_array_elements\(p_legs\)/.test(m124));
    assert.equal(/full_waterfall|legacy_lusha_only/.test(m124), false);
  });
});
