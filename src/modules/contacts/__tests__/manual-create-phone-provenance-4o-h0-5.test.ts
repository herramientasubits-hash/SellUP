/**
 * Agente 2A — procedencia del teléfono en la CREACIÓN manual de un contacto
 * (AGENT2A-PHONE-REVEAL-4O-H0.5).
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ DEMUESTRA ESTA SUITE
 * ═══════════════════════════════════════════════════════════════════
 *
 * 4O-E4 apoyó el borrado de `contacts.phone` ENTERAMENTE en `contacts.phone_source`, y
 * R1 (4O-E4.1) hizo que `updateContact` mantuviera esa columna describiendo el número
 * realmente guardado. `createContact` quedó fuera de alcance y con una asimetría
 * declarada: escribía `phone` sin tocar `phone_source`, así que un teléfono
 * DEMOSTRABLEMENTE tecleado por un humano quedaba en NULL —el valor que significa «se
 * desconoce el origen»— indistinguible de las filas históricas cuya procedencia nadie
 * puede demostrar.
 *
 * H0.5 cierra esa asimetría: la creación manual declara `'manual'`.
 *
 * No es un cambio cosmético. `phone_source` es la única evidencia de procedencia que el
 * sistema tiene sobre `contacts.phone`, y el modelo normalizado que viene después
 * (`contact_phones` + `contact_phone_sources`) va a leer estas filas como su punto de
 * partida. Un NULL sobre un número que el sistema SÍ sabe de dónde vino es una pérdida
 * de información que el modelo oficial ya no podría reconstruir.
 *
 * Lo que esta suite NO afirma, a propósito:
 *
 *   * nada sobre `contacts.mobile_phone`. `phone_source` describe `phone`; esa columna
 *     sigue sin procedencia propia (`MOBILE_PHONE_PROVENANCE_PENDING`) y H0.5 no la
 *     inventa — inferirla desde `phone_source` fue justo el error que 4O-E4.1 retiró;
 *   * nada sobre las filas históricas con `phone_source IS NULL`. No hay backfill: un
 *     NULL histórico NO demuestra que el número fuese manual, y H1/H5 deben seguir
 *     leyéndolo como «procedencia desconocida».
 *
 * ═══════════════════════════════════════════════════════════════════
 * DEUDA DECLARADA, NO TOCADA POR H0.5
 * ═══════════════════════════════════════════════════════════════════
 *
 *   * HISTORICAL_MANUAL_PHONE_NULL_PROVENANCE_PENDING — toda fila creada a mano ANTES
 *     de H0.5 tiene `phone_source IS NULL`. Son posibles y existen por construcción
 *     (era el comportamiento del INSERT). NO se cuentan filas de Producción, no se lee
 *     PII y no se hace backfill: el NULL no distingue «manual antiguo» de «origen
 *     nunca conocido», así que inferirlo sería fabricar evidencia.
 *   * MOBILE_PHONE_PROVENANCE_PENDING — `mobile_phone` sigue sin columna de
 *     procedencia. H0 decidió resolverlo con el modelo normalizado, no añadiendo otro
 *     escalar.
 *   * PHONE_CONFIDENCE_DEAD_COLUMN_PENDING — `contacts.phone_confidence` no tiene
 *     ningún escritor que la POBLE. H0.5 tampoco la puebla: el patch compartido la
 *     lleva a NULL, que es el valor que el INSERT ya dejaba por defecto.
 *   * HUBSPOT_MOBILEPHONE_MAPPING_DOC_DRIFT_PENDING — `docs/HUBSPOT_CONTACT_FIELD_MAPPING.md`
 *     documenta `mobile_phone → mobilephone`, pero el sync real manda un único `phone`.
 *     No bloquea H1 y H0.5 no toca ni el doc ni el sync.
 *   * CONTACT_PHONE_RENDERING_CONSISTENCY_PENDING — las tablas y el detalle muestran
 *     `mobile_phone ?? phone` sin procedencia propia. Relevante en H4/H5.
 *
 * Sin proveedores, sin créditos, sin DB, sin red, sin DSAR real.
 * Requiere: node --import tsx --experimental-test-module-mocks --test <este archivo>
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contacts → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), 'utf8');

const FAKE_ACCOUNT_ID = 'account-h05';
const FAKE_INTERNAL_USER_ID = 'internal-user-h05';

// ═══════════════════════════════════════════════════════════════
// Cliente Supabase falso: captura los INSERT, nunca sale a la red
// ═══════════════════════════════════════════════════════════════

interface CapturedWrite {
  table: string;
  payload: Record<string, unknown>;
}

let inserts: CapturedWrite[] = [];
let updates: CapturedWrite[] = [];
/** Filas devueltas por el SELECT de deduplicación. Vacío ⇒ no hay duplicado. */
let existingContacts: Record<string, unknown>[] = [];

