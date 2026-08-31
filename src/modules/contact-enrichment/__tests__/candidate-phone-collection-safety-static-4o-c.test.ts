/**
 * Agente 2A — Guardas ESTÁTICAS del alcance de 4O-C
 * (AGENT2A-PHONE-REVEAL-4O-C)
 *
 * Estas pruebas solo LEEN archivos del disco: no conectan con ninguna base, no
 * llaman a ningún proveedor y no gastan un crédito. Su trabajo es que el alcance
 * autorizado —capturar los teléfonos que ya llegan en el webhook y en el
 * recovery— no se ensanche en silencio en un cambio posterior.
 *
 * Cada aserción vale por lo que PROHÍBE, no por lo que confirma.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → raíz del repo
const repoRoot = join(here, '..', '..', '..', '..');
const moduleDir = join(repoRoot, 'src/modules/contact-enrichment');

const CAPTURE = 'apollo-phone-collection-capture.ts';
const WRITER = 'candidate-phone-collection-writer.ts';
const PERSISTENCE = 'candidate-phone-collection-persistence.ts';

/** Los archivos NUEVOS del hito. */
const NEW_FILES = [CAPTURE, WRITER, PERSISTENCE] as const;

function read(file: string): string {
  return readFileSync(join(moduleDir, file), 'utf8');
}

/** El archivo sin comentarios: lo que realmente se ejecuta. */
function executable(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return (
        !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')
      );
    })
    .join('\n');
}

const sources = Object.fromEntries(
  NEW_FILES.map((file) => [file, read(file)]),
) as Record<(typeof NEW_FILES)[number], string>;

const webhookCore = read('phone-reveal-webhook-core.ts');
const recoveryCore = read('phone-reveal-recovery-core.ts');

// ═══════════════════════════════════════════════════════════════════
// Lo que el hito NO toca
// ═══════════════════════════════════════════════════════════════════

