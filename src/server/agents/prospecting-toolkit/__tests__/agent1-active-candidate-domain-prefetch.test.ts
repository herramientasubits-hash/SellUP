/**
 * AGENT1-ACTIVE-CANDIDATE-DOMAIN-CANONICALIZATION — ADDENDUM (RECUPERACIÓN).
 *
 * La corrección anterior arregló la COMPARACIÓN dentro de la guarda: las dos
 * caras del dominio pasan por `normalizeDomain` antes de compararse. Pero
 * comparar no sirve de nada si la fila nunca se recupera, y el prefetch seguía
 * pidiéndole a la base igualdad EXACTA contra el dominio canónico:
 *
 *     consulta:    une.com.co        (canónica)
 *     persistida:  www.une.com.co    (tal cual la entregó el proveedor)
 *     → la fila no se recupera → la guarda nunca la ve → eje FUERTE perdido
 *
 * En el primer lote vivo el defecto quedó TAPADO porque las mismas filas
 * volvían por el prefetch por PAÍS. Esa cobertura es accidental: exige que el
 * histórico sea del mismo país y que quepa en las 500 filas SIN ORDEN de ese
 * eje. La identidad de dominio es GLOBAL y no puede depender de ninguna de las
 * dos cosas.
 *
 * ── Contrato REAL auditado en Producción ────────────────────────────────────
 *
 * `prospect_candidates`, 289 filas (262 con dominio):
 *
 *     domain ILIKE 'www.%'                       70
 *     domain sin 'www.'                         192
 *     con protocolo / path / querystring          0
 *     con mayúsculas / espacios / punto final     0
 *     con '@' inicial / sin punto                 0
 *
 * `internexa.com` y `softwareone.com` guardan HOY las DOS formas para el mismo
 * dominio canónico. Por eso el conjunto de variantes de búsqueda es exactamente
 * dos —canónica y `www.` + canónica— y no se inventan formas que la base nunca
 * ha escrito.
 *
 * ── Fidelidad del arnés (esto es lo que hacía falta) ────────────────────────
 *
 * 🔴 El doble de Supabase de la suite anterior devolvía TODAS las filas
 * sembradas ignorando `.in('domain', …)`. Con ese doble, un prefetch roto pasa
 * la prueba: el filtro que falla en Producción no existe en el arnés. El doble
 * de ESTA suite filtra como Postgres —igualdad EXACTA de cadena en `in`, `eq`
 * por país, `limit` como ventana sin orden— y además REGISTRA qué consulta
 * devolvió qué IDs, de modo que «lo recuperó el eje de dominio» sea una
 * afirmación verificada y no una suposición.
 *
 * Vuelve a canonical-only (`.in('domain', batchDomains)`) y A/B/C, las cinco
 * vivas, las seis ocultas y la paridad pre-writer/writer se ponen ROJAS.
 *
 * 0 proveedores, 0 créditos, 0 Producción, 0 escrituras, 0 red, 0 migraciones.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  fetchActiveCandidatesForGuard,
  buildActiveGuardDomainLookupVariants,
} from '../candidate-writer';
import {
  checkActiveCandidateDuplicate,
  type ActiveCandidateRecord,
} from '../active-candidate-identity-guard';
import { isStrongActiveGuardReason, isWeakActiveGuardReason } from '../strong-identity-duplicate-match';
import { normalizeDomain } from '../normalization';

// ─── Doble de Supabase FIEL al filtrado de Postgres ───────────────────────────

type DbRow = {
  id: string;
  name: string;
  domain: string | null;
  normalized_name: string | null;
  metadata: Record<string, unknown>;
  status: string;
  country_code: string | null;
};

/** Una consulta resuelta: qué filtros llevaba y qué IDs devolvió. */
type QueryLog = {
  inFilters: Record<string, readonly string[]>;
  eqFilters: Record<string, string>;
  limit: number | null;
  returnedIds: string[];
};

type FilteringClient = {
  client: SupabaseClient;
  queries: QueryLog[];
  /** ¿Hubo una consulta con filtro `domain` que devolviera esta fila? */
  retrievedByDomain(id: string): boolean;
  /** ¿Hubo una consulta con filtro `country_code` que devolviera esta fila? */
  retrievedByCountry(id: string): boolean;
  /** Formas de dominio que el prefetch pidió a la base (o null si no consultó). */
  requestedDomainForms(): readonly string[] | null;
};

