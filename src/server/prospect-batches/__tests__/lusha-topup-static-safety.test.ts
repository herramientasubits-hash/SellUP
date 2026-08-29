/**
 * Q3F-5BB.7B — static safety guards.
 *
 * Greps the Lusha pending-review writer + action + wizard sources to LOCK the
 * hard boundaries of this milestone: no migrations, no account/company/HubSpot
 * writes, no enrichment, no provider_usage_logs / agent_runs writes, and the
 * top-up guardrails (max 2 pages, max 2 credits) are constants — not client input.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../../..', 'src');

const WRITER = resolve(SRC, 'server/prospect-batches/lusha-pending-review.ts');
const ACTION = resolve(SRC, 'modules/prospect-batches/lusha-pending-review-actions.ts');
const WIZARD = resolve(SRC, 'components/prospect-batches/chat-wizard/wizard-lusha-final-search.tsx');
/**
 * AGENT1-LOCAL-CUT9A § 4 — el reserve-or-return del lote canónico.
 *
 * 🔴 La escritura de `prospect_batches` salió de la acción y vive aquí. Entra en
 * el conjunto MEDIDO porque, si no, esta guarda pasaría a verde justamente por
 * haber perdido de vista la escritura que dice vigilar.
 */
const CANONICAL_BATCH = resolve(SRC, 'server/prospect-batches/lusha-canonical-batch.ts');
const PREVIEW = resolve(SRC, 'server/prospect-batches/lusha-preview.ts');
// AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1 § 6 — los topes se EXTRAJERON del
// writer a su propio módulo (mismos nombres, mismos valores) porque el ejecutor
// multi-rama los necesita sin cerrar un ciclo de inicialización con el writer.
// Esta guarda los busca donde ahora VIVEN, y sigue comprobando que el bucle del
// writer se acota con la constante y no con un valor de la respuesta.
const LIMITS = resolve(SRC, 'server/prospect-batches/lusha-pending-review-limits.ts');
const EXECUTION = resolve(SRC, 'server/prospect-batches/lusha-multibranch-execution.ts');

const read = (p: string) => readFileSync(p, 'utf8');

/** Strip block + line comments so forbidden-pattern checks target real CODE only
 *  (doc comments legitimately name the tables/APIs this milestone must NOT touch). */