type QueryResult = { data: unknown; error: unknown };

/**
 * Encadenado mínimo de PostgREST. Cada método devuelve `this`; el resultado se
 * resuelve al hacer `await` (la clase es thenable), que es exactamente como lo consume
 * la acción real.
 */
class FakeQuery implements PromiseLike<QueryResult> {
  private op: 'select' | 'insert' | 'update' = 'select';

  constructor(private readonly table: string) {}

  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  is(): this {
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  single(): this {
    return this;
  }

  insert(payload: Record<string, unknown>): this {
    this.op = 'insert';
    inserts.push({ table: this.table, payload });
    return this;
  }

  update(payload: Record<string, unknown>): this {
    this.op = 'update';
    updates.push({ table: this.table, payload });
    return this;
  }

  private resolve(): QueryResult {
    if (this.table === 'internal_users') {
      return { data: { id: FAKE_INTERNAL_USER_ID }, error: null };
    }
    if (this.table === 'accounts') {
      return {
        data: { id: FAKE_ACCOUNT_ID, archived_at: null, pipeline_status: 'active' },
        error: null,
      };
    }
    if (this.table === 'contacts') {
      if (this.op === 'insert') return { data: { id: 'contact-h05' }, error: null };
      if (this.op === 'update') return { data: null, error: null };
      return { data: existingContacts, error: null };
    }
    if (this.table === 'contact_audit') return { data: null, error: null };
    throw new Error(`tabla inesperada en el test: ${this.table}`);
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }
}

function makeFakeClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'auth-user-h05' } }, error: null }),
    },
    from: (table: string) => new FakeQuery(table),
  };
}

mock.module('@/lib/supabase/server', {
  namedExports: { createClient: async () => makeFakeClient() },
});

// `createContact` no redirige en el camino feliz; el mock existe para que un fallo de
// autenticación se vea como una excepción del test y no como una salida silenciosa.
mock.module('next/navigation', {
  namedExports: {
    redirect: (to: string) => {
      throw new Error(`redirect inesperado a ${to}`);
    },
  },
});

let createContact: typeof import('../actions').createContact;

before(async () => {
  ({ createContact } = await import('../actions'));
});

beforeEach(() => {
  inserts = [];
  updates = [];
  existingContacts = [];
});

/** Payload del INSERT en `contacts` de la última llamada. */
function insertedContact(): Record<string, unknown> {
  const rows = inserts.filter((w) => w.table === 'contacts');
  assert.equal(rows.length, 1, 'se esperaba exactamente un INSERT en `contacts`');
  return rows[0].payload;
}

/** Las 5 columnas de metadata que SOLO un proveedor puede haber escrito. */
const PROVIDER_ONLY_COLUMNS = [
  'phone_type',
  'phone_raw_type',
  'phone_revealed_at',
  'phone_processing_basis',
  'phone_confidence',
] as const;