function makeFilteringClient(rows: readonly DbRow[]): FilteringClient {
  const queries: QueryLog[] = [];

  function makeBuilder() {
    const inFilters: Record<string, readonly string[]> = {};
    const eqFilters: Record<string, string> = {};
    let limitValue: number | null = null;

    function resolve() {
      // Igualdad EXACTA de cadena, como Postgres. Nada de normalizar aquí: el
      // arnés no debe arreglar lo que la base no arregla.
      let out = rows.filter((row) => {
        for (const [column, allowed] of Object.entries(inFilters)) {
          const value = (row as unknown as Record<string, unknown>)[column];
          if (typeof value !== 'string' || !allowed.includes(value)) return false;
        }
        for (const [column, expected] of Object.entries(eqFilters)) {
          if ((row as unknown as Record<string, unknown>)[column] !== expected) return false;
        }
        return true;
      });
      // `limit` sin `order` = ventana ARBITRARIA. Se modela como las primeras N
      // en orden de inserción, que es el peor caso realista.
      if (limitValue != null) out = out.slice(0, limitValue);
      queries.push({
        inFilters: { ...inFilters },
        eqFilters: { ...eqFilters },
        limit: limitValue,
        returnedIds: out.map((r) => r.id),
      });
      return Promise.resolve({ data: out.map((r) => ({ ...r })), error: null });
    }

    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.in = (column: string, values: readonly string[]) => {
      inFilters[column] = [...values];
      return builder;
    };
    builder.eq = (column: string, value: string) => {
      eqFilters[column] = value;
      return builder;
    };
    builder.limit = (n: number) => {
      limitValue = n;
      return resolve();
    };
    return builder;
  }

  const client = {
    from(table: string) {
      if (table !== 'prospect_candidates') throw new Error(`tabla no simulada: ${table}`);
      return makeBuilder();
    },
  } as unknown as SupabaseClient;

  return {
    client,
    queries,
    retrievedByDomain: (id) =>
      queries.some((q) => q.inFilters['domain'] !== undefined && q.returnedIds.includes(id)),
    retrievedByCountry: (id) =>
      queries.some((q) => q.eqFilters['country_code'] !== undefined && q.returnedIds.includes(id)),
    requestedDomainForms: () =>
      queries.find((q) => q.inFilters['domain'] !== undefined)?.inFilters['domain'] ?? null,
  };
}

let rowSeq = 0;
function activeRow(overrides: Partial<DbRow> = {}): DbRow {
  rowSeq += 1;
  return {
    id: `row-${rowSeq}`,
    name: 'Empresa',
    domain: null,
    normalized_name: null,
    metadata: {},
    status: 'needs_review',
    country_code: 'CO',
    ...overrides,
  };
}

/** Ejecuta la guarda compartida sobre lo que el prefetch REALMENTE recuperó. */
function guardOver(
  records: readonly ActiveCandidateRecord[],
  input: { name: string; domain: string | null; normalizedName?: string | null },
) {
  return checkActiveCandidateDuplicate(
    {
      name: input.name,
      domain: input.domain,
      normalizedName: input.normalizedName ?? null,
      inferredCompanyName: null,
    },
    [...records],
  );
}

// ─── § 4 · el constructor de variantes ────────────────────────────────────────

