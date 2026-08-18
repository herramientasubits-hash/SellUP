/**
 * Tests — SUPRESIÓN NATIVA DEL PROVEEDOR, independiente de la cuenta
 * (Agente 2A · AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4, Fase 1)
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ PRUEBA ESTE ARCHIVO
 * ═══════════════════════════════════════════════════════════════════
 *
 * La resolución de identidad y la decisión de los cuatro gates, en el nivel donde son
 * PURAS y por tanto medibles sin base de datos ni proveedor:
 *
 *   §1  identidad de Apollo — orden histórico intacto, validador de 24 hex intacto;
 *   §2  identidad de Lusha — nativa, sin traducción y sin regex inventada;
 *   §3  la CUENTA no participa en la identidad, en NINGUNA combinación;
 *   §4  `checkProviderSuppression` — clear / suppressed / check_unavailable, fail-closed;
 *   §5  la evaluación de los gates — sin cuenta NO es fallo de privacidad;
 *   §6  fan-out del §11: identidades que UN MISMO registro declara, sin inferencia;
 *   §7  ratchets de seguridad (§24 del hito): la cuenta no es prerrequisito, Lusha no
 *       enruta por Apollo, y no hay matching difuso en ninguna capa;
 *   §8  ratchet de la Fase 2: NO se implementó sujeto compartido entre proveedores.
 *
 * Puro y offline: sin red, sin Supabase, sin proveedores, sin reloj, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  checkProviderSuppression,
  evaluatePhoneRevealSuppression,
  evaluateProviderSuppressionRecord,
  isSuppressionProvider,
  PROVIDER_SUPPRESSION_PROVIDERS,
  resolveAllPhoneRevealProviderIdentities,
  resolveInFlightProviderIdentity,
  resolvePhoneRevealProviderIdentity,
  type PhoneRevealSuppressionLookupKey,
} from '../provider-suppression-core';
import { resolvePhoneCachePersonId } from '../phone-cache-core';

const HERE = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const readRepo = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const APOLLO_ID = '0123456789abcdef01234567';
const APOLLO_ID_2 = 'fedcba9876543210fedcba98';
const LUSHA_ID = 'v1.eyJhIjoiYiIsImMiOiJkIn0';
const ACCOUNT = '11111111-2222-3333-4444-555555555555';
const NOW = '2026-08-18T10:00:00.000Z';

/** Quita comentarios para medir CAPACIDAD, no documentación. */
const code = (raw: string) =>
  raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ═══════════════════════════════════════════════════════════════
// §1. Identidad de APOLLO — el orden histórico no se movió
// ═══════════════════════════════════════════════════════════════

describe('§1 — identidad de Apollo: orden y validador históricos intactos', () => {
  it('el id del payload gana a la columna y al source_contact_id', () => {
    assert.deepEqual(
      resolvePhoneRevealProviderIdentity({
        payloadApolloPersonId: APOLLO_ID,
        apolloPersonId: APOLLO_ID_2,
        source: 'apollo',
        sourceContactId: APOLLO_ID_2,
      }),
      { provider: 'apollo', providerPersonId: APOLLO_ID },
    );
  });

  it('la columna apollo_person_id gana al source_contact_id', () => {
    assert.deepEqual(
      resolvePhoneRevealProviderIdentity({
        apolloPersonId: APOLLO_ID,
        source: 'apollo',
        sourceContactId: APOLLO_ID_2,
      }),
      { provider: 'apollo', providerPersonId: APOLLO_ID },
    );
  });

  it('source_contact_id sólo se reenvía cuando el candidato es de origen Apollo', () => {
    assert.deepEqual(
      resolvePhoneRevealProviderIdentity({
        apolloPersonId: null,
        source: 'apollo',
        sourceContactId: APOLLO_ID,
      }),
      { provider: 'apollo', providerPersonId: APOLLO_ID },
    );
  });

  it('un id de Lusha NUNCA se acepta como id de Apollo (validador de 24 hex)', () => {
    // Ni en la columna propia…
    assert.notEqual(
      resolvePhoneRevealProviderIdentity({
        apolloPersonId: LUSHA_ID,
        source: 'apollo',
        sourceContactId: null,
      })?.provider,
      'apollo',
    );
    // …ni desde el payload.
    assert.equal(
      resolvePhoneRevealProviderIdentity({
        payloadApolloPersonId: LUSHA_ID,
        apolloPersonId: null,
        source: 'apollo',
        sourceContactId: null,
      }),
      null,
    );
  });

  it('un candidato de origen Apollo con id inválido no obtiene NINGUNA identidad', () => {
    // Y en particular NO cae a la rama de Lusha: `source` manda.
    assert.equal(
      resolvePhoneRevealProviderIdentity({
        apolloPersonId: null,
        source: 'apollo',
        sourceContactId: 'no-es-un-object-id',
      }),
      null,
    );
  });

  it('PARIDAD: donde el resolutor histórico daba un id, la Fase 1 da provider=apollo con ESE id', () => {
    const IDS = [
      null,
      '',
      '   ',
      APOLLO_ID,
      APOLLO_ID.toUpperCase(),
      LUSHA_ID,
      'no-es-un-object-id',
      '0123456789abcdef0123456',
      '0123456789abcdef012345678',
    ];
    const SOURCES = [null, 'apollo', 'APOLLO', 'lusha', 'hubspot', 'manual'];
    let checked = 0;
    for (const apolloPersonId of IDS) {
      for (const sourceContactId of IDS) {
        for (const source of SOURCES) {
          const legacy = resolvePhoneCachePersonId({
            apolloPersonId,
            sourceProvider: source,
            sourceContactId,
          });
          const next = resolvePhoneRevealProviderIdentity({
            apolloPersonId,
            source,
            sourceContactId,
          });
          if (legacy) {
            assert.deepEqual(
              next,
              { provider: 'apollo', providerPersonId: legacy },
              `la identidad de Apollo cambió en {${apolloPersonId}, ${sourceContactId}, ${source}}`,
            );
          }
          checked += 1;
        }
      }
    }
    assert.equal(checked, IDS.length * IDS.length * SOURCES.length);
  });
});