describe('4O-C — alcance: proveedores', () => {
  it('ningún archivo nuevo importa ni menciona Lusha', () => {
    for (const file of NEW_FILES) {
      const code = executable(sources[file]);
      assert.equal(/lusha/i.test(code), false, `${file} no debe tocar Lusha`);
    }
  });

  it('ningún archivo nuevo llama al cliente de Apollo ni hace red', () => {
    for (const file of NEW_FILES) {
      const code = executable(sources[file]);
      assert.equal(/apollo-client|fetchApollo|\bfetch\s*\(/.test(code), false, file);
      assert.equal(/from '@\/server\/integrations/.test(code), false, file);
      assert.equal(/axios|node-fetch|https?:\/\//.test(code), false, file);
    }
  });

  it('la captura y el contrato son PUROS: sin Supabase, sin env, sin reloj', () => {
    for (const file of [CAPTURE, WRITER] as const) {
      const code = executable(sources[file]);
      assert.equal(/supabase|createClient/i.test(code), false, `${file} sin Supabase`);
      assert.equal(/process\.env/.test(code), false, `${file} sin env`);
      assert.equal(/Date\.now\(\)|new Date\(\)/.test(code), false, `${file} sin reloj`);
    }
  });

  it('la persistencia usa la factoría admin canónica, no un createClient inline', () => {
    const code = executable(sources[PERSISTENCE]);
    assert.match(code, /createSupabaseAdminClient/);
    assert.equal(/createClient\s*\(/.test(code), false);
  });
});

describe('4O-C — alcance: superficies fuera de contrato', () => {
  it('ningún archivo nuevo toca contactos oficiales, HubSpot ni la UI', () => {
    for (const file of NEW_FILES) {
      const code = executable(sources[file]);
      assert.equal(/hubspot/i.test(code), false, `${file} sin HubSpot`);
      assert.equal(/\bfrom 'contacts'|\.from\('contacts'\)/.test(code), false, file);
      assert.equal(/mobile_phone/.test(code), false, `${file} sin contacts.mobile_phone`);
      assert.equal(/contact_phones\b/.test(code), false, `${file} sin contact_phones`);
      assert.equal(/\breact\b|tsx|useState|className/i.test(code), false, `${file} sin UI`);
    }
  });

  it('ningún archivo nuevo lee un feature flag', () => {
    // La captura NO es una optimización que se pueda apagar: es la única forma de
    // que los números ya pagados dejen de perderse. Un flag aquí solo serviría
    // para volver a perderlos.
    for (const file of NEW_FILES) {
      const code = executable(sources[file]);
      assert.equal(/ENABLE_[A-Z_]+/.test(code), false, `${file} sin flags`);
      assert.equal(/feature-flags/.test(code), false, `${file} sin feature-flags`);
    }
  });

  it('ningún archivo nuevo toca presupuestos, reservas ni límites', () => {
    for (const file of NEW_FILES) {
      const code = executable(sources[file]);
      assert.equal(/budget_rules|budgets|reserveCredits/i.test(code), false, file);
      assert.equal(
        /\.from\('phone_reveal_credit_reservations'\)/.test(code),
        false,
        file,
      );
    }
  });

  it('ninguna fila de la colección lleva una columna de costo', () => {
    // El dinero vive en la reserva, la corrida y el usage-log. Una segunda
    // contabilidad por número sería una cifra que nadie cobró.
    //
    // 4O-C-R1: `phone_reveal_cost_credits` / `_cost_source` SÍ aparecen ahora en
    // este archivo, porque la misma transacción escribe el estado terminal del
    // CANDIDATO — que es donde esas columnas ya vivían antes del hito. Lo prohibido
    // sigue siendo idéntico: una columna de costo en una fila de TELÉFONO. Por eso
    // la guarda se aplica al payload de la colección, no al archivo entero.
    const code = executable(sources[PERSISTENCE]);
    const phonePayload = code.slice(
      code.indexOf('const phones = request.phones.map'),
      code.indexOf('const params = {'),
    );
    assert.ok(phonePayload.length > 0, 'el payload de la colección debe ser localizable');
    for (const forbidden of ['cost_credits', 'cost_usd', 'credits_consumed', 'credits:']) {
      assert.equal(
        phonePayload.includes(forbidden),
        false,
        `sin ${forbidden} en la fila de teléfono`,
      );
    }
    // Y ninguna de las dos tablas de la 109 recibe una columna de costo por su
    // nombre en ningún punto del archivo.
    assert.equal(/candidate_phone[a-z_]*\s*:\s*\{[^}]*cost/i.test(code), false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Sin migración y sin backfill
// ═══════════════════════════════════════════════════════════════════

describe('4O-C-R1 — exactamente UNA migración nueva, y sin backfill', () => {
  const migrations = () =>
    readdirSync(join(repoRoot, 'supabase/migrations'))
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();

  it('la 110 sigue siendo la única migración de este hito, y el techo no se ha abierto', () => {
    // 4O-C no podía añadir migración y por eso su persistencia no era
    // transaccional. 4O-C-R1 añade UNA —la función de la 110— y esta guarda pasa de
    // «ninguna» a «exactamente esa»: sigue siendo una guarda, no una puerta abierta.
    //
    // AGENT2A-PHONE-REVEAL-4O-D subió el techo a la 111 (la función equivalente para
    // el otro proveedor de teléfono, con su propia guarda estática en
    // candidate-lusha-phone-persistence-static-4o-d.test.ts) y
    // AGENT2A-PHONE-REVEAL-4O-E2 a la 112 (la propagación de la supresión a la
    // colección, con su guarda en
    // candidate-phone-collection-suppression-static-4o-e2.test.ts). Lo que esta
    // guarda protege NO es el número más alto del directorio, que sube cada vez que un
    // bloque autorizado añade la suya: es que 4O-C-R1 aportó SOLO la 110 y que nadie
    // ha colado una migración por encima del último hito conocido.
    //
    // AGENT2A-PHONE-REVEAL-4O-H1 sube el techo a la 114: el esquema OFICIAL de
    // múltiples teléfonos (`contact_phones` + `contact_phone_sources`), creado INERTE y
    // con su propia guarda estática en
    // src/modules/contacts/__tests__/official-contact-phone-schema-static-4o-h1.test.ts,
    // que es la que fija su forma, sus vocabularios y sus privilegios. La 114 NO edita
    // la 110 ni ninguna otra de la cadena 109–113, que es la propiedad que esta guarda
    // vigila desde 4O-C-R1.
    //
    // AGENT2A-PHONE-REVEAL-4O-H2 sube el techo a la 115: la PRIVACIDAD de ese esquema
    // oficial (dos contadores de auditoría sobre `phone_reveal_suppression_audit` y la
    // función transaccional `suppress_official_contact_phone_sources`), con su propia
    // guarda estática. Tampoco edita la 110 ni ninguna otra de la cadena 109–114: 4O-C-R1
    // sigue aportando EXACTAMENTE la 110, que es lo único que esta guarda afirma.
    const files = migrations();
    assert.ok(files.includes('109_contact_enrichment_candidate_phones.sql'));
    assert.ok(files.includes('110_persist_candidate_apollo_phone_reveal_result.sql'));
    assert.equal(
      files.filter((file) => /^110/.test(file)).length,
      1,
      '4O-C-R1 aporta exactamente una migración',
    );
    // BR-PRODUCTION-RELEASE mueve el techo a la 133: `133_br_candidate_identity_promotion.sql`,
    // la promoción VALLADA de la identidad fiscal resuelta de una candidata brasileña
    // (BR-SOURCE CUT D), numerada al volver ese trabajo a GitHub después de haber vivido en local
    // sin número mientras el espacio de nombres estaba en disputa. Crea UNA función
    // (`promote_candidate_fiscal_identity_fenced`) y sus permisos: sin tabla, sin columna, sin
    // índice, sin constraint y sin backfill. NO es de teléfono y no nombra ninguna tabla, columna
    // ni función de teléfono, que es lo que esta guarda vigila. AUTORADA y NO APLICADA.
    // BR-COMPACT-SNAPSHOT-PRODUCTIZATION mueve el techo a la 134:
    // `134_br_receita_compact_snapshot.sql`, la tabla dedicada y particionada del snapshot
    // nacional de Brasil. NO es de teléfono, no nombra ninguna tabla, columna ni función de
    // teléfono, y no edita el archivo de ninguna migración anterior. AUTORADA y NO APLICADA.
    // 🔴 AGENT1-LUSHA-CUT-L3 mueve el techo a la 135 (renumerada desde la 134 al integrarse en
    // serie después de que BR-COMPACT-SNAPSHOT-PRODUCTIZATION llegara primero a main con ese
    // número): `135_agent1_lusha_prospecting_request_fence.sql`, la valla DURABLE de una
    // petición de Lusha Company Prospecting — una tabla (`lusha_prospecting_request_fence`) y
    // tres funciones que se escriben ANTES del envío para que una caída dura no repita una
    // petición que el proveedor quizá ya cobró. NO es de teléfono: es de Agente 1 y de seguridad
    // de gasto, no nombra ninguna tabla, columna ni función de teléfono, y el barrido de más
    // abajo lo comprueba sobre su SQL. AUTORADA y NO APLICADA en Producción.
    assert.equal(
      files[files.length - 1],
      // AGENT2A-PHONE-REVEAL-4O-H3 subió el techo a la 116: la APROBACIÓN atómica del
      // candidato sobre ese mismo esquema oficial (una sola función transaccional,
      // `approve_contact_candidate_with_phones`, con su propia guarda estática). Tampoco
      // edita la 110 ni ninguna otra de la cadena 109–115.
      //
      // AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 sube el techo a la 119. Las 118 y 119
      // NO son de teléfono: publican el catálogo de Macro Industrias (una siembra en
      // `draft`, la otra el cutover). Lo que esta guarda vigila desde 4O-C-R1 —que
      // 4O-C-R1 aporte EXACTAMENTE la 110 y que nadie edite la cadena 109–116— sigue
      // afirmándose abajo, ahora de forma directa en vez de por implicación del número
      // más alto del directorio.
      // AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4 (Fase 1) mueve el techo a la 120:
      // `provider_suppressions` + `provider_suppression_audit` — supresión de teléfono por
      // identidad NATIVA del proveedor y SIN cuenta. ADITIVA: no borra columna, no suelta
      // constraint y no reescribe ninguna migración anterior.
      //
      // AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1 mueve el techo a la 121, y NO es de teléfono:
      // reemplaza la constraint de `wizard_budget_reservations` y el cuerpo de
      // `confirm_wizard_credits` para que un sobrepaso real del proveedor se pueda liquidar
      // (Agente 1, contabilidad de presupuesto). No nombra ninguna tabla de teléfono, y el
      // barrido de más abajo —que ya cubre 118 y superiores— lo comprueba sobre su SQL
      // ejecutable en vez de fiarse de este número.
      // AGENT2A-SEARCH-MORE-PHONES-1 mueve el techo a la 122: «Buscar más números»
      // (Agente 2A). Es de teléfono, pero NO edita la 110 ni ninguna otra de la cadena
      // 109–117: añade la modalidad `search_more` y una función NUEVA, que es justo por
      // qué no re-declara la 110 ni la 111.
      // AGENT1-PROVIDER-SEEN-MEMORY-2 mueve el techo a la 123: la memoria de qué empresa ya
      // nos mostró un proveedor de PAGO (Agente 1, economía de descubrimiento). NO es de
      // teléfono en absoluto: crea `provider_seen_entities`, que sólo guarda identidad de
      // EMPRESA —id nativo del proveedor y dominio normalizado— y no nombra ninguna tabla,
      // columna ni función de teléfono. Se declara NO aplicada en Producción.
      // AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1: identidad provider-native
      // (`contact_provider_identities`), grano de reserva por OPERACIÓN y claim propio de
      // la búsqueda de identidad. Trae su propia guarda estática y NO edita ninguna
      // migración anterior — que es lo que esta lista exacta vigila. NO aplicada en Prod.
      // teléfono y NO nombra ninguna tabla, columna ni función de la cadena de teléfono.
      //
      // BR-SOURCE CUT A.1 (reconciliación de esquema de producción antes de CUT B) RENUMERÓ esa
      // migración DOS VECES: 125→126→127. El primer salto (125→126) — su cuerpo SQL no cambió
      // en nada que afecte a esta cadena — dejó sitio a una migración 125 genérica y nueva
      // (`125_reconcile_source_snapshot_record_identity.sql`): reconcilia la unicidad genérica
      // de `record_identity_key` sobre `source_company_snapshots` para fuentes NO brasileñas.
      // El segundo salto (126→127) fue forzado por AGENT1-CUT3B4-BATCH-IDENTITY-ATOMICITY, que
      // reclamó el 126 de forma independiente mientras esta reconciliación seguía en revisión:
      // el vallado optimista de la admisión por identidad de LOTE (Agente 1), que añade
      // `prospect_batches.identity_epoch` y dos funciones sobre `prospect_batches` y
      // `prospect_candidates`. Ninguna de las tres migraciones (125, 126, 127) es de teléfono ni
      // nombra ninguna tabla, columna o función de la cadena de teléfono, y la autoría de las
      // tres se comprueba abajo archivo por archivo. Las tres AUTORADAS y NO APLICADAS.
      // AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 mueve el techo a la 128:
      // `project_approved_candidate_phones_onto_contact`, que promueve la colección de un
      // candidato YA APROBADO al contacto que su propia aprobación creó. SÍ es de teléfono y SÍ
      // nombra la cadena — por eso queda EXENTA del barrido ciego más abajo, con su límite
      // afirmado de forma directa igual que la 120 y la 122—, pero NO edita ninguna migración
      // anterior: sin tablas, columnas, índices, triggers ni policies nuevas; M128 únicamente
      // crea/reemplaza una función y sus permisos, sin backfill y sin re-declarar la 110/111/116.
      // AUTORADA y NO APLICADA.
      // AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 mueve el techo a la 132: el tramo 129–132 de
      // la cadena de sincronización con HubSpot de Agente 2 —129 la completitud del estado
      // durable `stale`, 130 su procedencia, 131 la 128 re-emitida para producirlo con
      // procedencia `reveal`, 132 la línea base de los contactos ya vinculados—.
      //
      // La 129 y la 130 re-emiten la 115 y la 117, y la 131 la 128, así que las tres NOMBRAN la
      // cadena de teléfono y quedan EXENTAS del barrido ciego de más abajo por el mismo motivo
      // que la 120, la 122 y la 128: re-emitir una función con `CREATE OR REPLACE` no es EDITAR
      // el archivo de la migración que la creó, y ninguna de las tres añade tabla, columna,
      // índice, trigger ni policy. La 132 no la nombra en absoluto —su único UPDATE escribe
      // `contacts.metadata`— y por eso sí pasa por el barrido ciego. AUTORADAS y NO APLICADAS.
      // AGENT1-LUSHA-CUT-L4 anade la 136: el historial DURABLE de INTENTOS de una peticion de
      // Lusha Prospecting y el reclamo atomico de UN reintento seguro (solo tras un 429 o un
      // 5xx, que el contrato HUMANO del proveedor declara a 0 creditos). Es de Agente 1 y de
      // seguridad de gasto. AUTORADA y NO APLICADA.
      '136_agent1_lusha_prospecting_safe_retry_attempts.sql',
      'el techo conocido es la 135: la 133 (la promoción vallada de identidad fiscal de BR-SOURCE CUT D) y la 134 (el almacenamiento compacto de BR) llegaron primero a main, así que AGENT1-LUSHA-CUT-L3 se renumeró de la 134 a la 135 al integrarse en serie; ni ella, ni la 134, ni la 133, ni el tramo 129–132 editan el archivo de una migración anterior de la cadena de teléfono 109–117',
    );
    assert.equal(
      // La ventana sube con el techo DECLARADO arriba: la 125 (reconciliación genérica), la 126
      // (AGENT1-CUT3B4, independiente), la 127 (BR, renumerada dos veces), la 128
      // (AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1) y el tramo 129–132 de
      // AGENT2-FINAL-INTEGRATION están autorizadas y nombradas una por una, así que lo prohibido
      // pasa a ser la 134 y superiores.
      // BR-PRODUCTION-RELEASE declara la 133: la promoción VALLADA de la identidad fiscal
      // resuelta de una candidata brasileña (BR-SOURCE CUT D), y
      // BR-COMPACT-SNAPSHOT-PRODUCTIZATION declara la 134: la tabla dedicada y particionada del
      // snapshot nacional de Brasil. Ambas quedan AUTORIZADAS y NOMBRADAS como las anteriores.
      // 🔴 AGENT1-LUSHA-CUT-L3 declara la 135 (renumerada desde la 134 al integrarse en serie
      // después de que BR-COMPACT-SNAPSHOT-PRODUCTIZATION llegara primero a main con ese
      // número): la valla DURABLE de una petición de Lusha Company Prospecting
      // (`lusha_prospecting_request_fence` + tres RPC), escrita ANTES del envío para que una
      // caída dura no repita una petición que el proveedor quizá ya cobró. Queda AUTORIZADA y
      // NOMBRADA como las anteriores, así que la ventana prohibida sube a la 136 y superiores.
      // La guarda no se relaja: sigue impidiendo que alguien cuele una POR ENCIMA del último
      // hito conocido sin declararla.
      files.some((file) => /^1(3[7-9]|[4-9]\d)/.test(file)),
      false,
      // La 120, la 121 y la 122 son AUTORIZADAS y están declaradas arriba con lo que hacen. Lo que
      // esta guarda sigue impidiendo es que alguien cuele una POR ENCIMA del último hito
      // conocido sin declararla; la afirmación de que ninguna de ellas escribe sobre las
      // tablas de la cadena de teléfono se comprueba justo abajo, de forma directa.
      'ninguna migración 137 o superior',
    );
    // La afirmación que de verdad importa, ya no delegada en el orden alfabético:
    // ninguna migración posterior a la ÚLTIMA de la cadena de teléfono escribe sobre sus
    // tablas. Una migración nueva que las tocara fallaría aquí aunque su número fuera el
    // esperado.
    //
    // Esa última es la 117 (4O-H3-B, `merge_contact_candidate_into_existing_contact`), no
    // la 116. El corte decía «posterior a la 116» porque cuando se redactó el fichero de
    // la 117 no estaba en `main` pese a estar APLICADA en Producción: el corte describía
    // el hueco del repo, no la cadena real. Reconciliada la historia, el corte vuelve a
    // significar lo que siempre quiso decir, y lo que la 117 puede hacer se afirma abajo
    // de forma DIRECTA en vez de por omisión.
    const PHONE_CHAIN_TABLES = [
      'contact_enrichment_candidate_phones',
      'contact_phones',
      'contact_phone_sources',
      'phone_reveal_suppression_audit',
    ];
    // El barrido arranca en la 118, no en la 117. La 117 (4O-H3-B) NOMBRA
    // `contact_enrichment_candidate_phones` porque LEE la colección para promoverla al contacto
    // existente — leerla es justamente su trabajo—, y que no la escriba ni la altere lo fija su
    // propia guarda estática (`existing-contact-merge-static-4o-h3b`), que sabe distinguir una
    // lectura de una escritura. Un `includes` de la tabla no puede: marcaría la 117 por leerla.
    //
    // AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4 (Fase 1) — el barrido se hace sobre el SQL
    // SIN COMENTARIOS. Es la MISMA lección que este bloque ya había aprendido con la 117:
    // un `includes` crudo no distingue lo que una migración HACE de lo que EXPLICA. La 120
    // NOMBRA `phone_reveal_suppression_audit` en su cabecera para documentar por qué crea
    // una tabla de auditoría NUEVA en vez de extender la vieja (la vieja tiene
    // `account_id NOT NULL REFERENCES accounts ON DELETE CASCADE`, así que su evidencia no
    // sobrevive al borrado de la cuenta). Prohibir esa explicación empeoraría la migración
    // sin proteger nada, y borrarla para que la guarda pasara sería exactamente al revés
    // de lo que la guarda existe para conseguir.
    //
    // Lo que se sigue prohibiendo —y ahora con más precisión— es que el SQL EJECUTABLE de
    // una migración por encima de la cadena toque esas tablas.
    const stripSqlComments = (sql: string) =>
      sql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');

    // AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4-R1 — la 120 queda EXENTA del barrido ciego
    // por la MISMA razón que la 117, y su límite se afirma directamente justo debajo. La
    // 120 nombra `contact_enrichment_candidate_phones` en SQL ejecutable porque RESTATEA
    // las funciones de la 110 y la 111, cuyos cuerpos escriben la colección. Ese
    // restatement no es una ampliación de alcance: es el único instrumento que PostgreSQL
    // ofrece para cambiar una sentencia dentro de un cuerpo de función, y lo que se cambió
    // es una sola —el re-chequeo de supresión pasa a ser provider-native, para que un
    // candidato de origen Lusha deje de persistir teléfono sin comprobación alguna dentro
    // de la transacción final—. Exentarla y callar sería más débil que lo que sigue.
    const RESTATED_120 = '120_provider_native_phone_suppression.sql';

    // AGENT2A-SEARCH-MORE-PHONES-1 — la 122 queda EXENTA del barrido ciego por la MISMA
    // razón que la 117 y la 120, y su límite se afirma directamente más abajo. Nombra la
    // colección en SQL ejecutable porque «Buscar más números» AÑADE teléfonos a un
    // candidato cuyo reveal ya cerró, y esa escritura es el hito.
    //
    // Lo que NO es: una ampliación del alcance de la 110/111. La 122 no las re-declara —y
    // eso es justamente el punto—: el parche terminal de la 111 sería FALSO en una corrida
    // `search_more` (atribuiría a Lusha un número que produjo Apollo y sobrescribiría el
    // costo del reveal de Apollo), y como si el incumbente se conserva se decide bajo el
    // lock, el llamador no puede evitarlo eligiendo parámetros. Así que la 122 aporta una
    // función NUEVA y deja las dos anteriores intactas.
    const SEARCH_MORE_122 = '122_phone_reveal_search_more.sql';
    // AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 — la 128 queda EXENTA del barrido
    // ciego por la MISMA razón que la 117, la 120 y la 122, y su límite se afirma directamente
    // más abajo. Nombra la colección del candidato y las dos tablas oficiales en SQL ejecutable
    // porque su trabajo ES promover de una a otra: leer la colección viva del candidato e
    // insertar en `contact_phones` / `contact_phone_sources`.
    //
    // Lo que NO es: una ampliación del alcance de la 110/111 ni una segunda aprobación. No las
    // re-declara, no crea contactos y no re-terminaliza candidatos. Sin tablas, columnas,
    // índices, triggers ni policies nuevas; M128 únicamente crea/reemplaza una función y sus
    // permisos. Existe porque 116 devuelve `already_approved` con cero escrituras para un
    // candidato ya aprobado y 117 rechaza todo lo que no sea `duplicate`: sin ella, un teléfono
    // conseguido DESPUÉS de la aprobación no tenía ninguna sentencia en el esquema que lo
    // llevara al contacto.
    const POST_APPROVAL_128 = '128_project_approved_candidate_phones_onto_contact.sql';
    // Las tres re-emisiones de Agente 2 quedan exentas por el MISMO motivo que la 120, la 122 y
    // la 128: nombran la cadena porque re-emiten funciones que ya la escribían, sin editar el
    // archivo de la migración que las creó y sin añadir esquema. La 132 NO está exenta —no nombra
    // la cadena en absoluto— así que pasa por el barrido ciego como cualquier migración ajena.
    const RESTATED_129 = '129_agent2_contact_hubspot_stale_completeness.sql';
    const RESTATED_130 = '130_agent2_contact_hubspot_stale_source.sql';
    const RESTATED_131 = '131_agent2_post_approval_reveal_stale_producer.sql';
    const BLIND_SWEEP_EXEMPT = new Set([
      RESTATED_120,
      SEARCH_MORE_122,
      POST_APPROVAL_128,
      RESTATED_129,
      RESTATED_130,
      RESTATED_131,
    ]);

    for (const file of files.filter(
      (f) => /^1(1[89]|[2-9]\d)/.test(f) && !BLIND_SWEEP_EXEMPT.has(f),
    )) {
      const sql = stripSqlComments(
        readFileSync(join(repoRoot, 'supabase/migrations', file), 'utf8'),
      );
      for (const table of PHONE_CHAIN_TABLES) {
        assert.ok(
          !sql.includes(table),
          `la migración ${file} no puede tocar ${table}`,
        );
      }
    }

    // ── El límite de la 120, afirmado de forma DIRECTA ───────────────
    assert.ok(files.includes(RESTATED_120), 'el fichero de la 120 no puede faltar');
    const exec120 = stripSqlComments(
      readFileSync(join(repoRoot, 'supabase/migrations', RESTATED_120), 'utf8'),
    );

    // 1. De las cuatro tablas de la cadena, la 120 sólo puede nombrar la de staging. Las
    //    dos oficiales y la auditoría legada siguen prohibidas con la misma dureza.
    for (const table of PHONE_CHAIN_TABLES.filter(
      (t) => t !== 'contact_enrichment_candidate_phones',
    )) {
      assert.ok(
        !exec120.includes(table),
        `la 120 no puede tocar ${table}: su restatement es de la 110/111, no de la cadena oficial`,
      );
    }

    // 2. La 120 NO es dueña de la forma de la colección — eso siguen siendo la 109 y la
    //    112—, así que no puede crearla, alterarla, borrarla ni vaciarla.
    for (const verb of ['CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'TRUNCATE', 'DELETE FROM']) {
      assert.ok(
        !new RegExp(`${verb}[^;]*contact_enrichment_candidate_phones`, 'i').test(exec120),
        `la 120 no puede ejecutar ${verb} sobre la colección`,
      );
    }

    // 3. Y lo más importante: CADA mención de la colección tiene que estar DENTRO de uno
    //    de los dos cuerpos restateados. Una sentencia suelta —un backfill, un UPDATE de
    //    migración— caería fuera y fallaría aquí, que es justo lo que este bloque existe
    //    para impedir. Los límites se toman por la etiqueta de dollar-quote de cada
    //    función, no por un `END $$` fijo: los helpers de este hito usan `$fn$`.
    const restatedRanges: Array<[number, number]> = [];
    for (const fn of [
      'persist_candidate_apollo_phone_reveal_result',
      'persist_candidate_lusha_phone_reveal_result',
    ]) {
      const start = exec120.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      assert.notEqual(start, -1, `la 120 tiene que restatear ${fn}`);
      const tag = /\bAS (\$[A-Za-z_]*\$)/.exec(exec120.slice(start));
      assert.ok(tag, `${fn}: no se localizó la etiqueta de dollar-quote`);
      const bodyStart = start + (tag.index ?? 0) + tag[0].length;
      const close = exec120.indexOf(tag[1], bodyStart);
      assert.notEqual(close, -1, `${fn}: dollar-quote sin cerrar`);
      restatedRanges.push([start, close + tag[1].length]);
    }

    const insideRestatement = (index: number) =>
      restatedRanges.some(([from, to]) => index >= from && index < to);

    for (let at = exec120.indexOf('contact_enrichment_candidate_phones'); at !== -1; ) {
      assert.ok(
        insideRestatement(at),
        `la 120 menciona la colección FUERA de los cuerpos restateados (offset ${at}): ` +
          'una sentencia suelta sobre la cadena de teléfono no está autorizada',
      );
      at = exec120.indexOf('contact_enrichment_candidate_phones', at + 1);
    }

    // ── El límite de la 122, afirmado de forma DIRECTA ───────────────
    assert.ok(files.includes(SEARCH_MORE_122), 'el fichero de la 122 no puede faltar');
    const exec122 = stripSqlComments(
      readFileSync(join(repoRoot, 'supabase/migrations', SEARCH_MORE_122), 'utf8'),
    );

    // 1. De las cuatro tablas de la cadena, la 122 sólo puede nombrar las DOS de staging
    //    (la colección y su procedencia). Las oficiales y la auditoría legada siguen
    //    prohibidas con la misma dureza: «Buscar más números» es del CANDIDATO en revisión,
    //    y un contacto ya aprobado no tiene corrida ni reserva a las que colgar la
    //    operación.
    for (const table of PHONE_CHAIN_TABLES.filter(
      (t) =>
        t !== 'contact_enrichment_candidate_phones' &&
        t !== 'contact_enrichment_candidate_phone_sources',
    )) {
      assert.ok(
        !exec122.includes(table),
        `la 122 no puede tocar ${table}: «Buscar más números» no llega a la cadena oficial`,
      );
    }

    // 2. La 122 NO es dueña de la FORMA de la colección — eso siguen siendo la 109 y la
    //    112—, así que no puede crearla, alterarla, borrarla ni vaciarla. En particular
    //    `DELETE` está prohibido por la razón de la 109: borrar una fila borra un tombstone.
    for (const verb of ['CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'TRUNCATE', 'DELETE FROM']) {
      assert.ok(
        !new RegExp(`${verb}[^;]*contact_enrichment_candidate_phone`, 'i').test(exec122),
        `la 122 no puede ejecutar ${verb} sobre la colección`,
      );
    }

    // 3. Y lo más importante: CADA mención de la colección tiene que estar DENTRO del
    //    cuerpo de la función NUEVA. Una sentencia suelta —un backfill, un UPDATE de
    //    migración— caería fuera y fallaría aquí. Se toma el límite por la etiqueta de
    //    dollar-quote, no por un `END $$` fijo.
    const APPEND_FN = 'append_candidate_search_more_phones';
    const fnStart = exec122.indexOf(`CREATE OR REPLACE FUNCTION public.${APPEND_FN}(`);
    assert.notEqual(fnStart, -1, `la 122 tiene que crear ${APPEND_FN}`);
    const fnTag = /\bAS (\$[A-Za-z_]*\$)/.exec(exec122.slice(fnStart));
    assert.ok(fnTag, `${APPEND_FN}: no se localizó la etiqueta de dollar-quote`);
    const fnBodyStart = fnStart + (fnTag.index ?? 0) + fnTag[0].length;
    const fnClose = exec122.indexOf(fnTag[1], fnBodyStart);
    assert.notEqual(fnClose, -1, `${APPEND_FN}: dollar-quote sin cerrar`);

    for (let at = exec122.indexOf('contact_enrichment_candidate_phone'); at !== -1; ) {
      assert.ok(
        at >= fnStart && at < fnClose + fnTag[1].length,
        `la 122 menciona la colección FUERA del cuerpo de ${APPEND_FN} (offset ${at}): ` +
          'una sentencia suelta sobre la cadena de teléfono no está autorizada',
      );
      at = exec122.indexOf('contact_enrichment_candidate_phone', at + 1);
    }

    // 4. Y NO re-declara las funciones de la 110/111. Si algún día lo hiciera, dejaría de
    //    ser cierto que el camino del reveal existente queda intacto — que es el argumento
    //    por el que este hito añade una función en vez de tocar las suyas.
    for (const fn of [
      'persist_candidate_apollo_phone_reveal_result',
      'persist_candidate_lusha_phone_reveal_result',
    ]) {
      assert.ok(
        !new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${fn}`).test(exec122),
        `la 122 no puede re-declarar ${fn}: su writer es una función NUEVA`,
      );
    }

    // ── El límite de la 128, afirmado de forma DIRECTA ───────────────
    assert.ok(files.includes(POST_APPROVAL_128), 'el fichero de la 128 no puede faltar');
    // SQL ESTRUCTURAL, no sólo «sin líneas `--`»: la 128 declara sus límites dentro de su
    // `COMMENT ON FUNCTION`, y ahí están escritas —en prosa— las mismas cadenas que estas
    // aserciones prohíben («no hay `INSERT INTO public.contacts` en el archivo»). Un barrido que
    // leyera el COMMENT castigaría exactamente la frase que declara el límite, y la forma de
    // aprobarlo sería borrarla. Misma convención que `structuralSql` en las suites de 4O-H1 y
    // 4O-E4.1, y misma lección que este bloque ya aprendió con la 117 y la 120.
    const exec128 = stripSqlComments(
      readFileSync(join(repoRoot, 'supabase/migrations', POST_APPROVAL_128), 'utf8'),
    ).replace(/COMMENT ON [\s\S]*?';\n/g, '');

    // 1. La 128 NO es dueña de la forma de ninguna tabla de la cadena — eso siguen siendo la
    //    109/112 (staging) y la 114 (oficial)— así que no puede crearla, alterarla, borrarla,
    //    vaciarla ni borrar filas de ella. Un `DELETE` aquí sería un borrado sin tombstone, que
    //    es precisamente lo que el modelo de privacidad de la 114/115 existe para impedir.
    for (const verb of [
      'CREATE TABLE',
      'ALTER TABLE',
      'DROP TABLE',
      'TRUNCATE',
      'DELETE FROM',
      'CREATE INDEX',
      'CREATE POLICY',
      'CREATE TRIGGER',
    ]) {
      assert.ok(
        !new RegExp(verb, 'i').test(exec128),
        `la 128 no puede ejecutar ${verb}: no crea NINGUNA estructura nueva — únicamente ` +
          `crea/reemplaza una función y sus permisos`,
      );
    }

    // 2. Y NO re-declara las funciones de la 110/111/116/117. Si lo hiciera, dejaría de ser
    //    cierto que el reveal existente y la aprobación existente quedan intactos — que es el
    //    argumento por el que este hito añade una función en vez de tocar las suyas.
    for (const fn of [
      'persist_candidate_apollo_phone_reveal_result',
      'persist_candidate_lusha_phone_reveal_result',
      'approve_contact_candidate_with_phones',
      'merge_contact_candidate_into_existing_contact',
      'append_candidate_search_more_phones',
    ]) {
      assert.ok(
        !new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${fn}`).test(exec128),
        `la 128 no puede re-declarar ${fn}: su proyección es una función NUEVA`,
      );
    }

    // 3. No crea contactos y no re-terminaliza candidatos: las dos escrituras que la
    //    distinguirían de una aprobación o de un merge, y las dos que este hito promete no
    //    hacer. Se comprueba sobre SQL ejecutable, así que la promesa del comentario no puede
    //    aprobarse a sí misma.
    assert.ok(
      !/INSERT\s+INTO\s+public\.contacts\b/i.test(exec128),
      'la 128 no puede crear un contacto: eso es de la 116',
    );
    assert.ok(
      !/UPDATE\s+public\.contact_enrichment_candidates\b/i.test(exec128),
      'la 128 no puede re-terminalizar el candidato: su veredicto lo escribió una persona',
    );

    // 4. Cada mención de las tres tablas de la cadena tiene que estar DENTRO del cuerpo de su
    //    única función. Una sentencia suelta —un backfill, un UPDATE de migración— caería fuera
    //    y fallaría aquí, que es justo lo que este bloque existe para impedir.
    const PROJECT_FN = 'project_approved_candidate_phones_onto_contact';
    const fn128Start = exec128.indexOf(`CREATE OR REPLACE FUNCTION public.${PROJECT_FN}(`);
    assert.notEqual(fn128Start, -1, 'la 128 tiene que declarar su función');
    const fn128Tag = /\bAS (\$[A-Za-z_]*\$)/.exec(exec128.slice(fn128Start));
    assert.ok(fn128Tag, 'la 128: no se localizó la etiqueta de dollar-quote');
    const fn128BodyStart = fn128Start + (fn128Tag.index ?? 0) + fn128Tag[0].length;
    const fn128Close = exec128.indexOf(fn128Tag[1], fn128BodyStart);
    assert.notEqual(fn128Close, -1, 'la 128: dollar-quote sin cerrar');
    for (const table of PHONE_CHAIN_TABLES) {
      for (let at = exec128.indexOf(table); at !== -1; at = exec128.indexOf(table, at + 1)) {
        assert.ok(
          at >= fn128Start && at < fn128Close + fn128Tag[1].length,
          `la 128 menciona ${table} FUERA del cuerpo de su función (offset ${at})`,
        );
      }
    }

    // 5. La auditoría de supresión LEGADA sigue fuera de su alcance por completo.
    assert.ok(
      !exec128.includes('phone_reveal_suppression_audit'),
      'la 128 no toca la auditoría de supresión legada',
    );

    // La 117 queda EXENTA del barrido de arriba porque sí toca la cadena — y por eso su
    // límite se afirma explícitamente aquí, que es más fuerte que exentarla y callar.
    // Primero: tiene que existir. Si vuelve a desaparecer del repo, la exención se
    // quedaría vacía y este bloque dejaría de proteger nada en silencio; es exactamente
    // el drift que esta reconciliación cierra, así que se vigila.
    const MERGE_117 = '117_merge_candidate_into_existing_contact.sql';
    assert.ok(
      files.includes(MERGE_117),
      'la 117 está APLICADA en Producción: su fichero no puede faltar del repo',
    );
    // Segundo: la 117 toca la cadena SOLO como DML dentro de su función. No es dueña de
    // la forma de ninguna tabla —eso siguen siendo la 109/112 (staging) y la 114
    // (oficial)— y no roza la auditoría de supresión.
    const sql117 = readFileSync(join(repoRoot, 'supabase/migrations', MERGE_117), 'utf8');
    const executable117 = sql117
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    for (const forbidden of [
      'CREATE TABLE',
      'ALTER TABLE',
      'DROP TABLE',
      'CREATE INDEX',
      'CREATE TRIGGER',
      'TRUNCATE',
    ]) {
      assert.equal(
        new RegExp(forbidden, 'i').test(executable117),
        false,
        `la 117 no debe contener ${forbidden}: no es dueña de la forma de ninguna tabla`,
      );
    }
    assert.ok(
      !sql117.includes('phone_reveal_suppression_audit'),
      'la 117 no puede tocar la auditoría de supresión',
    );
  });

  it('la 110 no crea, altera ni borra ninguna tabla: solo una función', () => {
    const sql = readFileSync(
      join(repoRoot, 'supabase/migrations/110_persist_candidate_apollo_phone_reveal_result.sql'),
      'utf8',
    );
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    for (const forbidden of [
      'CREATE TABLE',
      'ALTER TABLE',
      'DROP TABLE',
      'CREATE INDEX',
      'CREATE TRIGGER',
      'TRUNCATE',
    ]) {
      assert.equal(
        new RegExp(forbidden, 'i').test(statements),
        false,
        `la 110 no debe contener ${forbidden}`,
      );
    }
  });

  it('la persistencia no arma SQL: invoca la función de la 110 y nada más', () => {
    const code = executable(sources[PERSISTENCE]);
    assert.equal(/CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE INDEX/i.test(code), false);
    // Exactamente UNA llamada, y a la función nombrada por su constante.
    assert.equal((code.match(/\.rpc\(/g) ?? []).length, 1, 'exactamente una llamada RPC');
    assert.match(code, /PERSIST_CANDIDATE_APOLLO_PHONE_REVEAL_RESULT_FN/);
    // Y ya no queda NINGUNA escritura suelta: eso es lo que hace la transacción
    // posible. Un `.insert()` sobreviviente sería un write fuera de ella.
    for (const write of ['.insert(', '.update(', '.upsert(', '.delete(']) {
      assert.equal(code.includes(write), false, `sin ${write} fuera de la transacción`);
    }
  });

  it('no hay backfill: nada recorre históricos ni reconstruye el pasado', () => {
    for (const file of NEW_FILES) {
      const code = executable(sources[file]);
      assert.equal(/backfill/i.test(code), false, `${file} sin backfill`);
    }
    // La persistencia solo habla de UN candidato: el que está escribiendo.
    const code = executable(sources[PERSISTENCE]);
    assert.match(code, /p_candidate_id: request\.candidateId/);
    // Y la función SQL toca UN candidato: el del parámetro. Se mira el SQL
    // EJECUTABLE, no los comentarios — que sí usan la palabra «backfill», porque
    // explicar por qué no hay backfill exige nombrarlo.
    const sql = readFileSync(
      join(repoRoot, 'supabase/migrations/110_persist_candidate_apollo_phone_reveal_result.sql'),
      'utf8',
    );
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    assert.equal(/backfill/i.test(statements), false, 'sin backfill en el SQL ejecutable');
    // Cada escritura está acotada al candidato o a una fila suya por id.
    assert.match(statements, /WHERE c\.id = p_candidate_id\s*\n\s*FOR UPDATE/);
    assert.match(statements, /UPDATE public\.contact_enrichment_candidates[\s\S]*WHERE id = p_candidate_id/);
    // Ningún UPDATE de la tabla canónica sin acotar a este candidato o a una fila.
    for (const clause of [...statements.matchAll(/UPDATE public\.contact_enrichment_candidate_phones[\s\S]{0,400}?;/g)]) {
      assert.ok(
        /candidate_id = p_candidate_id|id = v_primary_id/.test(clause[0]),
        'todo UPDATE de teléfonos queda acotado al candidato',
      );
    }
  });

  it('la 110 no se concede el DELETE ni el UPDATE que la 109 le niega', () => {
    const sql = readFileSync(
      join(repoRoot, 'supabase/migrations/110_persist_candidate_apollo_phone_reveal_result.sql'),
      'utf8',
    );
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    // SECURITY INVOKER es lo que mantiene el techo de la 109 en pie: la función no
    // puede borrar una fila de teléfono (borrar una fila borra un tombstone) ni
    // reescribir una procedencia.
    assert.match(statements, /SECURITY INVOKER/);
    assert.equal(/SECURITY DEFINER/.test(statements), false);
    assert.equal(
      /DELETE FROM public\.contact_enrichment_candidate_phones/i.test(statements),
      false,
      'borrar una fila borra un tombstone',
    );
    assert.equal(
      /UPDATE public\.contact_enrichment_candidate_phone_sources/i.test(statements),
      false,
      'una procedencia que su writer puede reescribir no es procedencia',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Alcanzabilidad: solo desde los dos caminos autorizados
// ═══════════════════════════════════════════════════════════════════

describe('4O-C — la captura solo es alcanzable desde webhook y recovery', () => {
  /** Todos los .ts/.tsx del repo, excluyendo tests y node_modules. */
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        sourceFiles(full, out);
        continue;
      }
      if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  const allSources = sourceFiles(join(repoRoot, 'src'));

  it('solo el webhook core y el recovery core construyen la captura', () => {
    const importers = allSources.filter((file) =>
      readFileSync(file, 'utf8').includes('buildApolloPhoneCollectionCapture'),
    );
    assert.deepEqual(
      importers.map((file) => file.replace(`${repoRoot}/`, '')).sort(),
      [
        'src/modules/contact-enrichment/apollo-phone-collection-capture.ts',
        'src/modules/contact-enrichment/phone-reveal-webhook-core.ts',
        'src/modules/contact-enrichment/phone-reveal-recovery-core.ts',
      ].sort(),
    );
  });

  it('solo el webhook route y las deps del recovery cablean el writer real', () => {
    const importers = allSources.filter((file) =>
      readFileSync(file, 'utf8').includes(
        "from '@/modules/contact-enrichment/candidate-phone-collection-persistence'",
      ) ||
      readFileSync(file, 'utf8').includes("from './candidate-phone-collection-persistence'"),
    );
    assert.deepEqual(
      importers.map((file) => file.replace(`${repoRoot}/`, '')).sort(),
      [
        'src/app/api/integrations/apollo/phone-reveal/webhook/route.ts',
        'src/modules/contact-enrichment/phone-reveal-recovery-deps.ts',
      ].sort(),
    );
  });

  it('la captura NO se cablea en el search/discovery de Apollo', () => {
    // El search también entrega teléfonos y también los pierde, pero capturarlos
    // NO está autorizado en este hito.
    const searchSurfaces = allSources.filter((file) =>
      /prospecting-toolkit|apollo-company|apollo-people|contact-normalizer/.test(file),
    );
    assert.ok(searchSurfaces.length > 0, 'debe haber superficies de search que revisar');
    for (const file of searchSurfaces) {
      const code = readFileSync(file, 'utf8');
      assert.equal(
        /apollo-phone-collection-capture|candidate-phone-collection/.test(code),
        false,
        `${file} no debe capturar la colección`,
      );
    }
  });

  it('la captura NO se cablea en el camino de CACHÉ', () => {
    // Un teléfono servido desde la caché no es una observación nueva del
    // proveedor; capturarlo como tal falsearía la procedencia.
    for (const file of ['phone-cache-core.ts', 'phone-cache-store.ts']) {
      const code = readFileSync(join(moduleDir, file), 'utf8');
      assert.equal(
        /apollo-phone-collection-capture|candidate-phone-collection/.test(code),
        false,
        `${file} no debe capturar la colección`,
      );
    }
  });

  it('el writer solo se invoca desde el camino terminal `revealed` de cada core', () => {
    for (const [name, code] of [
      ['webhook', webhookCore],
      ['recovery', recoveryCore],
    ] as const) {
      const calls = [...code.matchAll(/deps\.persistCandidatePhoneCollection\(/g)];
      assert.equal(calls.length, 1, `${name}: exactamente UNA invocación`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Privacidad estática
// ═══════════════════════════════════════════════════════════════════

describe('4O-C — privacidad', () => {
  it('los archivos nuevos no imprimen nada', () => {
    for (const file of NEW_FILES) {
      const code = executable(sources[file]);
      assert.equal(/console\.(log|warn|error|info|debug)/.test(code), false, file);
    }
  });

  it('ningún archivo nuevo contiene un teléfono, un correo ni un LinkedIn literal', () => {
    for (const file of NEW_FILES) {
      const code = sources[file];
      assert.equal(/'\+?\d{7,}'/.test(code), false, `${file} sin teléfono literal`);
      assert.equal(/linkedin\.com/i.test(code), false, `${file} sin LinkedIn`);
      assert.equal(/@[a-z0-9-]+\.[a-z]{2,}'/i.test(code), false, `${file} sin correo`);
    }
  });

  it('la metadata del usage-log se construye SOLO con el descriptor cerrado', () => {
    // Si algún camino armara `phone_collection` a mano, podría colar un número.
    for (const [name, code] of [
      ['webhook', webhookCore],
      ['recovery', recoveryCore],
    ] as const) {
      const assignments = [...code.matchAll(/phone_collection:\s*([A-Za-z.]+)/g)].map(
        (match) => match[1],
      );
      assert.ok(assignments.length > 0, `${name} debe registrar la colección`);
      for (const value of assignments) {
        assert.match(
          value,
          /^(describeCandidatePhoneCollectionWrite|collectionFields|args\.collectionFields)$/,
          `${name}: phone_collection solo del descriptor cerrado`,
        );
      }
    }
  });

  it('los cores no meten el número, el display ni la dedupe_key en la metadata', () => {
    for (const code of [webhookCore, recoveryCore]) {
      const metadataBlocks = [...code.matchAll(/metadata:\s*\{[\s\S]{0,1400}?\n\s{4,}\}/g)];
      assert.ok(metadataBlocks.length > 0);
      for (const [block] of metadataBlocks) {
        for (const forbidden of [
          'dedupeKey',
          'dedupe_key',
          'normalizedPhone',
          'displayPhone',
          'raw_number',
          'sanitized_number',
        ]) {
          assert.equal(
            block.includes(forbidden),
            false,
            `la metadata no debe llevar ${forbidden}`,
          );
        }
      }
    }
  });

  it('el descriptor cerrado devuelve solo cifras y banderas', () => {
    const code = executable(sources[WRITER]);
    const descriptor = code.match(
      /export function describeCandidatePhoneCollectionWrite[\s\S]*?\n\}/,
    );
    assert.ok(descriptor);
    for (const forbidden of ['normalizedPhone', 'displayPhone', 'dedupeKey']) {
      assert.equal(descriptor[0].includes(forbidden), false, `sin ${forbidden}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Compatibilidad con 4O-B
// ═══════════════════════════════════════════════════════════════════

describe('4O-C — no rompe el contrato de 4O-B', () => {
  it('el módulo de 4O-B sigue existiendo y sigue siendo la única fuente del ranking', () => {
    assert.ok(existsSync(join(moduleDir, 'phone-collection-core.ts')));
    const capture = executable(sources[CAPTURE]);
    // La captura no reescribe el ranking: lo importa.
    assert.match(capture, /from '\.\/phone-collection-core'/);
    assert.equal(
      /const [A-Z_]*RANKING[A-Z_]*\s*[:=]/.test(capture),
      false,
      'la captura no debe declarar un ranking propio',
    );
  });

  it('el discriminante es OPCIONAL: sin él la clave de 4O-B no cambia', () => {
    const core = readFileSync(join(moduleDir, 'phone-collection-core.ts'), 'utf8');
    assert.match(core, /observationDiscriminator\?:/);
    assert.match(core, /return discriminator \? `\$\{base\}:\$\{discriminator\}` : base;/);
  });
});