describe('§ 4 · buildActiveGuardDomainLookupVariants — el conjunto MÍNIMO', () => {
  test('canónica + `www.` canónica, y nada más', () => {
    assert.deepEqual(
      buildActiveGuardDomainLookupVariants(['une.com.co']).sort(),
      ['une.com.co', 'www.une.com.co'],
    );
  });

  test('una entrada YA con `www.` produce el MISMO par (se canonicaliza primero)', () => {
    // Hace falta porque los llamadores NO son homogéneos: el runner de Apollo
    // canonicaliza antes de llamar y el writer pasa `candidate.domain` crudo.
    assert.deepEqual(
      buildActiveGuardDomainLookupVariants(['www.une.com.co']).sort(),
      ['une.com.co', 'www.une.com.co'],
    );
  });

  test('NO inventa formas que la base nunca ha escrito', () => {
    const variants = buildActiveGuardDomainLookupVariants([
      'https://une.com.co/contacto?x=1',
      'UNE.com.co',
    ]);
    // Producción: 0 filas con protocolo, path, querystring o mayúsculas.
    assert.deepEqual(variants.sort(), ['une.com.co', 'www.une.com.co']);
    for (const v of variants) {
      assert.ok(!v.includes('://'), `no debe emitir protocolo: ${v}`);
      assert.ok(!v.includes('/'), `no debe emitir path: ${v}`);
      assert.ok(!v.includes('?'), `no debe emitir querystring: ${v}`);
      assert.equal(v, v.toLowerCase(), `no debe emitir mayúsculas: ${v}`);
    }
  });

  test('deduplica: las dos formas del mismo dominio piden UN solo par', () => {
    assert.equal(
      buildActiveGuardDomainLookupVariants(['une.com.co', 'www.une.com.co']).length,
      2,
    );
  });

  test('lo que la autoridad rechaza NO ensancha la consulta', () => {
    assert.deepEqual(
      buildActiveGuardDomainLookupVariants([
        null,
        undefined,
        '',
        '   ',
        'localhost',
        '192.168.0.1',
        'sinpunto',
      ]),
      [],
    );
  });
});

// ─── A · canónica pedida, `www.` persistida ───────────────────────────────────

describe('A · dominio canónico en la consulta, `www.` en la base', () => {
  test('la fila histórica se recupera POR EL EJE DE DOMINIO', async () => {
    const historical = activeRow({ name: 'EPM', domain: 'www.une.com.co', country_code: 'CO' });
    const db = makeFilteringClient([historical]);

    // countryCode = null → el eje de PAÍS no se consulta siquiera. Si la fila
    // aparece, sólo puede haberla traído el eje de dominio.
    const out = await fetchActiveCandidatesForGuard(db.client, ['une.com.co'], null);

    assert.equal(out.status, 'ok');
    assert.equal(out.records.length, 1, 'la fila `www.` DEBE recuperarse');
    assert.equal(out.records[0].id, historical.id);
    assert.ok(db.retrievedByDomain(historical.id), 'prefetched_by_domain');
    assert.ok(!db.retrievedByCountry(historical.id), 'sin ayuda del eje de país');
    assert.deepEqual(
      [...(db.requestedDomainForms() ?? [])].sort(),
      ['une.com.co', 'www.une.com.co'],
    );
  });

  test('y la guarda la cierra como duplicado FUERTE', async () => {
    const historical = activeRow({ name: 'EPM', domain: 'www.une.com.co' });
    const db = makeFilteringClient([historical]);
    const out = await fetchActiveCandidatesForGuard(db.client, ['une.com.co'], null);

    const match = guardOver(out.records, { name: 'EPM', domain: 'une.com.co' });
    assert.equal(match.matched, true);
    assert.equal(match.reason, 'same_active_domain');
    assert.ok(isStrongActiveGuardReason(match.reason));
  });

  test('simétrico: `www.` pedida, canónica persistida (las dos formas existen en Prod)', async () => {
    // `internexa.com` y `softwareone.com` guardan HOY las dos formas.
    const historical = activeRow({ name: 'InterNexa', domain: 'internexa.com' });
    const db = makeFilteringClient([historical]);
    const out = await fetchActiveCandidatesForGuard(db.client, ['www.internexa.com'], null);
    assert.equal(out.records.length, 1);
    assert.ok(db.retrievedByDomain(historical.id));
  });
});

// ─── B · independencia de PAÍS ────────────────────────────────────────────────

describe('B · la identidad de dominio es GLOBAL', () => {
  test('candidato CO contra histórico MX con el mismo dominio canónico → FUERTE', async () => {
    const historical = activeRow({
      name: 'Globant',
      domain: 'www.globant.com',
      country_code: 'MX',
    });
    const db = makeFilteringClient([historical]);

    const out = await fetchActiveCandidatesForGuard(db.client, ['globant.com'], 'CO');

    assert.equal(out.records.length, 1, 'el eje de dominio NO puede exigir igualdad de país');
    assert.ok(db.retrievedByDomain(historical.id), 'prefetched_by_domain');
    assert.ok(!db.retrievedByCountry(historical.id), 'el eje de país lo excluye por MX');

    const match = guardOver(out.records, { name: 'Globant', domain: 'globant.com' });
    assert.equal(match.reason, 'same_active_domain');
    assert.ok(isStrongActiveGuardReason(match.reason));
  });

  test('la consulta de dominio no lleva filtro de país', async () => {
    const db = makeFilteringClient([]);
    await fetchActiveCandidatesForGuard(db.client, ['globant.com'], 'CO');
    const domainQuery = db.queries.find((q) => q.inFilters['domain'] !== undefined);
    assert.ok(domainQuery, 'debe existir la consulta por dominio');
    assert.equal(domainQuery.eqFilters['country_code'], undefined, 'COUNTRY_INDEPENDENT');
  });
});