// ═══════════════════════════════════════════════════════════════
// §2. Identidad de LUSHA — nativa, sin traducción
// ═══════════════════════════════════════════════════════════════

describe('§2 — identidad nativa de Lusha', () => {
  it('un candidato de Lusha usa su source_contact_id TAL CUAL', () => {
    assert.deepEqual(
      resolvePhoneRevealProviderIdentity({
        apolloPersonId: null,
        source: 'lusha',
        sourceContactId: LUSHA_ID,
      }),
      { provider: 'lusha', providerPersonId: LUSHA_ID },
    );
  });

  it('el id de Lusha no se valida contra ningún formato inventado', () => {
    // El proveedor es dueño de la forma de su identificador. Una regex escrita aquí sólo
    // podría RECHAZAR identidades legítimas y devolver el caso al fail-closed.
    for (const raw of ['v1.abc', 'contact_9182', '42', 'v2.nuevo-formato']) {
      assert.deepEqual(
        resolvePhoneRevealProviderIdentity({
          apolloPersonId: null,
          source: 'lusha',
          sourceContactId: raw,
        }),
        { provider: 'lusha', providerPersonId: raw },
      );
    }
  });

  it('sin source_contact_id (o en blanco) un candidato de Lusha NO tiene identidad', () => {
    for (const raw of [null, '', '   ']) {
      assert.equal(
        resolvePhoneRevealProviderIdentity({
          apolloPersonId: null,
          source: 'lusha',
          sourceContactId: raw,
        }),
        null,
      );
    }
  });

  it('Apollo tiene PRECEDENCIA: con las dos identidades gana Apollo', () => {
    assert.deepEqual(
      resolvePhoneRevealProviderIdentity({
        apolloPersonId: APOLLO_ID,
        source: 'lusha',
        sourceContactId: LUSHA_ID,
      }),
      { provider: 'apollo', providerPersonId: APOLLO_ID },
    );
  });

  it('un origen sin supresión propia no produce identidad (allowlist cerrada)', () => {
    for (const source of ['hubspot', 'manual', 'tavily', null]) {
      assert.equal(
        resolvePhoneRevealProviderIdentity({
          apolloPersonId: null,
          source,
          sourceContactId: 'algo-que-parece-un-id',
        }),
        null,
      );
    }
  });

  it('la allowlist de proveedores es exactamente apollo y lusha', () => {
    assert.deepEqual([...PROVIDER_SUPPRESSION_PROVIDERS], ['apollo', 'lusha']);
    assert.equal(isSuppressionProvider('apollo'), true);
    assert.equal(isSuppressionProvider('lusha'), true);
    for (const other of ['hubspot', 'APOLLO', '', null, undefined, 3]) {
      assert.equal(isSuppressionProvider(other), false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// §3. La CUENTA no participa en la identidad
// ═══════════════════════════════════════════════════════════════

describe('§3 — la cuenta no entra en la resolución de identidad', () => {
  it('la firma de resolución no acepta cuenta (comprobado sobre el código)', () => {
    const src = code(readRepo('src/modules/contact-enrichment/provider-suppression-core.ts'));
    const block = src.match(/export interface ProviderIdentityInput \{([\s\S]*?)\n\}/);
    assert.ok(block, 'no se encontró ProviderIdentityInput');
    assert.equal(/accountId/.test(block[1]), false, 'la identidad no puede llevar cuenta');
  });

  it('`checkProviderSuppression` no menciona cuenta en absoluto', () => {
    const src = code(readRepo('src/modules/contact-enrichment/provider-suppression-core.ts'));
    const start = src.indexOf('export async function checkProviderSuppression');
    assert.notEqual(start, -1);
    const body = src.slice(start, src.indexOf('\n}', start));
    assert.equal(/accountId/.test(body), false);
  });

  it('`ProviderSuppressionIdentity` tiene exactamente provider + providerPersonId', () => {
    const src = code(readRepo('src/modules/contact-enrichment/provider-suppression-core.ts'));
    const block = src.match(/export interface ProviderSuppressionIdentity \{([\s\S]*?)\n\}/);
    assert.ok(block);
    assert.equal(/accountId/.test(block[1]), false);
    assert.match(block[1], /provider:/);
    assert.match(block[1], /providerPersonId:/);
  });
});

// ═══════════════════════════════════════════════════════════════
// §4. checkProviderSuppression — la lectura canónica
// ═══════════════════════════════════════════════════════════════

describe('§4 — checkProviderSuppression: fail-closed en los dos modos de fallo', () => {
  const identity = { provider: 'apollo' as const, providerPersonId: APOLLO_ID };

  it('sin fila ⇒ clear', async () => {
    assert.equal(
      await checkProviderSuppression({ identity, lookup: async () => null }),
      'clear',
    );
  });

  it('con suppressed_at ⇒ suppressed', async () => {
    assert.equal(
      await checkProviderSuppression({
        identity,
        lookup: async () => ({ suppressedAt: NOW }),
      }),
      'suppressed',
    );
  });

  it('dep NO cableada ⇒ check_unavailable (nunca clear)', async () => {
    assert.equal(await checkProviderSuppression({ identity }), 'check_unavailable');
  });

  it('la lectura LANZA ⇒ check_unavailable, y NUNCA propaga la excepción', async () => {
    assert.equal(
      await checkProviderSuppression({
        identity,
        lookup: async () => {
          throw new Error(`permission denied for relation with ${APOLLO_ID}`);
        },
      }),
      'check_unavailable',
    );
  });

  it('la clave que recibe la lectura NO lleva cuenta', async () => {
    const keys: unknown[] = [];
    await checkProviderSuppression({
      identity,
      lookup: async (key) => {
        keys.push(key);
        return null;
      },
    });
    assert.deepEqual(keys, [{ provider: 'apollo', providerPersonId: APOLLO_ID }]);
  });

  it('una identidad mal formada NO se degrada a clear (defensa en profundidad)', async () => {
    for (const bad of [
      { provider: 'apollo' as const, providerPersonId: '   ' },
      { provider: 'hubspot' as never, providerPersonId: APOLLO_ID },
    ]) {
      assert.equal(
        await checkProviderSuppression({ identity: bad, lookup: async () => null }),
        'check_unavailable',
      );
    }
  });

  it('una fila sin suppressed_at no es una supresión', () => {
    assert.equal(evaluateProviderSuppressionRecord(null), 'not_suppressed');
    assert.equal(evaluateProviderSuppressionRecord({ suppressedAt: null }), 'not_suppressed');
    assert.equal(evaluateProviderSuppressionRecord({ suppressedAt: '  ' }), 'not_suppressed');
    assert.equal(evaluateProviderSuppressionRecord({ suppressedAt: NOW }), 'suppressed');
  });
});

// ═══════════════════════════════════════════════════════════════
// §5. La evaluación de los CUATRO gates
// ═══════════════════════════════════════════════════════════════

describe('§5 — evaluatePhoneRevealSuppression: la cuenta no es un fallo de privacidad', () => {
  const apollo = { provider: 'apollo' as const, providerPersonId: APOLLO_ID };
  const lusha = { provider: 'lusha' as const, providerPersonId: LUSHA_ID };

  it('CASO 1 — Apollo, pre-aprobación, SIN cuenta, clear ⇒ alcanzable', async () => {
    const keys: PhoneRevealSuppressionLookupKey[] = [];
    const result = await evaluatePhoneRevealSuppression({
      identity: apollo,
      accountId: null,
      lookup: async (key) => {
        keys.push(key);
        return null;
      },
    });
    assert.deepEqual(result, { kind: 'allowed' });
    assert.equal(keys.length, 1, 'la consulta SÍ ocurre sin cuenta');
    assert.equal(keys[0].accountId, null);
  });

  it('CASO 2 — Lusha, pre-aprobación, SIN cuenta, clear ⇒ alcanzable', async () => {
    const keys: PhoneRevealSuppressionLookupKey[] = [];
    const result = await evaluatePhoneRevealSuppression({
      identity: lusha,
      accountId: null,
      lookup: async (key) => {
        keys.push(key);
        return null;
      },
    });
    assert.deepEqual(result, { kind: 'allowed' });
    assert.equal(keys[0].provider, 'lusha');
    assert.equal(keys[0].providerPersonId, LUSHA_ID);
  });

  it('CASO 3 — la falta de cuenta, POR SÍ SOLA, no produce ningún estado de bloqueo', async () => {
    for (const accountId of [null, undefined, '', '   ']) {
      const result = await evaluatePhoneRevealSuppression({
        identity: apollo,
        accountId,
        lookup: async () => null,
      });
      assert.deepEqual(result, { kind: 'allowed' }, `bloqueó con accountId=${accountId}`);
    }
  });

  it('CASO 4 — Apollo suprimido ⇒ blocked_suppressed', async () => {
    assert.deepEqual(
      await evaluatePhoneRevealSuppression({
        identity: apollo,
        lookup: async () => ({ suppressedAt: NOW }),
      }),
      { kind: 'blocked_suppressed' },
    );
  });

  it('CASO 5 — Lusha suprimido ⇒ blocked_suppressed', async () => {
    assert.deepEqual(
      await evaluatePhoneRevealSuppression({
        identity: lusha,
        lookup: async () => ({ suppressedAt: NOW }),
      }),
      { kind: 'blocked_suppressed' },
    );
  });

  it('CASO 6 — la lectura no disponible ⇒ check_unavailable, con el mensaje REDACTADO', async () => {
    const noDep = await evaluatePhoneRevealSuppression({ identity: apollo });
    assert.equal(noDep.kind, 'check_unavailable');

    const threw = await evaluatePhoneRevealSuppression({
      identity: apollo,
      lookup: async () => {
        throw new Error(`detail: key (provider_person_id)=(${APOLLO_ID}) conflicts`);
      },
      redactError: () => 'redactado',
    });
    assert.deepEqual(threw, { kind: 'check_unavailable', message: 'redactado' });
  });

  it('CASO 6 bis — sin redactor inyectado el mensaje por defecto NO revela nada', async () => {
    const threw = await evaluatePhoneRevealSuppression({
      identity: apollo,
      lookup: async () => {
        throw new Error(`key (provider_person_id)=(${APOLLO_ID})`);
      },
    });
    assert.equal(threw.kind, 'check_unavailable');
    assert.equal(
      JSON.stringify(threw).includes(APOLLO_ID),
      false,
      'el default no puede filtrar el identificador',
    );
  });

  it('CASO 7 — sin identidad nativa ⇒ not_evaluable (fail-closed, 0 lecturas)', async () => {
    let called = 0;
    const result = await evaluatePhoneRevealSuppression({
      identity: null,
      accountId: ACCOUNT,
      lookup: async () => {
        called += 1;
        return null;
      },
    });
    assert.deepEqual(result, {
      kind: 'not_evaluable',
      reason: 'missing_provider_person_id',
    });
    assert.equal(called, 0, 'sin identidad no se consulta nada');
  });

  it('`missing_account_id` YA NO puede salir de la evaluación', async () => {
    // Se barre toda la matriz de cuentas contra las dos identidades posibles.
    for (const identity of [apollo, lusha]) {
      for (const accountId of [null, undefined, '', '  ', ACCOUNT]) {
        for (const record of [null, { suppressedAt: NOW }]) {
          const result = await evaluatePhoneRevealSuppression({
            identity,
            accountId,
            lookup: async () => record,
          });
          assert.notEqual(
            JSON.stringify(result).includes('missing_account_id'),
            true,
          );
        }
      }
    }
  });

  it('la cuenta viaja a la clave SÓLO como dato para la mitad legada', async () => {
    const keys: PhoneRevealSuppressionLookupKey[] = [];
    await evaluatePhoneRevealSuppression({
      identity: apollo,
      accountId: ACCOUNT,
      lookup: async (key) => {
        keys.push(key);
        return null;
      },
    });
    assert.deepEqual(keys, [
      { provider: 'apollo', providerPersonId: APOLLO_ID, accountId: ACCOUNT },
    ]);
  });

  it('`resolveInFlightProviderIdentity` es el mismo resolutor con el id del payload', () => {
    assert.deepEqual(
      resolveInFlightProviderIdentity({
        payloadPersonId: APOLLO_ID,
        candidateApolloPersonId: null,
        candidateSource: 'lusha',
        candidateSourceContactId: LUSHA_ID,
      }),
      { provider: 'apollo', providerPersonId: APOLLO_ID },
    );
    assert.deepEqual(
      resolveInFlightProviderIdentity({
        payloadPersonId: null,
        candidateApolloPersonId: null,
        candidateSource: 'lusha',
        candidateSourceContactId: LUSHA_ID,
      }),
      { provider: 'lusha', providerPersonId: LUSHA_ID },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// §6. Fan-out del §11 — identidades del MISMO registro
// ═══════════════════════════════════════════════════════════════

describe('§6 — fan-out por identidades declaradas en el MISMO registro', () => {
  it('un candidato con las DOS identidades declara las dos, Apollo primero', () => {
    assert.deepEqual(
      resolveAllPhoneRevealProviderIdentities({
        apolloPersonId: APOLLO_ID,
        source: 'lusha',
        sourceContactId: LUSHA_ID,
      }),
      [
        { provider: 'apollo', providerPersonId: APOLLO_ID },
        { provider: 'lusha', providerPersonId: LUSHA_ID },
      ],
    );
  });

  it('un candidato con una sola identidad declara una sola', () => {
    assert.deepEqual(
      resolveAllPhoneRevealProviderIdentities({
        apolloPersonId: APOLLO_ID,
        source: 'apollo',
        sourceContactId: APOLLO_ID,
      }),
      [{ provider: 'apollo', providerPersonId: APOLLO_ID }],
    );
    assert.deepEqual(
      resolveAllPhoneRevealProviderIdentities({
        apolloPersonId: null,
        source: 'lusha',
        sourceContactId: LUSHA_ID,
      }),
      [{ provider: 'lusha', providerPersonId: LUSHA_ID }],
    );
  });

  it('sin identidades declara la lista VACÍA (nunca una inventada)', () => {
    assert.deepEqual(
      resolveAllPhoneRevealProviderIdentities({
        apolloPersonId: null,
        source: 'hubspot',
        sourceContactId: null,
      }),
      [],
    );
  });

  it('no deduce identidades de un proveedor a partir de OTRO registro', () => {
    // La entrada es UNA fila. No hay parámetro por el que pudiera llegar un segundo
    // candidato, y por tanto no hay forma de emparejar dos registros distintos.
    const src = code(
      readRepo('src/modules/contact-enrichment/provider-suppression-core.ts'),
    );
    const start = src.indexOf('export function resolveAllPhoneRevealProviderIdentities');
    const body = src.slice(start, src.indexOf('\n}', start));
    for (const forbidden of ['email', 'linkedin', 'firstName', 'lastName', 'domain', 'company']) {
      assert.equal(
        new RegExp(forbidden, 'i').test(body),
        false,
        `el fan-out no puede mirar ${forbidden}`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// §7. RATCHETS de seguridad (§24 del hito)
// ═══════════════════════════════════════════════════════════════

describe('§7 — ratchets de seguridad', () => {
  const CORE = 'src/modules/contact-enrichment/provider-suppression-core.ts';
  const STORE = 'src/modules/contact-enrichment/provider-suppression-store.ts';
  const MIGRATION = 'supabase/migrations/120_provider_native_phone_suppression.sql';

  it('la identidad de Lusha NO se resuelve pasando por la de Apollo', () => {
    const src = code(readRepo(CORE));
    const start = src.indexOf('export function resolvePhoneRevealProviderIdentity');
    const body = src.slice(start, src.indexOf('\n}', start));
    // La rama de Lusha devuelve el valor CRUDO; no lo pasa por `normalizeApolloPersonId`.
    const lushaBranch = body.slice(body.indexOf("source === 'lusha'"));
    assert.equal(
      /normalizeApolloPersonId/.test(lushaBranch),
      false,
      'un id de Lusha no puede pasar por el validador de Apollo',
    );
    assert.match(lushaBranch, /provider: 'lusha'/);
  });

  it('la lectura nativa no filtra por cuenta y la tabla no tiene esa columna', () => {
    const src = code(readRepo(STORE));
    const start = src.indexOf('export async function readProviderSuppression');
    const body = src.slice(start, src.indexOf('\n}', start));
    assert.equal(/account/i.test(body), false, 'la lectura nativa no toca la cuenta');
    assert.match(body, /\.eq\('provider',/);
    assert.match(body, /\.eq\('provider_person_id',/);
  });

  it('provider_suppressions NO tiene columna de cuenta, FK a accounts ni cascada', () => {
    const sql = readRepo(MIGRATION);
    const table = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS public.provider_suppressions'),
      sql.indexOf('-- ── THE key decision of this migration'),
    );
    assert.equal(/account_id/.test(table), false, 'no puede haber columna de cuenta');
    assert.equal(/accounts\(id\)/.test(table), false, 'no puede haber FK a accounts');
    assert.equal(/ON DELETE CASCADE/.test(table), false, 'no puede haber cascada');
  });

  it('provider_suppression_audit NO tiene columna de cuenta, FK a accounts ni cascada', () => {
    const sql = readRepo(MIGRATION);
    const table = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS public.provider_suppression_audit'),
      sql.indexOf('CREATE INDEX IF NOT EXISTS provider_suppression_audit_subject_idx'),
    );
    assert.equal(/account_id/.test(table), false);
    assert.equal(/accounts\(id\)/.test(table), false);
    assert.equal(/ON DELETE CASCADE/.test(table), false);
  });

  it('la clave única es (provider, provider_person_id) y nada más', () => {
    const sql = readRepo(MIGRATION);
    const idx = sql.match(
      /CREATE UNIQUE INDEX IF NOT EXISTS provider_suppressions_provider_person_key\s*\n\s*ON public\.provider_suppressions \(([^)]*)\)/,
    );
    assert.ok(idx, 'no se encontró el índice único');
    assert.deepEqual(
      idx[1].split(',').map((c) => c.trim()),
      ['provider', 'provider_person_id'],
    );
  });

  it('el SQL helper del nuevo modelo toma DOS argumentos y ninguno es cuenta', () => {
    const sql = readRepo(MIGRATION);
    const fn = sql.match(
      /CREATE OR REPLACE FUNCTION public\.provider_suppression_exists\(([\s\S]*?)\)\s*\nRETURNS boolean/,
    );
    assert.ok(fn, 'no se encontró provider_suppression_exists');
    assert.equal(/account/i.test(fn[1]), false);
    assert.match(fn[1], /p_provider\s+text/);
    assert.match(fn[1], /p_provider_person_id\s+text/);
  });

  it('la auditoría nativa nunca guarda el identificador en claro', () => {
    const sql = readRepo(MIGRATION);
    const table = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS public.provider_suppression_audit'),
      sql.indexOf('CREATE INDEX IF NOT EXISTS provider_suppression_audit_subject_idx'),
    );
    assert.match(table, /provider_person_id_hash\s+text\s+NOT NULL/);
    // Sólo la columna hasheada; no existe una columna con el id crudo.
    assert.equal(
      /^\s*provider_person_id\s+text/m.test(table),
      false,
      'la auditoría no puede guardar el id crudo (sólo la columna _hash)',
    );
    // Y no hay columna de teléfono. Se mide sobre el SQL SIN comentarios: la cabecera de
    // la tabla habla de «phone suppression», que es documentación, no una columna.
    const columns = table
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    assert.equal(/phone/i.test(columns), false);
  });

  it('ni el core ni el store hacen matching difuso', () => {
    for (const rel of [CORE, STORE]) {
      const src = code(readRepo(rel));
      for (const forbidden of ['email', 'linkedin', 'firstName', 'lastName']) {
        assert.equal(
          new RegExp(forbidden, 'i').test(src),
          false,
          `${rel} no puede conocer ${forbidden}`,
        );
      }
    }
  });

  it('el core es PURO: sin red, sin Supabase, sin env, sin reloj', () => {
    const src = code(readRepo(CORE));
    assert.equal(/\bfetch\s*\(/.test(src), false);
    assert.equal(/supabase/i.test(src), false);
    assert.equal(/process\.env/.test(src), false);
    assert.equal(/new Date\(|Date\.now\(/.test(src), false);
    assert.equal(/console\./.test(src), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// §8. RATCHET de la Fase 2 — NO se implementó el sujeto compartido
// ═══════════════════════════════════════════════════════════════

describe('§8 — la Fase 2 NO está implementada, y eso se declara', () => {
  it('no existe tabla ni concepto de sujeto de privacidad compartido', () => {
    const sql = readRepo('supabase/migrations/120_provider_native_phone_suppression.sql');
    for (const forbidden of [
      'privacy_subjects',
      'privacy_subject_provider_aliases',
      'linkedin',
      'email',
    ]) {
      assert.equal(
        new RegExp(`CREATE TABLE[^;]*${forbidden}`, 'i').test(sql),
        false,
        `la 120 no puede crear ${forbidden}`,
      );
    }
  });

  it('una supresión de Apollo NO se convierte en una de Lusha (ni al contrario)', async () => {
    // El almacén sólo conoce la supresión de (apollo, APOLLO_ID). Preguntar por la
    // identidad de Lusha del MISMO humano no la encuentra — y ESO es el límite declarado
    // de la Fase 1, no un defecto.
    const store = new Map<string, string>([[`apollo::${APOLLO_ID}`, NOW]]);
    const lookup = async (key: PhoneRevealSuppressionLookupKey) => {
      const at = store.get(`${key.provider}::${key.providerPersonId}`);
      return at ? { suppressedAt: at } : null;
    };

    assert.deepEqual(
      await evaluatePhoneRevealSuppression({
        identity: { provider: 'apollo', providerPersonId: APOLLO_ID },
        lookup,
      }),
      { kind: 'blocked_suppressed' },
      'Apollo suprimido ⇒ Apollo bloqueado (garantía de la Fase 1)',
    );
    assert.deepEqual(
      await evaluatePhoneRevealSuppression({
        identity: { provider: 'lusha', providerPersonId: LUSHA_ID },
        lookup,
      }),
      { kind: 'allowed' },
      'la Fase 1 NO promete bloqueo cruzado: eso es Fase 2',
    );
  });

  it('el módulo declara explícitamente ese límite', () => {
    const src = readRepo('src/modules/contact-enrichment/provider-suppression-core.ts');
    assert.match(src, /Fase 2/);
    assert.match(src, /NO es un sujeto de privacidad GLOBAL/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// §9. CAMINO DE ESCRITURA (§11 del hito)
// ═══════════════════════════════════════════════════════════════
//
// La acción de supresión es `'use server'` y hace I/O real contra Supabase, así que lo
// que aquí se puede medir sin base de datos es su ESTRUCTURA — y da la casualidad de que
// las propiedades que importan son estructurales: en qué ORDEN escribe, si audita
// siempre, y si la evidencia lleva PII. El comportamiento contra PostgreSQL vive en la
// suite hermana `provider-native-suppression-postgres-p0-identity-4.test.ts`.

describe('§9 — la acción de supresión registra el modelo NUEVO, y lo hace primero', () => {
  const ACTION = 'src/modules/contact-enrichment/phone-cache-suppression-actions.ts';

  it('la supresión NATIVA se escribe ANTES del tombstone legado de la caché', () => {
    const src = readRepo(ACTION);
    const nativeAt = src.indexOf('await recordProviderSuppression({');
    const legacyAt = src.indexOf('.from(PHONE_REVEAL_CACHE_TABLE)');
    assert.notEqual(nativeAt, -1, 'la acción debe registrar la supresión nativa');
    assert.notEqual(legacyAt, -1);
    assert.ok(
      nativeAt < legacyAt,
      'de las dos escrituras de bloqueo, la que bloquea EN TODAS PARTES va primero: si ' +
        'fuera al revés y fallara, la persona quedaría revelable desde cualquier otra ' +
        'cuenta con una supresión que parece completa',
    );
  });

  it('la identidad de la primera escritura es la del REQUEST, no una deducida', () => {
    const src = code(readRepo(ACTION));
    const call = src.slice(src.indexOf('await recordProviderSuppression({'));
    const firstCall = call.slice(0, call.indexOf('});') + 3);
    assert.match(firstCall, /provider: PHONE_CACHE_PROVIDER/);
    assert.match(firstCall, /providerPersonId: tombstone\.providerPersonId/);
  });

  it('cada identidad registrada deja evidencia durable, incluso si la escritura FALLÓ', () => {
    const src = code(readRepo(ACTION));
    const start = src.indexOf('const recordProviderSuppression =');
    const body = src.slice(start, src.indexOf('\n  };', start));
    // La auditoría NO está dentro de una rama de éxito.
    assert.match(body, /insertProviderSuppressionAudit\(\{/);
    const auditAt = body.indexOf('insertProviderSuppressionAudit');
    const returnAt = body.indexOf('return;', body.indexOf('insertProviderSuppression('));
    assert.ok(
      returnAt === -1 || auditAt < returnAt,
      'ningún `return` temprano puede saltarse la evidencia',
    );
    // Y `failed` es un resultado auditable, no un camino silencioso.
    assert.match(body, /'failed'/);
  });

  it('un fallo del modelo nuevo tiene su PROPIO código, distinto del legado', () => {
    const src = readRepo(ACTION);
    assert.match(src, /provider_suppression_failed/);
    const core = readRepo('src/modules/contact-enrichment/phone-cache-suppression-core.ts');
    assert.match(core, /\| 'provider_suppression_failed'/);
    // Y no reemplaza al del legado: los dos existen.
    assert.match(core, /\| 'cache_tombstone_failed'/);
  });

  it('el fan-out del §11 recorre las identidades del MISMO candidato', () => {
    const src = code(readRepo(ACTION));
    assert.match(src, /resolveAllPhoneRevealProviderIdentities\(\{/);
    const start = src.indexOf('for (const candidate of candidates) {');
    assert.notEqual(start, -1);
    const body = src.slice(start, src.indexOf('\n  }', start));
    // Las columnas que alimentan el fan-out vienen de la FILA del candidato.
    assert.match(body, /apolloPersonId: candidate\.apolloPersonId/);
    assert.match(body, /source: candidate\.source/);
    assert.match(body, /sourceContactId: candidate\.sourceContactId/);
    // Y no hay ninguna señal difusa en ese bucle.
    for (const forbidden of ['email', 'linkedin', 'firstName', 'lastName', 'organizationName']) {
      assert.equal(
        new RegExp(forbidden, 'i').test(body),
        false,
        `el fan-out no puede mirar ${forbidden}`,
      );
    }
  });

  it('la evidencia nativa NO lleva el id crudo, ni cuenta, ni teléfono', () => {
    const src = code(readRepo(ACTION));
    const start = src.indexOf('const audited = await insertProviderSuppressionAudit({');
    const body = src.slice(start, src.indexOf('});', start));
    assert.match(body, /providerPersonIdHash: hashProviderPersonId\(/);
    assert.equal(
      /providerPersonId:/.test(body),
      false,
      'la evidencia no puede llevar el identificador en claro',
    );
    assert.equal(
      /accountId|account_id/.test(body),
      false,
      'la evidencia no puede reatarse a una cuenta: no tiene tenant a propósito',
    );
    assert.equal(/phone/i.test(body), false);
  });

  it('reafirmar una supresión existente NO mueve su suppressed_at hacia adelante', () => {
    const store = code(
      readRepo('src/modules/contact-enrichment/provider-suppression-store.ts'),
    );
    const start = store.indexOf('export async function insertProviderSuppression');
    const body = store.slice(start, store.indexOf('\n}', start));
    assert.match(body, /ignoreDuplicates: true/);
    assert.match(body, /onConflict: 'provider,provider_person_id'/);
    // Y «ya existía» se reporta como éxito, no como fallo.
    assert.match(body, /kind: 'already_present'/);
  });

  it('los conteos nativos se reportan APARTE de los legados', () => {
    const core = readRepo('src/modules/contact-enrichment/phone-cache-suppression-core.ts');
    for (const field of [
      'providerSuppressionsCreated',
      'providerSuppressionsAlreadyPresent',
      'providerSuppressionsByProvider',
      'providerSuppressionAuditPersisted',
    ]) {
      assert.match(core, new RegExp(field), `falta ${field} en el resultado`);
    }
    // `auditPersisted` (legado) sigue existiendo y NO se fusiona con el nuevo: la
    // auditoría legada cascadea con la cuenta y la nueva no, así que sumarlas ocultaría
    // cuál de las dos evidencias falta.
    assert.match(core, /auditPersisted: boolean;/);
  });
});

// ═══════════════════════════════════════════════════════════════
// §10. Separación CACHÉ ↔ PRIVACIDAD (§6 del hito)
// ═══════════════════════════════════════════════════════════════

describe('§10 — la caché sigue siendo de cuenta; la privacidad ya no', () => {
  it('la unicidad de phone_reveal_cache NO se tocó para que la privacidad funcione', () => {
    // Cambiar la clave de una caché de reutilización para arreglar la privacidad habría
    // resuelto un problema rompiendo un contrato de GASTO. La 120 no la toca.
    const sql = readRepo('supabase/migrations/120_provider_native_phone_suppression.sql');
    assert.equal(
      /ALTER TABLE[^;]*phone_reveal_cache/i.test(sql),
      false,
      'la 120 no puede alterar la tabla de caché',
    );
    assert.equal(
      /DROP INDEX[^;]*phone_reveal_cache/i.test(sql),
      false,
      'la 120 no puede tocar los índices de la caché',
    );
    assert.equal(
      /DELETE FROM[^;]*phone_reveal_cache/i.test(sql),
      false,
      'la 120 no borra ninguna fila legada',
    );
  });

  it('el alcance de reutilización de la caché sigue siendo same_account', () => {
    const cacheCore = readRepo('src/modules/contact-enrichment/phone-cache-core.ts');
    assert.match(cacheCore, /PHONE_CACHE_REUSE_SCOPE = 'same_account'/);
    // Y la clave de la caché sigue exigiendo cuenta y país.
    const block = cacheCore.match(/export interface PhoneCacheLookupKey \{([\s\S]*?)\n\}/);
    assert.ok(block);
    assert.match(block[1], /accountId: string;/);
    assert.match(block[1], /countryCode: string;/);
  });

  it('la lectura COMPUESTA omite el legado sin cuenta, y no lo convierte en bloqueo', () => {
    const store = code(
      readRepo('src/modules/contact-enrichment/provider-suppression-store.ts'),
    );
    const start = store.indexOf('export async function readPhoneRevealSuppression');
    const body = store.slice(start, store.indexOf('\n}', start));
    // El nativo se consulta SIEMPRE y primero.
    assert.ok(
      body.indexOf('readProviderSuppression(') < body.indexOf('readPhoneCacheSuppression('),
      'el modelo nativo se consulta primero',
    );
    // Y sin cuenta se devuelve el resultado nativo, no un error.
    assert.match(body, /if \(!accountId \|\| key\.provider !== PHONE_CACHE_PROVIDER\) return native;/);
  });

  it('el legado sólo se consulta para Apollo: la caché tiene CHECK (provider = apollo)', () => {
    const sql = readRepo('supabase/migrations/099_apollo_phone_reveal_cache.sql');
    assert.match(sql, /CHECK \(provider IN \('apollo'\)\)/);
  });
});