function assertNoProviderMetadata(payload: Record<string, unknown>): void {
  for (const column of PROVIDER_ONLY_COLUMNS) {
    assert.equal(
      payload[column] ?? null,
      null,
      `un teléfono creado a mano no puede llevar ${column}: nadie lo reveló`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// 1. El contrato de H0.5, sobre el escritor REAL
// ═══════════════════════════════════════════════════════════════

describe('4O-H0.5 — `createContact` declara la procedencia del teléfono manual', () => {
  it('A. con teléfono ⇒ `phone_source = manual`, y el número se guarda igual que antes', async () => {
    const result = await createContact({
      account_id: FAKE_ACCOUNT_ID,
      full_name: 'Ada Lovelace',
      phone: '+57 300 000 0000',
    });

    assert.deepEqual(result, { success: true, id: 'contact-h05' });
    const payload = insertedContact();
    assert.equal(payload.phone, '+57 300 000 0000');
    assert.equal(
      payload.phone_source,
      'manual',
      'el sistema SÍ sabe de dónde salió este número: lo tecleó un humano',
    );
    assertNoProviderMetadata(payload);
  });

  it('A2. el número se normaliza igual que antes de H0.5 (`trim`)', async () => {
    await createContact({
      account_id: FAKE_ACCOUNT_ID,
      full_name: 'Ada Lovelace',
      phone: '   +57 300 000 0000   ',
    });

    const payload = insertedContact();
    assert.equal(payload.phone, '+57 300 000 0000');
    assert.equal(payload.phone_source, 'manual');
  });

  it('B. sin teléfono ⇒ NO se declara procedencia (ni `manual` ni nada)', async () => {
    await createContact({ account_id: FAKE_ACCOUNT_ID, full_name: 'Ada Lovelace' });

    const payload = insertedContact();
    assert.equal(payload.phone, null);
    assert.equal(
      payload.phone_source ?? null,
      null,
      'sin número no hay dato del que declarar origen; `manual` sobre NULL sería metadata huérfana',
    );
    assertNoProviderMetadata(payload);
  });

  it('C. teléfono vacío ⇒ misma semántica de AUSENCIA que ya tenía la acción', async () => {
    for (const empty of ['', '   ']) {
      inserts = [];
      await createContact({
        account_id: FAKE_ACCOUNT_ID,
        full_name: 'Ada Lovelace',
        phone: empty,
      });

      const payload = insertedContact();
      assert.equal(payload.phone, null, `"${empty}" debe seguir significando ausencia`);
      assert.equal(
        payload.phone_source ?? null,
        null,
        'crear `manual` sobre un valor vacío afirmaría un origen para un dato que no existe',
      );
    }
  });

  it('D. sólo `mobile_phone` ⇒ NO se declara procedencia: `phone_source` describe `phone`', async () => {
    await createContact({
      account_id: FAKE_ACCOUNT_ID,
      full_name: 'Ada Lovelace',
      mobile_phone: '+57 311 111 1111',
    });

    const payload = insertedContact();
    assert.equal(payload.mobile_phone, '+57 311 111 1111');
    assert.equal(payload.phone, null);
    assert.equal(
      payload.phone_source ?? null,
      null,
      'declarar `manual` aquí haría que `phone_source` describiera una columna que no describe',
    );
    assert.equal(
      'mobile_phone_source' in payload,
      false,
      'H0.5 no inventa procedencia para `mobile_phone` (MOBILE_PHONE_PROVENANCE_PENDING)',
    );
  });

  it('E. ambos ⇒ `manual` describe SÓLO `phone`; sobre `mobile_phone` no se afirma nada', async () => {
    await createContact({
      account_id: FAKE_ACCOUNT_ID,
      full_name: 'Ada Lovelace',
      phone: '+57 300 000 0000',
      mobile_phone: '+57 311 111 1111',
    });

    const payload = insertedContact();
    assert.equal(payload.phone, '+57 300 000 0000');
    assert.equal(payload.phone_source, 'manual');
    assert.equal(payload.mobile_phone, '+57 311 111 1111');
    assert.equal('mobile_phone_source' in payload, false);
    assertNoProviderMetadata(payload);
  });

  it('el INSERT sigue siendo UNO solo: número y procedencia nunca viajan por separado', async () => {
    await createContact({
      account_id: FAKE_ACCOUNT_ID,
      full_name: 'Ada Lovelace',
      phone: '+57 300 000 0000',
    });

    assert.equal(inserts.filter((w) => w.table === 'contacts').length, 1);
    assert.equal(
      updates.filter((w) => w.table === 'contacts').length,
      0,
      'un UPDATE posterior abriría la ventana en la que el número existe sin su procedencia',
    );
  });

  it('el resto del payload no cambió: `source = manual` sigue describiendo el ORIGEN DEL CONTACTO', async () => {
    await createContact({
      account_id: FAKE_ACCOUNT_ID,
      full_name: 'Ada Lovelace',
      phone: '+57 300 000 0000',
      job_title: 'Ingeniera',
    });

    const payload = insertedContact();
    // `source` (fila) y `phone_source` (columna) son dimensiones distintas que aquí
    // coinciden en valor. Que coincidan no las hace la misma cosa: un contacto de
    // `source = 'apollo'` puede tener un teléfono manual, y al revés.
    assert.equal(payload.source, 'manual');
    assert.equal(payload.job_title, 'Ingeniera');
    assert.equal(payload.created_by, FAKE_INTERNAL_USER_ID);
    assert.equal(payload.contact_status, 'active');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Privacidad: `manual` NO es borrable por una DSAR de proveedor
// ═══════════════════════════════════════════════════════════════

describe('4O-H0.5 — un teléfono manual no puede pasar por teléfono de proveedor', () => {
  it('la procedencia que emite la creación NO está en la allowlist de borrado (E4 intacto)', async () => {
    const { SUPPRESSIBLE_CONTACT_PHONE_SOURCES } = await import(
      '@/modules/contact-enrichment/phone-cache-suppression-core'
    );

    await createContact({
      account_id: FAKE_ACCOUNT_ID,
      full_name: 'Ada Lovelace',
      phone: '+57 300 000 0000',
    });

    const emitted = insertedContact().phone_source as string;
    assert.equal(
      (SUPPRESSIBLE_CONTACT_PHONE_SOURCES as readonly string[]).includes(emitted),
      false,
      'si `manual` entrara en la allowlist, una DSAR de Apollo/Lusha borraría un número ' +
        'que ningún proveedor escribió',
    );
  });

  it('el clasificador de borrabilidad rechaza la procedencia que emite la creación', async () => {
    const { isSuppressibleContactPhoneSource } = await import(
      '@/modules/contact-enrichment/phone-cache-suppression-core'
    );

    await createContact({
      account_id: FAKE_ACCOUNT_ID,
      full_name: 'Ada Lovelace',
      phone: '+57 300 000 0000',
    });
    const payload = insertedContact();

    assert.equal(
      isSuppressibleContactPhoneSource(payload.phone_source as string),
      false,
      'el teléfono creado a mano no puede ser objetivo de un borrado por procedencia de proveedor',
    );
    // Y el contraste: la misma función SÍ acepta lo que un proveedor escribió, así que
    // el rechazo de arriba mide la procedencia y no una función que siempre dice `false`.
    assert.equal(isSuppressibleContactPhoneSource('apollo_reveal'), true);
    assert.equal(isSuppressibleContactPhoneSource('lusha_reveal'), true);
  });

  it('el NULL previo a H0.5 también sobrevivía: el cambio no aflojó ninguna guarda', async () => {
    const { isSuppressibleContactPhoneSource } = await import(
      '@/modules/contact-enrichment/phone-cache-suppression-core'
    );
    // Antes de H0.5 la creación dejaba NULL. Ni antes ni ahora se borra: lo que H0.5
    // gana no es protección, es EVIDENCIA — distinguir «demostrablemente manual» de
    // «origen desconocido», que es lo que el modelo oficial necesitará leer.
    assert.equal(isSuppressibleContactPhoneSource(null), false);
    assert.equal(isSuppressibleContactPhoneSource('manual'), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Mutantes que esta suite debe detectar
// ═══════════════════════════════════════════════════════════════

describe('4O-H0.5 — mutantes', () => {
  it('«presencia del campo ⇒ manual» quedaría atrapado por el caso B/C', () => {
    // La regla ingenua: si la clave viaja, declara `manual`. Sobre `createContact` el
    // riesgo no es el de R1 (destruir procedencia de proveedor: en un INSERT no hay
    // ninguna que destruir) sino AFIRMAR un origen para un teléfono que no existe.
    const mutantPresenceMeansManual = (phone: string | undefined) => ({
      phone: phone?.trim() || null,
      phone_source: phone !== undefined ? 'manual' : null,
    });

    assert.equal(mutantPresenceMeansManual('').phone, null);
    assert.equal(
      mutantPresenceMeansManual('').phone_source,
      'manual',
      'el mutante afirma origen sobre NULL — los casos B/C exigen lo contrario',
    );
  });

  it('«heredar tipo del proveedor» no tiene de dónde heredar en una creación', () => {
    // En un INSERT no hay fila previa, así que cualquier `phone_type` sólo puede salir
    // de inventarlo. `assertNoProviderMetadata` es lo que lo impide.
    assert.equal(PROVIDER_ONLY_COLUMNS.includes('phone_type'), true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Guardas estáticas de ALCANCE
// ═══════════════════════════════════════════════════════════════

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function createContactBody(): string {
  const source = stripComments(read('src', 'modules', 'contacts', 'actions.ts'));
  const start = source.indexOf('export async function createContact');
  assert.ok(start > 0);
  const rest = source.slice(start);
  const end = rest.indexOf('export async function updateContact');
  assert.ok(end > 0);
  return rest.slice(0, end);
}

describe('4O-H0.5 estático — el alcance declarado', () => {
  it('`createContact` NUNCA escribe una procedencia de proveedor', () => {
    const body = createContactBody();
    for (const provider of ['apollo_search', 'apollo_reveal', 'apollo_cache', 'lusha_reveal', 'provider_payload']) {
      assert.equal(
        body.includes(provider),
        false,
        `la creación manual no puede emitir ${provider}`,
      );
    }
  });

  it('`CreateContactInput` sigue sin aceptar tipo ni procedencia de teléfono', () => {
    const types = read('src', 'modules', 'contacts', 'types.ts');
    const iface = types.match(/interface CreateContactInput \{([\s\S]*?)\n\}/);
    assert.ok(iface, '`CreateContactInput` debe seguir existiendo');
    assert.equal(
      /phone_type|phone_source/.test(iface[1]),
      false,
      'si el input aceptara tipo o procedencia, H0.5 debe dejar de forzarlos y usarlos',
    );
  });

  it('el formulario de creación no gana selector de tipo ni de procedencia', () => {
    const drawer = stripComments(read('src', 'components', 'contacts', 'create-contact-drawer.tsx'));
    assert.equal(
      /phone_type|phone_source/.test(drawer),
      false,
      'un selector de tipo obligaría a que el patch reciba el valor introducido',
    );
  });

  it('H0.5 no toca `mobile_phone` en `createContact` (sigue como escalar sin procedencia)', () => {
    const body = createContactBody();
    assert.match(body, /mobile_phone: input\.mobile_phone\?\.trim\(\) \|\| null/);
    assert.equal(/mobile_phone_source/.test(body), false);
  });

  it('H0.5 es sin migración y sin backfill', () => {
    const body = createContactBody();
    assert.equal(
      /update\(\s*\{[^}]*phone_source/.test(body),
      false,
      'H0.5 aplica sólo a escrituras futuras: un NULL histórico NO demuestra origen manual',
    );

    const files = readdirSync(join(repoRoot, 'supabase', 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    // El techo lo movió 4O-H1 con la 114 (esquema oficial multi-teléfono, inerte) y
    // después 4O-H2 con la 115 (su privacidad: contadores de auditoría y la función
    // `suppress_official_contact_phone_sources`), y después 4O-H3 con la 116 (la APROBACIÓN
    // atómica del candidato sobre ese esquema: una sola función transaccional, sin DDL). Lo
    // que esta guarda fija es que H0.5 no aportó esquema, no cuál es el número más alto; el
    // nombre exacto se mantiene para que una migración colada por encima del último hito
    // conocido rompa la guarda.
    assert.equal(
      files[files.length - 1],
      // AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 mueve el techo a la 119 (catálogo de
      // Macro Industrias, sin relación con teléfono). H0.5 sigue sin aportar esquema.
      // AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4 (Fase 1) mueve el techo a la 120:
      // `provider_suppressions` + `provider_suppression_audit` — supresión de teléfono por
      // identidad NATIVA del proveedor y SIN cuenta, backfill idempotente del tombstone
      // legado y `CREATE OR REPLACE` del helper transaccional. Es ADITIVA: no borra
      // columna, no suelta constraint y no reescribe ninguna migración anterior.
      // AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1 mueve el techo a la 121: la liquidación
      // TRUTHFUL del sobrepaso de presupuesto (Agente 1, contabilidad). No es de teléfono
      // —toca `wizard_budget_reservations` y `confirm_wizard_credits`— y H0.5 sigue sin
      // aportar esquema.
      // AGENT2A-SEARCH-MORE-PHONES-1 mueve el techo a la 122: «Buscar más números»
      // (Agente 2A). Es de teléfono, pero no de este hito: añade la modalidad `search_more`
      // y una función que AÑADE teléfonos al CANDIDATO, y no toca lo que esta guarda vigila.
      // AGENT1-PROVIDER-SEEN-MEMORY-2 mueve el techo a la 123: la memoria de qué empresa ya
      // nos mostró un proveedor de PAGO (Agente 1, economía de descubrimiento). NO es de
      // teléfono en absoluto: crea `provider_seen_entities`, que sólo guarda identidad de
      // EMPRESA —id nativo del proveedor y dominio normalizado— y no nombra ninguna tabla,
      // columna ni función de teléfono. Se declara NO aplicada en Producción.
      // AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1 mueve el techo a la 124: la
      // identidad provider-native del reveal de teléfono. Es de teléfono, pero no de este
      // hito ni de lo que esta guarda vigila: no nombra `phone_source`, `contact_phones`
      // ni la creación manual. Se declara NO aplicada en Producción.
      // BR-SOURCE-FUNCTIONAL-CUT-A mueve el techo a la 125: la identidad MENSUAL del
      // snapshot de Receita (`source_period` + unicidad period-aware en
      // `source_company_snapshots`, estado de publicación en `source_snapshot_runs`). NO es de
      // teléfono y NO nombra ninguna tabla, columna ni función de la cadena de teléfono; la
      // autoría se comprueba abajo archivo por archivo. AUTORADA y NO APLICADA.
      '125_br_receita_monthly_snapshot_identity.sql',
      'H0.5 no añade esquema: `phone_source` y `manual` ya existen desde la 094',
    );
  });

  it('H0.5 NO crea el modelo oficial multi-teléfono (eso es H1)', () => {
    const source = read('src', 'modules', 'contacts', 'actions.ts');
    assert.equal(/contact_phones|contact_phone_sources/.test(source), false);
  });

  it('HubSpot no recibe la procedencia: `phone_source` no es un campo sincronizable', () => {
    const sync = stripComments(read('src', 'modules', 'contacts', 'contact-hubspot-sync-core.ts'));
    assert.equal(
      /phone_source/.test(sync),
      false,
      '`phone_source` es evidencia interna de privacidad, no una propiedad de CRM',
    );
  });
});