// ─── C · independencia del tope 500 ───────────────────────────────────────────

describe('C · el eje FUERTE no puede depender del tope del eje de país', () => {
  test('con >500 activos en el país, el histórico fuera de la ventana se recupera igual', async () => {
    // 600 filas CO de relleno con dominios que NO coinciden. La coincidente se
    // inserta AL FINAL, así que la ventana `limit(500)` sin orden la excluye.
    const filler = Array.from({ length: 600 }, (_, i) =>
      activeRow({ name: `Relleno ${i}`, domain: `relleno-${i}.com.co`, country_code: 'CO' }),
    );
    const historical = activeRow({ name: 'ETB', domain: 'www.etb.com', country_code: 'CO' });
    const db = makeFilteringClient([...filler, historical]);

    const out = await fetchActiveCandidatesForGuard(db.client, ['etb.com'], 'CO');

    assert.ok(out.truncatedAxes.includes('country'), 'el eje de país se trunca y debe ser visible');
    assert.ok(db.retrievedByDomain(historical.id), 'LIMIT_500_INDEPENDENT');
    assert.ok(
      !db.retrievedByCountry(historical.id),
      'control: la ventana de país NO lo trae, así que la prueba no pasa por el otro eje',
    );
    assert.ok(out.records.some((r) => r.id === historical.id));

    const match = guardOver(out.records, { name: 'ETB', domain: 'etb.com' });
    assert.equal(match.reason, 'same_active_domain');
  });
});

// ─── D · unión deduplicada por ID DURABLE ─────────────────────────────────────

describe('D · una fila hallada por los DOS caminos aparece una vez', () => {
  test('sin duplicar, y sin que el camino cambie su fuerza', async () => {
    const historical = activeRow({ name: 'ETB', domain: 'www.etb.com', country_code: 'CO' });
    const db = makeFilteringClient([historical]);

    const out = await fetchActiveCandidatesForGuard(db.client, ['etb.com'], 'CO');

    assert.ok(db.retrievedByDomain(historical.id), 'la trae el eje de dominio');
    assert.ok(db.retrievedByCountry(historical.id), 'y también el eje de país');
    assert.equal(out.records.length, 1, 'RESULTS_DEDUPED_BY_ID');
    assert.equal(new Set(out.records.map((r) => r.id)).size, out.records.length);

    const match = guardOver(out.records, { name: 'ETB', domain: 'etb.com' });
    assert.equal(match.reason, 'same_active_domain', 'la fuerza no depende del camino');
  });
});

// ─── E · el eje DÉBIL de nombre no cambia (CUT-L7) ────────────────────────────

describe('E · dominios canónicos DISTINTOS + mismo nombre → sólo DÉBIL', () => {
  test('no se convierte en `same_active_domain`', async () => {
    const historical = activeRow({
      name: 'Andina Software',
      domain: 'www.andina-software.com.co',
      normalized_name: 'andina software',
      country_code: 'CO',
    });
    const db = makeFilteringClient([historical]);

    // Dominio genuinamente distinto: la ampliación de variantes NO debe traerlo
    // por el eje de dominio.
    const out = await fetchActiveCandidatesForGuard(db.client, ['andinasoftware.io'], 'CO');
    assert.ok(!db.retrievedByDomain(historical.id), 'el eje de dominio NO debe traerlo');
    assert.ok(db.retrievedByCountry(historical.id), 'llega por el eje de país, como antes');

    const match = guardOver(out.records, {
      name: 'Andina Software',
      domain: 'andinasoftware.io',
      normalizedName: 'andina software',
    });
    assert.equal(match.matched, true);
    assert.notEqual(match.reason, 'same_active_domain', 'un nombre igual no funda dominio igual');
    assert.ok(isWeakActiveGuardReason(match.reason), 'CUT-L7: el nombre sigue siendo DÉBIL');
  });

  test('`www.` no colapsa dos dominios REALMENTE distintos', async () => {
    // `www.acme.com` y `acme.com.co` comparten prefijo pero no identidad.
    const historical = activeRow({ name: 'Acme', domain: 'www.acme.com', country_code: 'CO' });
    const db = makeFilteringClient([historical]);
    const out = await fetchActiveCandidatesForGuard(db.client, ['acme.com.co'], null);
    assert.equal(out.records.length, 0, 'no puede haber igualdad por prefijo');
    const match = guardOver(out.records, { name: 'Acme Colombia', domain: 'acme.com.co' });
    assert.equal(match.matched, false);
  });
});

