/**
 * Agente 2A — RATCHETS ESTÁTICOS del re-chequeo transaccional provider-native
 * (AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4-R1)
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE, Y NO SÓLO EL DE PostgreSQL
 * ═══════════════════════════════════════════════════════════════════
 *
 * La prueba de VERDAD de este hito corre contra PostgreSQL real
 * (`provider-native-inflight-race-postgres-p0-identity-4-r1.test.ts` y
 * `provider-native-suppression-postgres-p0-identity-4.test.ts`): sólo dos conexiones
 * compitiendo por el mismo lock demuestran una carrera. Desde R2 esas dos suites SÍ
 * corren dentro del check obligatorio, con la cadena real de migraciones y con el arnés
 * en modo fail-closed, así que este archivo ya NO es el último recurso.
 *
 * Lo que sigue aportando es distinto y más barato: afirmaciones sobre el TEXTO de la 120
 * —qué firma tiene el helper, que no gane un parámetro de cuenta, que la identidad se
 * resuelva con la misma precedencia en los dos caminos—. Eso son invariantes de diseño
 * que PostgreSQL no puede comprobar, porque una migración con la firma «equivocada»
 * aplica igual de bien.
 *
 * ⚠️ LO QUE ESTE ARCHIVO NO PRUEBA (y antes de R2 se afirmaba que sí):
 *
 * `scanQuoteState` NO es un parser de PostgreSQL y NO demuestra que una migración sea
 * aplicable. Mide PARIDAD de comillas en todo el archivo, nada más. El defecto real que
 * este hito sufrió —un apóstrofo sin escapar dentro de un `COMMENT ON TABLE`, que hacía
 * fallar la 120 entera con SQLSTATE 42601— deja la paridad INTACTA, porque las comillas
 * posteriores del archivo la reequilibran. Reinyectado ese defecto exacto, esta suite
 * pasa 20/20 y la suite de PostgreSQL real falla. La detección de SQL inaplicable vive
 * allí; aquí queda una heurística estrecha que sólo caza el caso en que la paridad SÍ se
 * rompe.
 *
 * No abren PostgreSQL, no llaman a ningún proveedor, no leen ningún flag y no tocan
 * Producción.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');

const M113 = '113_phone_reveal_person_suppression_recheck.sql';
const M120 = '120_provider_native_phone_suppression.sql';

const read = (file: string) => readFileSync(join(migrationsDir, file), 'utf8');

const APOLLO_FN = 'persist_candidate_apollo_phone_reveal_result';
const LUSHA_FN = 'persist_candidate_lusha_phone_reveal_result';
const CANDIDATE_HELPER = 'phone_reveal_candidate_suppression_exists';

/**
 * Extrae la definición completa de una función, delimitada por SU PROPIA etiqueta de
 * dollar-quote. Buscar un `END $$;` fijo sería un error silencioso: los helpers de este
 * hito se citan con `$fn$`, así que la búsqueda se pasaría de largo hasta el final de
 * OTRA función y el ratchet afirmaría cosas sobre un texto que no es el suyo.
 */
function functionBody(sql: string, fn: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert.notEqual(start, -1, `definición ausente: ${fn}`);
  const tagMatch = /\bAS (\$[A-Za-z_]*\$)/.exec(sql.slice(start));
  assert.ok(tagMatch, `${fn}: no se localizó la etiqueta de dollar-quote`);
  const tag = tagMatch[1];
  const bodyStart = start + (tagMatch.index ?? 0) + tagMatch[0].length;
  const close = sql.indexOf(tag, bodyStart);
  assert.notEqual(close, -1, `${fn}: dollar-quote sin cerrar`);
  return sql.slice(start, close + tag.length);
}

/**
 * El mismo texto SIN comentarios de línea. Las afirmaciones del tipo "esto no puede
 * aparecer" tienen que mirar CÓDIGO: la propia migración explica en prosa qué NO hace
 * —nombra `privacy_subjects` para declararlo Fase 2, y nombra el validador de Apollo para
 * contar de dónde se lo quitó—, y un grep ingenuo leería esas explicaciones como si
 * fueran la implementación.
 */
const codeOnly = (sql: string) => sql.replace(/--[^\n]*/g, '');