function readCode(p: string): string {
  return read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (leave URLs' `://` intact)
}

describe('Q3F-5BB.7B static safety', () => {
  it('37/38. page + credit ceilings are hard constants (not client-supplied)', () => {
    const limits = read(LIMITS);
    assert.match(limits, /LUSHA_PENDING_REVIEW_MAX_PAGES\s*=\s*2/);
    assert.match(limits, /LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS\s*=\s*2/);
    assert.match(limits, /LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES\s*=\s*5/);
    // The loop is bounded by the constant, not by any request/response value.
    assert.match(read(WRITER), /page\s*<\s*LUSHA_PENDING_REVIEW_MAX_PAGES/);
    // Preview clamps the page — deep pagination is impossible.
    assert.match(read(PREVIEW), /LUSHA_PREVIEW_MAX_PAGE\s*=\s*1/);
  });

  it('el techo de peticiones de la corrida se DERIVA, no se escribe a mano', () => {
    // § 6 — ramas × páginas. Un número literal aquí sería un techo que puede
    // dejar de coincidir con el que se reserva.
    const execution = readCode(EXECUTION);
    assert.match(
      execution,
      /safeBranchCount \* LUSHA_PENDING_REVIEW_MAX_PAGES/,
      'el techo de peticiones debe salir de ramas × páginas',
    );
    assert.match(
      execution,
      /LUSHA_MACRO_SEARCH_PLAN_MAX_BRANCHES \*\s*LUSHA_PENDING_REVIEW_MAX_PAGES \*\s*LUSHA_PREVIEW_SIZE/,
      'el techo de filas crudas debe salir de ramas × páginas × tamaño de página',
    );
  });

  it('32. writer never creates accounts / companies / contacts', () => {
    const w = readCode(WRITER);
    assert.doesNotMatch(w, /\.from\(\s*['"](accounts|companies|contacts)['"]\s*\)/);
    assert.doesNotMatch(w, /insertAccount|createAccount|createCompany|createContact/i);
  });

  it('33. writer + action never call HubSpot WRITE endpoints', () => {
    for (const p of [WRITER, ACTION]) {
      const s = readCode(p);
      assert.doesNotMatch(s, /createHubSpot|updateHubSpot|syncHubSpot|hubspot.*create|hubspot.*write/i);
      // POST to HubSpot objects is forbidden.
      assert.doesNotMatch(s, /\/crm\/v3\/objects/i);
    }
  });

  it('34. writer + action never import enrichment / people search', () => {
    for (const p of [WRITER, ACTION]) {
      const s = readCode(p);
      assert.doesNotMatch(s, /companies\/enrich|contact-enrich|people.*search|enrichCompany|enrichContact/i);
    }
  });

  /**
   * 35/36 — RATCHET INVERTIDO, no aflojado.
   *
   * AGENT1-LUSHA-PROVIDER-USAGE-OBSERVABILITY-1 ensancha la frontera de escritura
   * por EXACTAMENTE una tabla existente: `provider_usage_logs`, y sólo desde la
   * ACCIÓN. Lo que la guarda original protegía sigue protegido, y de hecho queda
   * MÁS estrecho que antes:
   *
   *   · el WRITER puro conserva la prohibición COMPLETA — la fila de uso necesita
   *     el desenlace de la liquidación, que el núcleo puro no conoce y no debe
   *     conocer;
   *   · `agent_runs` / `agent_run_steps` siguen PROHIBIDOS en los dos (§ 15). Esa
   *     mitad de la guarda no se toca;
   *   · la acción sigue sin poder tocar la tabla POR SU CUENTA: un `.from()`
   *     suelto está prohibido igual, así que el acceso sólo puede pasar por el
   *     seam canónico revisado;
   *   · y se añade lo que antes no existía: la acción DEBE usar ese seam. Una
   *     prohibición que se levanta sin exigir por dónde pasa el sustituto deja la
   *     puerta abierta a un segundo mecanismo improvisado.
   */
  it('35/36. el WRITER puro sigue sin poder registrar uso, y nadie escribe agent_runs', () => {
    const writer = readCode(WRITER);
    assert.doesNotMatch(writer, /\.from\(\s*['"]provider_usage_logs['"]\s*\)/);
    assert.doesNotMatch(writer, /logProviderUsage|insertProviderUsage|recordLushaRunProviderUsage/i);

    // § 15 — la frontera de `agent_runs` NO se ensancha en ninguno de los dos.
    for (const p of [WRITER, ACTION]) {
      const s = readCode(p);
      assert.doesNotMatch(s, /\.from\(\s*['"]agent_runs['"]\s*\)/);
      assert.doesNotMatch(s, /\.from\(\s*['"]agent_run_steps['"]\s*\)/);
      assert.doesNotMatch(s, /recordAgentRun|insertAgentRun|createAgentRun/i);
    }
  });

  it('35/36b. la acción registra uso SÓLO por el seam canónico, nunca por su cuenta', () => {
    const action = readCode(ACTION);
    // Acceso directo a la tabla: sigue prohibido.
    assert.doesNotMatch(action, /\.from\(\s*['"]provider_usage_logs['"]\s*\)/);
    assert.doesNotMatch(action, /logProviderUsage|insertProviderUsage/i);
    // Y el seam autorizado es OBLIGATORIO: la observabilidad no puede volver a
    // ser un mecanismo improvisado dentro de la acción.
    assert.match(
      action,
      /from '@\/server\/prospect-batches\/lusha-provider-usage-recorder'/,
      'la acción debe registrar uso por el recolector canónico',
    );
    assert.match(action, /recordLushaRunProviderUsage/);
  });

  it('writer only writes prospect_batches + prospect_candidates (via injected deps)', () => {
    const a = readCode(ACTION);
    const canonical = readCode(CANONICAL_BATCH);
    // CUT9A — el lote se escribe en el reserve-or-return; los candidatos, en la acción.
    assert.match(canonical, /\.from\('prospect_batches'\)[\s\S]*?\.insert\(/);
    assert.match(a, /\.from\('prospect_candidates'\)[\s\S]*?\.insert\(/);
    // No other .insert/.update/.delete/.upsert against a different table —
    // medido sobre la superficie de persistencia ENTERA.
    for (const source of [a, canonical]) {
      const forbidden = source.match(/\.from\('(?!prospect_batches|prospect_candidates)[^']+'\)\s*[\s\S]{0,80}?\.(insert|update|delete|upsert)\(/g);
      assert.equal(forbidden, null);
    }
    // 🔴 Y el lote se escribe UNA sola vez en toda la superficie: si la acción
    // recuperara su propio INSERT, volverían los dos creadores independientes.
    assert.equal(
      /\.from\('prospect_batches'\)\s*[\s\S]{0,80}?\.insert\(/.test(a),
      false,
      'la acción de Lusha recuperó una escritura de lote propia',
    );
  });

  it('31. no migration files were added in this milestone', () => {
    // The writer/action/wizard/preview diff must not ship SQL migrations.
    const migrationsDir = resolve(SRC, '..', 'supabase', 'migrations');
    let files: string[] = [];
    try {
      files = readdirSync(migrationsDir);
    } catch {
      files = [];
    }
    // Guard: none of the changed sources reference a new migration number.
    for (const p of [WRITER, ACTION, WIZARD]) {
      assert.doesNotMatch(read(p), /migration 09[6-9]|migration 1\d\d/i);
    }
    // The migrations dir is only read here to prove we didn't add one referencing 5BB.7B.
    assert.equal(files.some((f) => /5bb7b|topup|duplicate_details/i.test(f)), false);
  });

  // AGENT1-LUSHA-PRECLICK-UX-CONSISTENCY-FIX-1 § P0 — ratchet INVERTIDO en sus dos
  // primeras aserciones de forma.
  //
  // «N páginas de Lusha / N resultados por página» describía el ejecutor de UNA
  // rama, y era cierto cuando se escribió. Con el ejecutor Macro-v2 el techo
  // depende del plan de la macro industria (2, 4 o 6 peticiones), así que una
  // cifra de forma escrita en la UI sólo puede divergir del runtime: ahora se
  // exige su AUSENCIA. La base de facturación —lo único que no depende del
  // plan— se sigue exigiendo igual.
  it('wizard pre-search notice is non-contractual: billing basis, no fixed-credit promise, no stale shape (Q3F-5BB.10A)', () => {
    const w = read(WIZARD);
    // The old fixed-credit promise is gone.
    assert.doesNotMatch(w, /hasta 2 créditos/);
    assert.doesNotMatch(w, /máx 2 créditos/);
    // The stale single-branch shape figures are gone too.
    assert.doesNotMatch(w, /páginas de Lusha/i);
    assert.doesNotMatch(w, /resultados por página/i);
    // The billing basis stays stated.
    assert.match(w, /plan configurado para la macroindustria/i);
    assert.match(w, /sin signals/i);
    assert.match(w, /facturable según tu plan de Lusha/i);
    assert.match(w, /costo real/i);
  });
});