// ─── F · dominios inválidos / nulos ───────────────────────────────────────────

describe('F · lo inválido no funda duplicado FUERTE', () => {
  test('sin variantes válidas, la consulta de dominio NO se emite', async () => {
    const db = makeFilteringClient([activeRow({ name: 'Cualquiera', domain: 'localhost' })]);
    const out = await fetchActiveCandidatesForGuard(db.client, ['localhost', '', 'sinpunto'], null);
    assert.equal(out.status, 'ok');
    assert.equal(
      db.queries.find((q) => q.inFilters['domain'] !== undefined),
      undefined,
      'no se pide a la base un conjunto vacío de dominios',
    );
    assert.deepEqual(out.records, []);
  });

  test('`localhost` en la base NO iguala a `localhost` en la entrada', async () => {
    const historical = activeRow({ name: 'Local', domain: 'localhost', country_code: 'CO' });
    const db = makeFilteringClient([historical]);
    const out = await fetchActiveCandidatesForGuard(db.client, ['localhost'], 'CO');
    // Llega por el eje de país, pero la guarda no puede fundar identidad con él.
    const match = guardOver(out.records, { name: 'Otra Empresa', domain: 'localhost' });
    assert.notEqual(match.reason, 'same_active_domain');
  });

  test('dominio NULO en la base no rompe ni iguala', async () => {
    const historical = activeRow({ name: 'Sin Dominio', domain: null, country_code: 'CO' });
    const db = makeFilteringClient([historical]);
    const out = await fetchActiveCandidatesForGuard(db.client, ['etb.com'], 'CO');
    assert.equal(out.status, 'ok');
    const match = guardOver(out.records, { name: 'ETB', domain: 'etb.com' });
    assert.notEqual(match.reason, 'same_active_domain');
  });

  test('lote sin ningún dominio → ok, sin falso duplicado', async () => {
    const db = makeFilteringClient([activeRow({ name: 'ETB', domain: 'www.etb.com' })]);
    const out = await fetchActiveCandidatesForGuard(db.client, [], null);
    assert.equal(out.status, 'ok');
    assert.deepEqual(out.records, []);
  });
});

// ─── § 9 · LAS CINCO VIVAS, por el eje de DOMINIO ─────────────────────────────

/**
 * Filas ACTIVAS anteriores tal como están HOY en Producción (auditadas: las cinco
 * se persistieron con `www.`, estado `needs_review`, país CO).
 */
const LIVE_FIVE = [
  { label: 'EPM', name: 'EPM', stored: 'www.une.com.co', canonical: 'une.com.co' },
  { label: 'ETB', name: 'ETB', stored: 'www.etb.com', canonical: 'etb.com' },
  { label: 'RCN TV', name: 'RCN TV', stored: 'www.canalrcn.com', canonical: 'canalrcn.com' },
  {
    label: 'Controles Empresariales',
    name: 'Controles Empresariales',
    stored: 'www.controlesempresariales.com',
    canonical: 'controlesempresariales.com',
  },
  { label: 'Avantel S.A', name: 'Avantel S.A', stored: 'www.avantel.co', canonical: 'avantel.co' },
] as const;