/**
 * Heurística de PARIDAD de comillas: normal / literal de comilla simple / dollar-quote /
 * comentario. NO es un parser de PostgreSQL y NO prueba que una migración aplique.
 *
 * ALCANCE EXACTO, porque la diferencia importa: detecta el caso en que un apóstrofo de
 * más deja el archivo con las comillas DESBALANCEADAS. No detecta el caso —el que este
 * hito sufrió de verdad— en que el apóstrofo de más cierra el literal antes de tiempo
 * pero las comillas posteriores del archivo vuelven a cuadrar la paridad: ahí el SQL
 * resultante es basura sintáctica (42601) y esta función devuelve `ok`. Probado: con ese
 * defecto reinyectado en la 120, esta suite pasa entera.
 *
 * Se conserva porque es gratis y corre sobre las 120 migraciones del repo, no porque
 * pruebe aplicabilidad. Quien necesite esa garantía tiene que mirar las suites de
 * PostgreSQL real, que desde R2 son parte del check obligatorio.
 */
function scanQuoteState(sql: string): { ok: boolean; detail: string } {
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    }
    if (two === '/*') {
      const close = sql.indexOf('*/', i + 2);
      if (close === -1) return { ok: false, detail: 'comentario de bloque sin cerrar' };
      i = close + 2;
      continue;
    }
    const ch = sql[i];
    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        if (close === -1) {
          return { ok: false, detail: `dollar-quote ${tag[0]} sin cerrar` };
        }
        i = close + tag[0].length;
        continue;
      }
    }
    if (ch === "'") {
      let j = i + 1;
      for (;;) {
        const q = sql.indexOf("'", j);
        if (q === -1) {
          const line = sql.slice(0, i).split('\n').length;
          return { ok: false, detail: `literal sin cerrar que abre en la línea ${line}` };
        }
        if (sql[q + 1] === "'") {
          j = q + 2;
          continue;
        }
        i = q + 1;
        break;
      }
      continue;
    }
    i += 1;
  }
  return { ok: true, detail: '' };
}

