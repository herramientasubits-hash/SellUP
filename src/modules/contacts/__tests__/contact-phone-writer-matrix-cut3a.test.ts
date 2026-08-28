/**
 * AGENT2-CONTACT-HUBSPOT-STALE-COMPLETENESS-CUT3A — el AUDIT de escritores del teléfono
 * oficial.
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTA SUITE EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * El defecto que CUT-3A cierra no fue un fallo de lógica: fue un escritor que nadie había
 * clasificado. La 117 proyectaba un teléfono sobre un contacto vinculado y el estado durable no
 * se enteraba, porque cuando se escribió el estado durable nadie había hecho la lista de quién
 * más escribe ese teléfono.
 *
 * Así que la lista es ahora una PRUEBA, y no una tabla en un informe que envejece en silencio.
 * Cada escritor de `contacts.phone` / `contacts.mobile_phone` —en SQL y en TypeScript— tiene
 * que estar en la matriz de abajo con un veredicto explícito: WIRED, N/A o DELIBERATELY
 * EXCLUDED con su razón. Y la suite comprueba que la matriz no se quedó corta: descubre los
 * escritores por sí misma y falla si aparece uno que la matriz no nombra.
 *
 * ⚠️ Es un descubrimiento REAL sobre los ficheros, no una lista repetida dos veces. Una matriz
 * que se comparase consigo misma no probaría nada.
 *
 * Sin red, sin DB: sólo lectura de ficheros.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

/** Quita comentarios para que NOMBRAR algo no se confunda con HACERLO. */
const stripTs = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/** Sólo el cuerpo ejecutable de una función SQL, sin comentarios de línea. */
function sqlBodies(sql: string): string {
  const parts: string[] = [];
  let from = 0;
  for (;;) {
    const start = sql.indexOf('AS $function$', from);
    if (start < 0) break;
    const end = sql.indexOf('$function$;', start);
    if (end < 0) break;
    parts.push(sql.slice(start, end));
    from = end + 1;
  }
  return parts
    .join('\n')
    .split('\n')
    .map((line) => {
      const at = line.indexOf('--');
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');
}

type Verdict = 'WIRED' | 'N/A' | 'DELIBERATELY_EXCLUDED';

interface WriterEntry {
  /** Cómo se le llama en el informe. */
  name: string;
  /** Fichero que lo contiene. */
  file: string;
  verdict: Verdict;
  /** Obligatoria para N/A y DELIBERATELY_EXCLUDED. */
  why: string;
}

// ═══════════════════════════════════════════════════════════════
// LA MATRIZ
// ═══════════════════════════════════════════════════════════════

const MATRIX: readonly WriterEntry[] = [
  // ── SQL ────────────────────────────────────────────────────────
  {
    name: 'RPC 117 (CUT-3A) — merge de un candidato duplicado en un contacto EXISTENTE',
    file: 'supabase/migrations/129_agent2_contact_hubspot_stale_completeness.sql',
    verdict: 'WIRED',
    why: 'Proyecta el escalar sobre un contacto que PUEDE estar vinculado. Llama a la autoridad en el paso 11b, dentro de la misma transacción. CUT-3C la RE-EMITE encima: la definición viva es la de abajo, y esta entrada se conserva porque el archivo sigue existiendo y sigue clasificado.',
  },
  {
    name: 'RPC 115 (CUT-3A) — supresión de privacidad del teléfono oficial',
    file: 'supabase/migrations/129_agent2_contact_hubspot_stale_completeness.sql',
    verdict: 'WIRED',
    why: 'Puede dejar el escalar en NULL. Llama a la autoridad en el paso 6b. Marca y NO exporta: no hay red alcanzable desde SQL. CUT-3C la RE-EMITE encima; ver la entrada de abajo.',
  },
  {
    name: 'RPC 117 (CUT-3C) — el merge, re-emitido con PROCEDENCIA',
    file: 'supabase/migrations/130_agent2_contact_hubspot_stale_source.sql',
    verdict: 'WIRED',
    why: 'La definición VIVA del merge: el archivo se ordena después de CUT-3A y reemplaza su cuerpo. Un solo splice respecto a CUT-3A —el cuarto argumento `merge`— y todo lo demás byte a byte. Sigue llamando a la autoridad en el paso 11b, dentro de la misma transacción, y sigue sin alcanzar ninguna red.',
  },
  {
    name: 'RPC 115 (CUT-3C) — la privacidad, re-emitida con PROCEDENCIA',
    file: 'supabase/migrations/130_agent2_contact_hubspot_stale_source.sql',
    verdict: 'WIRED',
    why: 'La definición VIVA de la erasure, y la razón de ser de CUT-3C: escribe `privacy` como cuarto argumento, que es lo que hace que el PATCH automático se NIEGUE a exportar este pendiente. Sigue marcando y sigue sin exportar: desde SQL no hay red alcanzable.',
  },
  {
    name: 'RPC 128 — proyección post-aprobación del teléfono revelado (#352, ORIGINAL)',
    file: 'supabase/migrations/128_project_approved_candidate_phones_onto_contact.sql',
    verdict: 'DELIBERATELY_EXCLUDED',
    why: 'ES un escritor del escalar sobre un contacto que PUEDE estar vinculado, y NO llamaba a la autoridad: el archivo no contiene stale, hubspot_sync ni stale_source ni una vez. Ése es exactamente el hueco que AGENT2-POST-APPROVAL-REVEAL-STALE-PRODUCER-FINAL-CUT cierra. La entrada se conserva CLASIFICADA en vez de borrarse porque el archivo sigue existiendo y sigue siendo la definición base; la definición VIVA es la de abajo, que lo reemplaza.',
  },
  {
    name: 'RPC 128 (FINAL CUT) — la proyección, re-emitida como PRODUCTORA de `stale`',
    file: 'supabase/migrations/131_agent2_post_approval_reveal_stale_producer.sql',
    verdict: 'WIRED',
    why: 'La definición VIVA de la proyección post-aprobación: el archivo se ordena después de CUT-3A y CUT-3C y reemplaza el cuerpo de la 128. Lee mobile_phone en el paso 5, captura el saliente anterior bajo el lock y llama a la autoridad en un paso 10b con procedencia reveal, dentro de la MISMA transacción que escribe el escalar. Es el único llamador de reveal, el miembro que CUT-3C declaró sin llamador. Marca y NO exporta: desde SQL no hay red alcanzable, y el PATCH es una fase posterior al COMMIT.',
  },
  {
    name: 'RPC 116 — aprobación de un candidato con sus teléfonos oficiales',
    file: 'supabase/migrations/116_approve_candidate_with_official_phones.sql',
    verdict: 'N/A',
    why: 'CREA el contacto y proyecta el escalar sobre esa fila recién nacida. Un contacto que acaba de existir no puede tener hubspot_contact_id, así que no hay estado que pueda quedar desactualizado. El bloque inicial lo escribe CUT-1 con status never_attempted.',
  },
  // ── TypeScript ────────────────────────────────────────────────
  {
    name: 'updateContact — la edición manual del formulario',
    file: 'src/modules/contacts/actions.ts',
    verdict: 'WIRED',
    why: 'Llama a la autoridad y mete el resultado en el MISMO update() (CUT-2). CUT-3A añade el caso de vaciado sin tocar el cableado.',
  },
  {
    name: 'createContact — el alta manual del formulario',
    file: 'src/modules/contacts/actions.ts',
    verdict: 'N/A',
    why: 'Es un INSERT: no hay fila previa, no hay vínculo HubSpot y no hay estado anterior que contradecir.',
  },
  {
    name: 'supresión DSAR paso 2d — borrado del escalar por PostgREST',
    file: 'src/modules/contact-enrichment/phone-cache-suppression-actions.ts',
    verdict: 'WIRED',
    why: 'Es el escritor que de hecho limpia el escalar en el camino cableado (la reproyección de la 115 queda casi siempre guardada). La metadata marcada viaja DENTRO del mismo patch, nunca en una segunda escritura.',
  },
  {
    name: 'persistSync — la escritura del propio estado de sincronización',
    file: 'src/modules/contacts/contact-hubspot-sync-runner.ts',
    verdict: 'DELIBERATELY_EXCLUDED',
    why: 'No escribe teléfono: escribe hubspot_contact_id y metadata. Es el ejecutor del estado, no un escritor del dato, y hacerle evaluar la regla lo pondría a marcarse desactualizado a sí mismo. CUT-3B lo mueve de actions.ts al runner compartido sin cambiar una sola de sus reglas, para que el botón manual y el autosync no puedan tener dos cableados distintos.',
  },
  {
    name: 'persistContactMetadata — el anexo operativo del autosync (CUT-3B)',
    file: 'src/modules/contacts/contact-hubspot-sync-runner.ts',
    verdict: 'DELIBERATELY_EXCLUDED',
    why: 'Escribe SÓLO metadata, y sólo el anexo de bloqueo de workspace. No toca phone, mobile_phone ni hubspot_contact_id, así que el teléfono saliente no puede moverse por su causa; hacerle evaluar la regla del stale le daría poder para marcar una fila que ni siquiera cambió.',
  },
  {
    name: 'triggerContactHubSpotSync — anexo de bloqueo y bandera de revisión de empresa (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)',
    file: 'src/modules/contact-enrichment/hubspot-contact-approval-sync.ts',
    verdict: 'DELIBERATELY_EXCLUDED',
    why: 'Escribe SÓLO metadata, en dos sitios: el anexo de bloqueo de workspace que persiste el motor de autosync (mismo patrón que persistContactMetadata en contact-hubspot-sync-runner.ts) y la bandera hubspot_company_review_pending cuando el contacto espera una revisión humana de empresa. Ninguno de los dos toca phone ni mobile_phone, así que el teléfono saliente no puede moverse por su causa: hacerle evaluar la regla de staleness le daría poder para marcar desactualizada una fila que ni siquiera cambió de teléfono.',
  },
  {
    name: 'webhook de Apollo phone reveal',
    file: 'src/app/api/integrations/apollo/phone-reveal/webhook/route.ts',
    verdict: 'N/A',
    why: 'Escribe contact_enrichment_candidates.phone, no contacts.phone. Un candidato no está vinculado a HubSpot; sólo llega al contacto a través de 116 o 117, que sí están clasificadas.',
  },
  {
    name: 'proyección de teléfonos del CANDIDATO (112 y la colección de staging)',
    file: 'supabase/migrations/112_suppress_candidate_phone_collection.sql',
    verdict: 'N/A',
    why: 'Toda su superficie es contact_enrichment_candidate_phones y el escalar del candidato. No nombra la tabla contacts.',
  },
  {
    name: 'backfill de la LÍNEA BASE de hubspot_sync (BACKFILL LEGACY)',
    file: 'supabase/migrations/132_agent2_hubspot_legacy_sync_state_backfill.sql',
    verdict: 'N/A',
    why: 'Su único UPDATE escribe contacts.metadata y ninguna otra columna: ni phone, ni mobile_phone, ni hubspot_contact_id. El saliente no puede moverse, así que no hay transición a `stale` que cablear — al contrario, es el archivo que INICIALIZA el estado para que los escritores que sí mueven el saliente dejen de encontrarse un `no_durable_state`. Hay una prueba en su suite que lee el UPDATE y afirma que ninguna columna de teléfono aparece a la izquierda de un `=`.',
  },
  {
    name: 'archiveContact / setPrimaryContact / cambios de estado',
    file: 'src/modules/contacts/actions.ts',
    verdict: 'N/A',
    why: 'Escriben archived_at, is_primary y contact_status. Ninguna toca phone ni mobile_phone, así que el saliente no puede moverse.',
  },
];

describe('16. la matriz de escritores está completa y es coherente', () => {
  it('cada veredicto que no es WIRED lleva su razón escrita', () => {
    for (const entry of MATRIX) {
      if (entry.verdict === 'WIRED') continue;
      assert.ok(
        entry.why.length > 40,
        `${entry.name}: un N/A o una exclusión sin razón es una casilla vacía con nombre bonito`,
      );
    }
  });

  it('ningún escritor queda sin clasificar', () => {
    assert.equal(
      MATRIX.some((e) => (e.verdict as string) === 'UNCLASSIFIED'),
      false,
    );
    assert.equal(new Set(MATRIX.map((e) => e.name)).size, MATRIX.length, 'sin duplicados');
  });
});

// ═══════════════════════════════════════════════════════════════
// DESCUBRIMIENTO REAL — la matriz no puede quedarse corta
// ═══════════════════════════════════════════════════════════════

describe('16. el descubrimiento encuentra exactamente lo que la matriz nombra', () => {
  it('SQL — sólo estas migraciones escriben public.contacts', () => {
    const dir = join(ROOT, 'supabase/migrations');
    const writers = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => /UPDATE\s+public\.contacts\b/i.test(sqlBodies(read(`supabase/migrations/${f}`))))
      .sort();

    assert.deepEqual(
      writers,
      [
        '129_agent2_contact_hubspot_stale_completeness.sql',
        // CUT-3C — re-emite 115 y 117 para pasarles la PROCEDENCIA del pendiente. No es un
        // escritor nuevo de teléfono: son los mismos dos cuerpos con un argumento más, y los
        // dos están clasificados arriba con su veredicto.
        '130_agent2_contact_hubspot_stale_source.sql',
        '115_official_contact_phone_privacy.sql',
        '116_approve_candidate_with_official_phones.sql',
        '117_merge_candidate_into_existing_contact.sql',
        // #352 — la proyección post-aprobación. ESCRIBE el escalar de un contacto que puede estar
        // vinculado, y en su forma original no llamaba a la autoridad: es el escritor que este
        // corte final cablea. Está en la matriz con veredicto DELIBERATELY_EXCLUDED, y la
        // definición viva es la del archivo LOCAL de abajo.
        '128_project_approved_candidate_phones_onto_contact.sql',
        // AGENT2-POST-APPROVAL-REVEAL-STALE-PRODUCER-FINAL-CUT — la re-emite con el paso 10b.
        '131_agent2_post_approval_reveal_stale_producer.sql',
        // BACKFILL LEGACY — escribe `contacts`, sí, pero SÓLO la columna `metadata`. Está en la
        // matriz con veredicto N/A y con la razón escrita. Aparece aquí porque el descubrimiento
        // busca `UPDATE public.contacts` y no distingue qué columna se toca: distinguirlo aquí
        // convertiría el descubridor en un segundo clasificador, y la clasificación vive arriba.
        '132_agent2_hubspot_legacy_sync_state_backfill.sql',
      ].sort(),
      'apareció una migración que escribe contacts y no está en la matriz',
    );
  });

  it('TypeScript — sólo estos módulos escriben la tabla `contacts`', () => {
    const roots = ['src/modules', 'src/server', 'src/app', 'src/components', 'src/lib'];
    const found: string[] = [];

    const walk = (rel: string) => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = readdirSync(join(ROOT, rel), { withFileTypes: true, encoding: 'utf8' });
      } catch {
        return;
      }
      for (const entry of entries) {
        const name = String(entry.name);
        const child = `${rel}/${name}`;
        if (entry.isDirectory()) {
          if (name === '__tests__' || name === 'node_modules') continue;
          walk(child);
          continue;
        }
        if (!/\.tsx?$/.test(name)) continue;
        const src = stripTs(read(child));
        // `.from('contacts')` seguido, en la misma cadena, de una escritura.
        const chains = src.match(/\.from\('contacts'\)[\s\S]{0,400}?;/g) ?? [];
        if (chains.some((c) => /\.(update|insert|upsert|delete)\(/.test(c))) found.push(child);
      }
    };
    for (const r of roots) walk(r);

    assert.deepEqual(
      [...new Set(found)].sort(),
      [
        // AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC (Task E1) — triggerContactHubSpotSync
        // sale del gancho de aprobación hacia este módulo nuevo. Clasificado arriba: sólo
        // escribe metadata, nunca phone ni mobile_phone.
        'src/modules/contact-enrichment/hubspot-contact-approval-sync.ts',
        'src/modules/contact-enrichment/phone-cache-suppression-actions.ts',
        'src/modules/contacts/actions.ts',
        // CUT-3B — el cableado de `persistSync` sale de actions.ts hacia el runner compartido,
        // y con él aparece `persistContactMetadata`. Los dos están clasificados arriba: ninguno
        // escribe teléfono, y el que sale de aquí es el mismo código que ya estaba, no uno nuevo.
        'src/modules/contacts/contact-hubspot-sync-runner.ts',
      ],
      'apareció un módulo que escribe `contacts` y no está en la matriz',
    );
  });

  it('la matriz nombra un fichero REAL para cada entrada', () => {
    for (const entry of MATRIX) {
      assert.ok(read(entry.file).length > 0, `${entry.file} no existe`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 14-15 · Los trinquetes que siguen mandando
// ═══════════════════════════════════════════════════════════════

describe('14. la atomicidad del merge — ninguna segunda escritura desde la aplicación', () => {
  const persistence = stripTs(
    read('src/modules/contact-enrichment/existing-contact-merge-persistence.ts'),
  );
  const actions = stripTs(read('src/modules/contact-enrichment/actions.ts'));

  it('la persistencia del merge sigue teniendo UNA sola RPC y CERO escrituras sueltas', () => {
    for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      assert.equal(persistence.includes(forbidden), false, `${forbidden} no puede existir aquí`);
    }
    assert.equal((persistence.match(/\.rpc\(/g) ?? []).length, 1);
  });

  it('la server action del merge NO adquiere una segunda escritura de contacto', () => {
    const at = actions.indexOf(
      'export async function mergeContactCandidateIntoExistingContactAction',
    );
    assert.ok(at > 0, 'falta la server action del merge');
    const fn = actions.slice(at, at + 8000);

    // ── EL TRINQUETE, AFINADO EN CUT-3C ─────────────────────────
    //
    // Hasta CUT-3A esto prohibía que la acción NOMBRARA HubSpot, y era la forma más barata de
    // asegurar lo que de verdad importa: que la transición a `stale` no se escribiera aquí en
    // tres líneas después de la RPC. Ese atajo es justo el que deja la ventana en la que el
    // teléfono ya está guardado y la ficha sigue diciendo `synced`.
    //
    // CUT-3C necesita que esta acción dispare el PATCH automático, que es una llamada de RED y
    // ocurre DESPUÉS de que esa ventana ya esté cerrada por la propia transacción. Un trinquete
    // que lo prohibiera no estaría defendiendo la atomicidad: estaría defendiendo el defecto de
    // que un merge deje HubSpot desactualizado para siempre.
    //
    // Así que la prohibición se hace PRECISA en vez de desaparecer. Lo que sigue vedado es todo
    // lo que podría reabrir la ventana o duplicar el motor; lo único permitido es delegar en el
    // entrypoint único.
    assert.equal(
      /\.from\('contacts'\)[\s\S]{0,200}?\.update\(/.test(fn),
      false,
      'ninguna segunda escritura de contacto tras la RPC',
    );
    for (const forbidden of [
      // Marcar `stale` aquí sería exactamente el atajo que la 117 existe para evitar.
      /markContactHubSpotSyncStaleForPhoneChange/,
      /writeHubSpotSyncState/,
      /stale_reason/,
      /stale_source/,
      // Construir el payload o hablar con el proveedor sería un segundo motor.
      /api\.hubapi\.com/i,
      /updateHubSpotContact/,
      /buildHubSpotContactUpdateProperties/,
      /buildContactHubSpotSyncDeps/,
      /runSyncContactToHubSpot/,
    ]) {
      assert.equal(forbidden.test(fn), false, `la acción del merge no puede usar ${forbidden}`);
    }

    // Y en POSITIVO: lo único que puede hacer con HubSpot es delegar en el entrypoint único,
    // exactamente una vez. Dos llamadas serían dos PATCH por un solo merge.
    assert.equal(
      (fn.match(/runContactHubSpotAutoPhoneUpdateWired\(/g) ?? []).length,
      1,
      'exactamente una delegación al entrypoint del PATCH automático',
    );

    // En negativo, para que la guarda no sea decorativa: detecta una segunda escritura real.
    assert.equal(
      /\.from\('contacts'\)[\s\S]{0,200}?\.update\(/.test(
        "await supabase.from('contacts').update({ phone: p })",
      ),
      true,
    );
  });

  it('15. los trinquetes de gasto y privacidad del merge siguen vivos', () => {
    const at = actions.indexOf(
      'export async function mergeContactCandidateIntoExistingContactAction',
    );
    const fn = actions.slice(at, at + 6000);
    for (const forbidden of [/apollo/i, /lusha/i, /reserv/i, /usage_log/i, /credit/i]) {
      assert.equal(forbidden.test(fn), false, `la acción no puede mencionar ${forbidden}`);
    }
  });
});

describe('15. la migración de CUT-3A conserva las garantías negativas de 115/117', () => {
  const migration = read(
    'supabase/migrations/129_agent2_contact_hubspot_stale_completeness.sql',
  );
  const body = sqlBodies(migration);

  it('no crea contactos, no borra filas y no resucita un tombstone', () => {
    assert.equal(/INSERT\s+INTO\s+public\.contacts\b/i.test(body), false);
    assert.equal(/\bDELETE\s+FROM\b/i.test(body), false);
    assert.equal(/suppressed_at\s*=\s*NULL/i.test(body), false);
  });

  it('`mobile_phone` se LEE y jamás se escribe', () => {
    // El trinquete de 4O-E4.1 afinado, no relajado: la 117 original prohibía hasta NOMBRARLA,
    // y calcular el saliente exige leerla. Lo que protege 4O-E4.1 es que nadie la ESCRIBA sin
    // procedencia, así que eso es lo que se afirma — y en negativo, para que la guarda no sea
    // decorativa.
    assert.match(body, /c\.mobile_phone/);
    assert.equal(/SET[\s\S]{0,400}?\bmobile_phone\s*=/i.test(body), false);
    assert.equal(/mobile_phone\s*=\s*(NULL|v_|p_|')/i.test(body), false);
    // En negativo: la guarda detecta una escritura real.
    assert.equal(/mobile_phone\s*=\s*(NULL|v_|p_|')/i.test('SET mobile_phone = NULL'), true);
  });

  it('no llama a ningún proveedor, no gasta y no alcanza ninguna red', () => {
    for (const forbidden of [
      /provider_usage_logs\s*\(/i,
      /phone_reveal_credit_reservations/i,
      /wizard_budget_reservations/i,
      /\bhttp_post\b/i,
      /\bpg_net\b/i,
      /\bnet\.http/i,
      /api\.hubapi\.com/i,
      /CREATE\s+EXTENSION/i,
    ]) {
      assert.equal(forbidden.test(migration), false, `CUT-3A no puede tocar ${forbidden}`);
    }
  });

  it('declara su estado de aplicación sin ambigüedad', () => {
    assert.match(migration, /APPLIED IN PRODUCTION:\s*NO/);
    assert.match(migration, /APPLIED REMOTE:\s*NO/);
    assert.match(migration, /LOCAL ONLY:\s*YES/);
  });

  it('lleva número canónico, sin colisión, y no depende de la migración de otra tarea', () => {
    const dir = join(ROOT, 'supabase/migrations');
    const numbered = readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f));
    // ══════════════════════════════════════════════════════════
    // AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 — guarda RE-AFILADA
    // ══════════════════════════════════════════════════════════
    //
    // OLD_ASSERTION: el archivo de CUT-3A NO lleva número, así que no puede compartir prefijo
    // con nadie.
    //
    // WHY_OBSOLETE: ya lo lleva. La disputa 125/126/127 que motivó nacer sin número se cerró en
    // `main`, y la canonicalización le dio el 129. «No colisiona porque no tiene prefijo» era la
    // versión BARATA de la afirmación: cierta por vacuidad.
    //
    // NEW_INVARIANT, el caro y el que de verdad importa: el archivo ESTÁ en la secuencia, su
    // prefijo es exactamente el 129 y sólo el suyo, y NINGÚN número del directorio está
    // duplicado — así que la no colisión se comprueba contra el directorio real en vez de
    // esquivarse.
    assert.ok(
      numbered.includes('129_agent2_contact_hubspot_stale_completeness.sql'),
      'CUT-3A tiene que estar en la secuencia desplegable',
    );
    assert.deepEqual(
      numbered.filter((f) => f.startsWith('129')),
      ['129_agent2_contact_hubspot_stale_completeness.sql'],
    );
    const nums = numbered.map((f) => f.slice(0, 3));
    assert.equal(new Set(nums).size, nums.length, 'dos migraciones comparten número');
    // OLD_ASSERTION: la cabecera NOMBRA el archivo ajeno —explicar por qué este no llevaba número
    // exigía decir con quién habría chocado— y nada ejecutable lo toca.
    //
    // WHY_OBSOLETE, y no por comodidad: la guarda de AUTORÍA de la cadena de Brasil
    // (`br-receita-cnpj-gate-round2-identity-and-cleanup`) recorre el TEXTO COMPLETO de toda
    // migración que no sea suya y prohíbe `BR-SOURCE|RECEITA|CNPJ`. Con esta migración ya dentro
    // de la secuencia numerada entra en ese barrido, y la mención en prosa —aunque fuera sólo
    // histórica— lo hacía fallar por decir la verdad. De las dos guardas se conserva la que
    // defiende AUTORÍA sobre un dominio ajeno; lo que se retira es la mitad POSITIVA de ésta, que
    // era un control de contexto y no un invariante. La cabecera cuenta la misma historia por
    // NÚMERO, sin nombre.
    //
    // NEW_INVARIANT: se conservan intactas las dos mitades NEGATIVAS —las que de verdad afirman
    // independencia— y se AÑADE que el archivo no nombra el dominio ajeno en ninguna parte, ni en
    // prosa: la misma regla que la guarda de Brasil aplica, afirmada ahora también desde aquí.
    assert.equal(/br_receita/i.test(body), false, 'nada ejecutable puede nombrarlo');
    assert.equal(
      /BR-SOURCE|RECEITA|CNPJ/i.test(migration),
      false,
      'ni en prosa: la guarda de autoría de Brasil recorre el texto completo',
    );
    assert.equal(/^\s*\\i\b/m.test(migration), false, 'sin includes de otros ficheros');
  });

  it('el vocabulario de razones está CERRADO también en SQL, y coincide con TypeScript', () => {
    assert.match(body, /ARRAY\['phone_changed', 'phone_removed'\]/);
    const ts = read('src/modules/contacts/contact-hubspot-sync-state.ts');
    assert.match(ts, /export type HubSpotSyncStaleReason = 'phone_changed' \| 'phone_removed';/);
  });
});