/** Las SEIS que HubSpot ya excluía, con la MISMA huella `matchedDomain: "www.…"`. */
const HIDDEN_SIX = [
  { label: 'Siigo', name: 'Siigo', stored: 'www.siigo.com', canonical: 'siigo.com' },
  { label: 'EL TIEMPO', name: 'EL TIEMPO Casa Editorial', stored: 'www.eltiempo.com', canonical: 'eltiempo.com' },
  { label: 'Caracol Radio', name: 'Caracol Radio', stored: 'www.caracol.com.co', canonical: 'caracol.com.co' },
  { label: 'Ceiba Software', name: 'Ceiba Software', stored: 'www.ceiba.com.co', canonical: 'ceiba.com.co' },
  { label: 'Intergrupo', name: 'Intergrupo', stored: 'www.intergrupo.com', canonical: 'intergrupo.com' },
  { label: 'SETI', name: 'SETI S.A.S', stored: 'www.seti.com.co', canonical: 'seti.com.co' },
] as const;

function describeDomainAxis(
  title: string,
  cases: readonly { label: string; name: string; stored: string; canonical: string }[],
) {
  describe(title, () => {
    for (const c of cases) {
      test(`${c.label}: recuperada por el eje de DOMINIO y cerrada como FUERTE`, async () => {
        const historical = activeRow({
          name: c.name,
          domain: c.stored,
          country_code: 'CO',
          status: 'needs_review',
        });
        const db = makeFilteringClient([historical]);

        // La forma canónica es lo que el llamador construye hoy.
        assert.equal(normalizeDomain(c.stored), c.canonical, 'la autoridad las une');

        // countryCode = null → el eje de país no participa. Sin coartada.
        const out = await fetchActiveCandidatesForGuard(db.client, [c.canonical], null);

        assert.ok(db.retrievedByDomain(historical.id), 'prefetched_by_domain = YES');
        assert.ok(!db.retrievedByCountry(historical.id), 'sin depender del eje de país');

        const match = guardOver(out.records, { name: c.name, domain: c.canonical });
        assert.equal(match.reason, 'same_active_domain', 'guard_reason = same_active_domain');
        assert.ok(isStrongActiveGuardReason(match.reason), 'strong = YES');
      });
    }

    test('las mismas, en UN solo lote, con el tope de país agotado por otras', async () => {
      // El caso realista: el eje de país no puede cubrirlas porque está lleno.
      const filler = Array.from({ length: 600 }, (_, i) =>
        activeRow({ name: `Relleno ${i}`, domain: `relleno-lote-${i}.com.co`, country_code: 'CO' }),
      );
      const historicals = cases.map((c) =>
        activeRow({ name: c.name, domain: c.stored, country_code: 'CO' }),
      );
      const db = makeFilteringClient([...filler, ...historicals]);

      const out = await fetchActiveCandidatesForGuard(
        db.client,
        cases.map((c) => c.canonical),
        'CO',
      );

      for (let i = 0; i < cases.length; i += 1) {
        const c = cases[i];
        const row = historicals[i];
        assert.ok(db.retrievedByDomain(row.id), `${c.label}: prefetched_by_domain`);
        assert.ok(!db.retrievedByCountry(row.id), `${c.label}: fuera de la ventana de país`);
        const match = guardOver(out.records, { name: c.name, domain: c.canonical });
        assert.equal(match.reason, 'same_active_domain', `${c.label}: FUERTE`);
      }
    });
  });
}

describeDomainAxis('§ 9 · las CINCO pagadas del lote vivo', LIVE_FIVE);
describeDomainAxis('§ 10 · las SEIS ocultas (mismo defecto, sin coste de objetivo)', HIDDEN_SIX);

// ─── § 12 · paridad pre-writer / writer en la RECUPERACIÓN ────────────────────