describe('P0-IDENTITY-4-R1 — ratchets estáticos del re-chequeo transaccional', () => {
  // ═══════════════════════════════════════════════════════════════
  // 0. La migración tiene que poder APLICAR
  // ═══════════════════════════════════════════════════════════════

  it('la 120 tiene la paridad de comillas equilibrada', () => {
    const state = scanQuoteState(read(M120));
    // «Paridad equilibrada» NO es «aplica»: eso lo dice PostgreSQL, en las suites reales.
    assert.equal(state.ok, true, `paridad de comillas rota en la 120: ${state.detail}`);
  });

  it('NINGUNA migración del repo tiene la paridad de comillas rota', () => {
    const broken: string[] = [];
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
      const state = scanQuoteState(read(file));
      if (!state.ok) broken.push(`${file}: ${state.detail}`);
    }
    assert.deepEqual(broken, [], `migraciones con paridad rota:\n${broken.join('\n')}`);
  });

  it('la heurística caza el desbalance… y NO caza el 42601 con paridad intacta', () => {
    // Caso que SÍ caza: el apóstrofo de más deja la paridad impar.
    const withStrayQuote = "COMMENT ON TABLE t IS 'see this migration's header';";
    assert.equal(scanQuoteState(withStrayQuote).ok, false);
    const escaped = "COMMENT ON TABLE t IS 'see this migration''s header';";
    assert.equal(scanQuoteState(escaped).ok, true);

    // Caso que NO caza — y no es hipotético: es EL defecto que este hito sufrió. Se
    // reinyecta sobre el archivo REAL desescapando el apóstrofo de `migration''s`, que es
    // exactamente la diferencia entre el head previo (donde la 120 fallaba con 42601) y
    // el actual. El fixture se DERIVA del archivo para que no pueda degenerar en un caso
    // artificial: si el ancla desaparece, el test lo dice en vez de pasar por inercia.
    const ANCHOR_ESCAPED = "migration''s header for the exact table";
    const ANCHOR_BROKEN = "migration's header for the exact table";
    const original = read(M120);
    // Se tolera que el archivo YA esté desescapado. Esto importa: durante un control
    // negativo se inyecta ese defecto a propósito, y este ratchet tiene que seguir
    // afirmando la CEGUERA —no convertirse en un detector accidental que confunda la
    // lectura del experimento—. Su única tesis es «la heurística dice ok en los dos casos».
    const reinjected = original.includes(ANCHOR_ESCAPED)
      ? original.replace(ANCHOR_ESCAPED, ANCHOR_BROKEN)
      : original;
    assert.ok(
      reinjected.includes(ANCHOR_BROKEN),
      'el ancla del defecto conocido ya no está en la 120: actualiza este ratchet',
    );
    assert.equal(
      scanQuoteState(reinjected).ok,
      true,
      'si esto pasa a false, la heurística mejoró de verdad: actualiza el encabezado, ' +
        'que hoy declara justo esta ceguera',
    );
    // Y la contraparte, que es el punto entero de R2: PostgreSQL SÍ lo caza. Esa
    // afirmación no se puede hacer aquí, y por eso
    // `provider-native-suppression-postgres-p0-identity-4.test.ts` es obligatoria.
  });

  // ═══════════════════════════════════════════════════════════════
  // 1. El helper canónico existe y NO depende de la cuenta
  // ═══════════════════════════════════════════════════════════════

  it('la 120 define el helper canónico con candidato + pista de payload, y nada más', () => {
    const sql = read(M120);
    assert.match(
      sql,
      new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${CANDIDATE_HELPER}\\(\\s*\\n\\s*p_candidate_id\\s+uuid,`,
      ),
      'el primer parámetro tiene que ser el candidato',
    );
    assert.match(sql, /p_payload_provider_person_id text DEFAULT NULL/);
  });

  it('el helper NO acepta ninguna cuenta: "sin cuenta" no puede volver a ser "sin privacidad"', () => {
    const helper = functionBody(read(M120), CANDIDATE_HELPER);
    const signature = helper.slice(0, helper.indexOf('RETURNS boolean'));
    assert.equal(
      /account/i.test(signature),
      false,
      'un parámetro de cuenta en la firma reintroduce el defecto que la Fase 1 cierra',
    );
  });

  it('el helper NO tiene manejador de excepciones: un fallo de lectura nunca es "clear"', () => {
    const helper = functionBody(read(M120), CANDIDATE_HELPER);
    assert.equal(
      /\bEXCEPTION\b\s+WHEN/i.test(helper),
      false,
      'un WHEN OTHERS aquí convertiría "no pude leer" en "no está suprimido"',
    );
    // Y un candidato ilegible LEVANTA en vez de devolver false.
    assert.match(helper, /RAISE EXCEPTION/);
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. Los dos proveedores, cada uno en SU espacio de nombres
  // ═══════════════════════════════════════════════════════════════

  it('el helper consulta Lusha en su propio espacio, sin traducir el id a Apollo', () => {
    const helper = functionBody(read(M120), CANDIDATE_HELPER);
    assert.match(helper, /provider_suppression_exists\('lusha', v_lusha_id\)/);
    // La identidad de Lusha se toma TAL CUAL, sólo recortada.
    assert.match(helper, /v_lusha_id := btrim\(v_source_contact_id\)/);
    // Y nunca pasa por el validador de Apollo. Se comprueba sobre el TRAMO de Lusha en
    // lugar de con una expresión regular sobre todo el cuerpo: el validador SÍ aparece
    // —tres veces, en el COALESCE de Apollo— y una afirmación global no podría distinguir
    // el uso legítimo del que este ratchet prohíbe.
    const code = codeOnly(helper);
    const lushaBranch = code.slice(
      code.indexOf("= 'lusha'"),
      code.indexOf('provider_suppression_exists(\'lusha\''),
    );
    assert.ok(lushaBranch.length > 0, 'no se localizó el tramo de Lusha');
    assert.equal(
      lushaBranch.includes('phone_reveal_normalized_apollo_person_id'),
      false,
      'un id de Lusha traducido por el validador de Apollo es el acoplamiento que R1 rompe',
    );
    // El validador sólo se usa donde debe: las tres identidades de Apollo.
    assert.equal(
      (code.match(/phone_reveal_normalized_apollo_person_id/g) ?? []).length,
      3,
      'payload + columna del candidato + source_contact_id de origen Apollo, y nada más',
    );
  });

  it('la identidad de Lusha sólo se resuelve cuando el candidato es de origen Lusha', () => {
    const helper = functionBody(read(M120), CANDIDATE_HELPER);
    assert.match(helper, /lower\(btrim\(COALESCE\(v_source, ''\)\)\) = 'lusha'/);
  });

  it('el helper NO cruza identidades: nada de email, nombre, LinkedIn, dominio o teléfono', () => {
    const helper = codeOnly(functionBody(read(M120), CANDIDATE_HELPER));
    for (const forbidden of ['email', 'linkedin', 'full_name', 'domain', 'phone_number']) {
      assert.equal(
        new RegExp(forbidden, 'i').test(helper),
        false,
        `${forbidden} no puede participar en una decisión de identidad (eso es Fase 2)`,
      );
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. Las dos RPC finales usan el helper, y ya no derivan identidad
  // ═══════════════════════════════════════════════════════════════

  for (const fn of [APOLLO_FN, LUSHA_FN]) {
    it(`${fn} llama al helper canónico exactamente una vez`, () => {
      const body = functionBody(read(M120), fn);
      const calls = body.match(new RegExp(`public\\.${CANDIDATE_HELPER}\\(`, 'g')) ?? [];
      assert.equal(calls.length, 1, 'una sola decisión de supresión por transacción');
    });

    it(`${fn} ya NO deriva la identidad con reglas de Apollo en su propio cuerpo`, () => {
      const body = codeOnly(functionBody(read(M120), fn));
      assert.equal(
        /phone_reveal_normalized_apollo_person_id/.test(body),
        false,
        'la derivación vive en el helper: dos copias es como se produjo la divergencia',
      );
      assert.equal(/v_person_id|v_account_id/.test(body), false);
    });

    it(`${fn} conserva el veredicto 'suppressed' con el mismo sobre`, () => {
      const body = functionBody(read(M120), fn);
      assert.match(body, /'status',\s+'suppressed'/);
      assert.match(body, /'candidate_terminalized',\s+false/);
    });
  }

  it('la RPC de LUSHA no menciona Apollo en su camino de supresión', () => {
    const body = functionBody(read(M120), LUSHA_FN);
    const step2b = body.slice(
      body.indexOf('Step 2b'),
      body.indexOf('Step 3 — tombstones'),
    );
    assert.ok(step2b.length > 0, 'no se localizó el Step 2b de Lusha');
    assert.match(step2b, new RegExp(`${CANDIDATE_HELPER}\\(p_candidate_id, NULL\\)`));
  });

  it('la RPC de APOLLO sí pasa el id que su payload confirma', () => {
    const body = functionBody(read(M120), APOLLO_FN);
    assert.match(
      body,
      new RegExp(`${CANDIDATE_HELPER}\\(p_candidate_id, p_apollo_person_id\\)`),
    );
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. EL ratchet fuerte: el restatement NO cambió nada más
  // ═══════════════════════════════════════════════════════════════

  it('todo lo que sigue al veredicto de supresión es VERBATIM de la 113, en las dos', () => {
    const sql113 = read(M113);
    const sql120 = read(M120);
    for (const fn of [APOLLO_FN, LUSHA_FN]) {
      const original = functionBody(sql113, fn);
      const restated = functionBody(sql120, fn);
      const marker = "      'status',                   'suppressed',";
      const oIdx = original.indexOf(marker);
      const rIdx = restated.indexOf(marker);
      assert.notEqual(oIdx, -1, `${fn}: marcador ausente en la 113`);
      assert.notEqual(rIdx, -1, `${fn}: marcador ausente en la 120`);
      assert.equal(
        restated.slice(rIdx),
        original.slice(oIdx),
        `${fn}: el restatement cambió algo DESPUÉS del veredicto de supresión. La única ` +
          'diferencia autorizada por R1 es el Step 2b.',
      );
    }
  });

  it('las firmas de las dos RPC son IDÉNTICAS a las de la 113: ningún llamador cambia', () => {
    const sql113 = read(M113);
    const sql120 = read(M120);
    for (const fn of [APOLLO_FN, LUSHA_FN]) {
      const sig = (sql: string) => {
        const body = functionBody(sql, fn);
        return body
          .slice(0, body.indexOf('RETURNS jsonb'))
          // Los comentarios de los parámetros no son parte de la firma.
          .replace(/--[^\n]*/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      };
      assert.equal(sig(sql120), sig(sql113), `${fn}: la firma cambió`);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. La Fase 2 sigue ausente
  // ═══════════════════════════════════════════════════════════════

  it('la 120 no introduce sujeto de privacidad global ni alias entre proveedores', () => {
    const sql = codeOnly(read(M120));
    for (const forbidden of ['privacy_subjects', 'subject_aliases', 'linkedin_hash']) {
      assert.equal(
        sql.includes(forbidden),
        false,
        `${forbidden} es Fase 2 y no está autorizada`,
      );
    }
  });
});