describe('§ 12 · pre-writer y writer reciben la MISMA fila histórica', () => {
  test('entrada canónica (pre-writer) y entrada cruda `www.` (writer) → mismo ID', async () => {
    // Las dos rutas no son homogéneas y por eso la paridad hay que probarla:
    //   pre-writer / runner de Apollo → `normalizeDomain(domain)` → 'example.com'
    //   writer                        → `candidate.domain` crudo   → 'www.example.com'
    const historical = activeRow({ name: 'Example', domain: 'www.example.com', country_code: 'CO' });

    const preWriterDb = makeFilteringClient([historical]);
    const preWriter = await fetchActiveCandidatesForGuard(
      preWriterDb.client,
      [normalizeDomain('www.example.com')!],
      null,
    );

    const writerDb = makeFilteringClient([historical]);
    const writer = await fetchActiveCandidatesForGuard(writerDb.client, ['www.example.com'], null);

    assert.deepEqual(
      preWriter.records.map((r) => r.id),
      writer.records.map((r) => r.id),
      'PARIDAD de recuperación: la economía temprana y la persistencia ven lo mismo',
    );
    assert.equal(preWriter.records.length, 1);
    assert.ok(preWriterDb.retrievedByDomain(historical.id));
    assert.ok(writerDb.retrievedByDomain(historical.id));

    // Y las dos producen la MISMA causa.
    for (const [label, records, inputDomain] of [
      ['pre-writer', preWriter.records, 'example.com'],
      ['writer', writer.records, 'www.example.com'],
    ] as const) {
      const match = guardOver(records, { name: 'Example', domain: inputDomain });
      assert.equal(match.reason, 'same_active_domain', `${label}: duplicate_guard:same_active_domain`);
    }
  });

  test('las dos rutas piden a la base el MISMO conjunto de formas', async () => {
    const a = makeFilteringClient([]);
    await fetchActiveCandidatesForGuard(a.client, ['example.com'], null);
    const b = makeFilteringClient([]);
    await fetchActiveCandidatesForGuard(b.client, ['www.example.com'], null);
    assert.deepEqual(
      [...(a.requestedDomainForms() ?? [])].sort(),
      [...(b.requestedDomainForms() ?? [])].sort(),
    );
  });
});

// ─── § 13 · paridad Apollo ────────────────────────────────────────────────────

describe('§ 13 · paridad Apollo (0 llamadas al proveedor)', () => {
  test('mismo dominio canónico activo → duplicado DURO', async () => {
    const historical = activeRow({ name: 'Softland', domain: 'www.softland.com', country_code: 'CO' });
    const db = makeFilteringClient([historical]);
    // El runner de Apollo canonicaliza antes de llamar.
    const out = await fetchActiveCandidatesForGuard(db.client, [normalizeDomain('https://www.softland.com/co')!], null);
    assert.ok(db.retrievedByDomain(historical.id));
    const match = guardOver(out.records, { name: 'Softland', domain: 'softland.com' });
    assert.equal(match.reason, 'same_active_domain');
    assert.ok(isStrongActiveGuardReason(match.reason));
  });

  test('mismo nombre + dominio GENUINAMENTE distinto → sólo DÉBIL', async () => {
    const historical = activeRow({
      name: 'Softland',
      domain: 'www.softland.com',
      normalized_name: 'softland',
      country_code: 'CO',
    });
    const db = makeFilteringClient([historical]);
    const out = await fetchActiveCandidatesForGuard(db.client, ['softland.cl'], 'CO');
    assert.ok(!db.retrievedByDomain(historical.id), 'el eje de dominio no debe traerlo');
    const match = guardOver(out.records, {
      name: 'Softland',
      domain: 'softland.cl',
      normalizedName: 'softland',
    });
    assert.notEqual(match.reason, 'same_active_domain');
    assert.ok(isWeakActiveGuardReason(match.reason));
  });
});

// ─── § 8 · la política de degradación NO cambia ───────────────────────────────

describe('§ 8 · semántica de fallo preservada', () => {
  test('excepción → degraded/prefetch_failed, records=[] (igual que antes)', async () => {
    const throwing = {
      from() {
        throw new Error('boom');
      },
    } as unknown as SupabaseClient;
    const out = await fetchActiveCandidatesForGuard(throwing, ['etb.com'], 'CO');
    assert.equal(out.status, 'degraded');
    assert.equal(out.reason, 'prefetch_failed');
    assert.deepEqual(out.records, []);
  });

  test('error de query → degraded/query_error (un fallo NO es «no hay duplicado»)', async () => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.in = () => builder;
    builder.eq = () => builder;
    builder.limit = () => Promise.resolve({ data: null, error: { message: 'boom' } });
    const errClient = { from: () => builder } as unknown as SupabaseClient;
    const out = await fetchActiveCandidatesForGuard(errClient, ['etb.com'], 'CO');
    assert.equal(out.status, 'degraded');
    assert.equal(out.reason, 'query_error');
  });
});
