/**
 * BR-SOURCE FUNCTIONAL CUT E — la cadena A→D contra DATOS REALES de Receita y un PostgreSQL local.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ PRUEBA ESTE CORTE QUE NINGÚN OTRO PODÍA PROBAR
 * ═══════════════════════════════════════════════════════════════════
 *
 * Los cortes A→D se decidieron con CNPJ sintéticos y DV-válidos por construcción. Eso es lo
 * correcto para fijar CONTRATOS —una identidad inventada ejercita la valla igual de bien que una
 * real— y es incapaz de contestar tres preguntas que sólo los datos reales contestan:
 *
 *   1. ¿la SIMETRÍA aguanta? El writer persiste `normalized_legal_name` y el resolver filtra por
 *      él. Los nombres sintéticos no tienen `M.DIAS`, ni `S/A`, ni dobles espacios, ni los 18.210
 *      caracteres de puntuación que la muestra real trae. Si la normalización divergiera en
 *      cualquiera de esas formas, el resolver no fallaría: devolvería NO_MATCH, que es
 *      indistinguible de «esta empresa no está en Receita».
 *   2. ¿el CUT C sirve de algo? Que un nombre resuelva a UN establecimiento no es una propiedad del
 *      diseño, es un hecho de la distribución: matriz y filial comparten razão social por
 *      construcción legal. Sólo la realidad dice con qué frecuencia.
 *   3. ¿la ciudad desempata? Sólo si las sucursales están en municipios distintos. También un hecho.
 *
 * ── 🔴 ESTO NO ES EL BENCHMARK NACIONAL ─────────────────────────────────────
 *
 * No es Gate-2, no es el intento #3, no consume una autorización, no toca
 * `br-receita-cnpj-real-benchmark-attempt-ledger` ni ningún contador de intentos, y no mide
 * rendimiento. Lee una MUESTRA acotada por dos topes independientes y explícitos —bytes y filas—
 * que el extractor devuelve como parte de su valor de retorno.
 *
 * ── 🔴 Privacidad (§ 14 del encargo) ────────────────────────────────────────
 *
 * Ninguna aserción de este fichero imprime una razão social, un CNPJ, un nome fantasia, una
 * dirección ni una fila. Las aserciones comparan valores y los mensajes de fallo son categorías.
 * Donde un mensaje podría acabar citando un valor —`assert.equal` sobre dos nombres— se compara
 * un BOOLEANO derivado en su lugar.
 *
 * 🔴 NO PROD. NO apply_migration. NO providers. NO credits. NO HubSpot. NO flags. NO red.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyRealChain,
  bootstrapFullOrderPlatform,
  FULL_REPO_ORDER_CHAIN,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from '../../../__tests__/support/source-snapshot-identity-real-migration-chain';
import { createPostgrestShimClient } from './support/br-receita-cut-b-postgrest-shim';
import { createCutESupabaseShim } from './support/br-receita-cut-e-supabase-shim';
import {
  buildCutERealSnapshots,
  companyPartsPartitionKeySpace,
  CUT_E_DEFAULT_BOUNDS,
  CUT_E_REAL_PERIOD,
  extractCutERealSample,
  probeCompanyPartRanges,
  resolveCutERealDataset,
  type CutEDatasetLayout,
  type CutERealBuildOutcome,
  type CutERealSample,
} from './support/br-receita-cut-e-real-sample';

import { normalizeBrazilCnpj } from '../br-cnpj';
import {
  normalizeBrCompanyLegalName,
  normalizeBrMunicipalityName,
} from '../br-receita-cnpj-name-normalization';
import { toBrReceitaPersistedSnapshot } from '../br-receita-cnpj-monthly-snapshot-identity';
import { planBrReceitaMonthlySnapshotWrite } from '../br-receita-cnpj-monthly-snapshot-write-plan';
import {
  createBrReceitaSqlWriteGateway,
  type BrReceitaSqlExecutor,
} from '../br-receita-cnpj-monthly-snapshot-write-gateway';
import { executeBrReceitaMonthlySnapshotWrite } from '../br-receita-cnpj-monthly-snapshot-executor';
import { pinBrReceitaPublication } from '../br-receita-cnpj-pinned-publication';
import { createBrReceitaCnpjPinnedEnrichmentAdapter } from '../br-receita-cnpj-enrichment-adapter';
import {
  resolveBrReceitaCandidateIdentity,
  type BrReceitaCandidateIdentityResolution,
} from '../br-receita-cnpj-candidate-identity-resolver';
import type { BrReceitaPinnedPublication } from '../br-receita-cnpj-pinned-publication';

import { PROMOTE_FISCAL_IDENTITY_RPC } from '@/server/prospect-batches/candidate-fiscal-identity-promotion';
import { runFencedIdentityPromotion } from '@/server/prospect-batches/run-fenced-identity-promotion';
import { loadBatchIdentityRegistry } from '@/server/prospect-batches/batch-identity-registry-store';
import { BATCH_IDENTITY_SNAPSHOT_RPC } from '@/server/prospect-batches/batch-identity-fence';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → br-receita-cnpj → connectors → source-catalog → server → src → repo root
const repoRoot = join(here, '..', '..', '..', '..', '..', '..');

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } = resolveEmbeddedPostgres(
  import.meta.url,
);

/** El corte D sigue siendo una migración LOCAL sin numerar, y se aplica la ÚLTIMA. */
// 🔴 BR-PRODUCTION-RELEASE numbered this migration 133 (`origin/main` ceiling was 132;
// nothing in flight claimed 133 or above). It is still applied LAST, after the whole
// repository order, because 133 sorts after every file in that chain — the harness order
// and the deployable order agree. Referenced BY NAME so a rename breaks the test.
const CUT_D_MIGRATION = '133_br_candidate_identity_promotion.sql';
const FENCE_INSERT_FN = 'public.insert_fenced_prospect_candidates';

// ─── Estado del arnés ────────────────────────────────────────────────────────

let datasetSkip: string | false = false;
let layout: CutEDatasetLayout | null = null;
let sample: CutERealSample | null = null;
let built: CutERealBuildOutcome | null = null;

let dataDir = '';
let postgres: EmbeddedPostgresLike;
/** Sesión de trabajo. */ let a: PgLikeClient;
/** Sesión que compite (§ 10). */ let b: PgLikeClient;
/** Observador, fuera de ambas transacciones. */ let obs: PgLikeClient;

let publishedRunId: string | null = null;
let pin: BrReceitaPinnedPublication | null = null;
let batchSeq = 0;

// ─── Cohortes, derivadas de lo PUBLICADO ─────────────────────────────────────
//
// 🔴 La cardinalidad se calcula sobre las filas que se publicaron, no sobre el fichero nacional, y
// eso es lo correcto: el contrato del resolver es «dentro de la publicación fijada». Un nombre con
// una sola sucursal EN ESTA PUBLICACIÓN es RESOLVED_UNIQUE aunque nacionalmente tenga cinco, y esa
// es exactamente la respuesta que el resolver debe dar. El informe lo dice explícitamente.

interface PublishedRow {
  readonly canonicalName: string;
  readonly canonicalCity: string | null;
  readonly normalizedTaxId: string;
  readonly matrixBranchFlag: string | null;
  readonly legalName: string;
}

interface NameGroup {
  readonly canonicalName: string;
  readonly rows: readonly PublishedRow[];
  /** canonical city → cuántas filas del grupo están en ella. */
  readonly cityCounts: ReadonlyMap<string, number>;
}

let groups: NameGroup[] = [];

const uniqueGroups = (): NameGroup[] => groups.filter((group) => group.rows.length === 1);
const multiGroups = (): NameGroup[] => groups.filter((group) => group.rows.length > 1);

/** Grupos multi-sucursal con al menos una ciudad que contiene EXACTAMENTE una de ellas. */
const cityDisambiguableGroups = (): NameGroup[] =>
  multiGroups().filter((group) => [...group.cityCounts.values()].some((count) => count === 1));

/** Grupos multi-sucursal con al menos DOS filas en el MISMO municipio. */
const sameCityAmbiguousGroups = (): NameGroup[] =>
  multiGroups().filter((group) => [...group.cityCounts.values()].some((count) => count > 1));

// ─── Utilidades ──────────────────────────────────────────────────────────────

const sqlExecutor = (): BrReceitaSqlExecutor => ({
  query: (statement, params) => a.query(statement, params ? [...params] : undefined),
});

const readerClient = () => createPostgrestShimClient(a);
const supabaseShim = () => createCutESupabaseShim(a);

async function newBatch(): Promise<string> {
  batchSeq += 1;
  const { rows } = await obs.query(
    'INSERT INTO public.prospect_batches (name) VALUES ($1) RETURNING id',
    [`lote-cut-e-${batchSeq}`],
  );
  return String(rows[0].id);
}

/** Crea candidatos por la inserción vallada de la 126 — interoperabilidad, no atajo. */
async function newCandidates(
  batchId: string,
  expectedEpoch: number,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<string[]> {
  const { rows: out } = await obs.query(`SELECT ${FENCE_INSERT_FN}($1, $2, $3) AS payload`, [
    batchId,
    expectedEpoch,
    JSON.stringify(rows),
  ]);
  const payload = out[0].payload as { status: string; candidate_ids?: string[] };
  assert.equal(payload.status, 'inserted', JSON.stringify(payload));
  return payload.candidate_ids ?? [];
}

async function epochOf(batchId: string): Promise<number> {
  const { rows } = await obs.query(
    'SELECT identity_epoch FROM public.prospect_batches WHERE id = $1',
    [batchId],
  );
  return Number(rows[0].identity_epoch);
}

async function candidateOf(
  id: string,
): Promise<{ tax_identifier: string | null; identity_key: string | null }> {
  const { rows } = await obs.query(
    'SELECT tax_identifier, identity_key FROM public.prospect_candidates WHERE id = $1',
    [id],
  );
  return rows[0] as never;
}

const resolveFor = async (
  candidateName: unknown,
  candidateCity?: unknown,
): Promise<BrReceitaCandidateIdentityResolution> =>
  resolveBrReceitaCandidateIdentity({
    client: readerClient(),
    publication: pin!,
    candidateName,
    candidateCity,
  });

// ═══════════════════════════════════════════════════════════════════════════

describe(
  'BR-SOURCE FUNCTIONAL CUT E — real Receita data, local PostgreSQL',
  { skip: harnessSkipReason },
  () => {
    before(async () => {
      if (!EmbeddedPostgresCtor) return;

      // ── El dataset real. Su ausencia es un skip, nunca un fallo del código. ──
      const resolved = await resolveCutERealDataset();
      if (resolved.skip !== false) {
        datasetSkip = resolved.skip;
        return;
      }
      layout = resolved.layout;

      sample = await extractCutERealSample(layout, CUT_E_DEFAULT_BOUNDS);
      built = buildCutERealSnapshots(sample);

      // ── PostgreSQL efímero + la cadena REAL, con la migración LOCAL la última. ──
      dataDir = mkdtempSync(join(tmpdir(), 'sellup-cut-e-'));
      postgres = new EmbeddedPostgresCtor({
        databaseDir: dataDir,
        user: 'postgres',
        password: 'postgres',
        port: 54427,
        persistent: false,
      });
      await postgres.initialise();
      await postgres.start();
      a = postgres.getPgClient();
      await a.connect();
      b = postgres.getPgClient();
      await b.connect();
      obs = postgres.getPgClient();
      await obs.connect();

      await bootstrapFullOrderPlatform(a);
      await applyRealChain(a, repoRoot, [...FULL_REPO_ORDER_CHAIN, CUT_D_MIGRATION]);

      // ── La publicación local, por el planificador y el ejecutor REALES. ──
      const planned = planBrReceitaMonthlySnapshotWrite({
        sourcePeriod: CUT_E_REAL_PERIOD,
        records: built.snapshots.map(toBrReceitaPersistedSnapshot),
      });
      assert.equal(planned.status, 'planned');
      if (planned.status !== 'planned') throw new Error('unreachable');

      const execution = await executeBrReceitaMonthlySnapshotWrite({
        plan: planned.plan,
        gateway: createBrReceitaSqlWriteGateway(sqlExecutor()),
      });
      assert.equal(execution.status, 'published', JSON.stringify(execution.failure ?? {}));
      publishedRunId = execution.snapshotRunId;

      const pinResult = await pinBrReceitaPublication({ client: readerClient() });
      assert.equal(pinResult.status, 'PINNED');
      pin = pinResult.publication;

      // ── Las cohortes, sobre lo PUBLICADO. ──
      const municipalityByCode = new Map(
        sample.municipalities.map((row) => [row.codigo, row.descricao]),
      );
      const byName = new Map<string, PublishedRow[]>();
      for (const snapshot of built.snapshots) {
        const canonical = normalizeBrCompanyLegalName(snapshot.legal_name);
        if (canonical.status !== 'valid') continue;
        const municipalityName =
          municipalityByCode.get(snapshot.raw_data.municipality_code ?? '') ?? null;
        const city = normalizeBrMunicipalityName(municipalityName);
        const row: PublishedRow = {
          canonicalName: canonical.normalized,
          canonicalCity: city.status === 'valid' ? city.normalized : null,
          normalizedTaxId: snapshot.normalized_tax_id,
          matrixBranchFlag: snapshot.raw_data.matrix_branch_flag,
          legalName: snapshot.legal_name ?? '',
        };
        const bucket = byName.get(canonical.normalized);
        if (bucket === undefined) byName.set(canonical.normalized, [row]);
        else bucket.push(row);
      }
      groups = [...byName.entries()]
        .map(([canonicalName, rows]) => {
          const cityCounts = new Map<string, number>();
          for (const row of rows) {
            if (row.canonicalCity === null) continue;
            cityCounts.set(row.canonicalCity, (cityCounts.get(row.canonicalCity) ?? 0) + 1);
          }
          return { canonicalName, rows, cityCounts };
        })
        // Orden determinista: el nombre canónico es único por grupo.
        .sort((x, y) => (x.canonicalName < y.canonicalName ? -1 : 1));
    });

    after(async () => {
      await a?.end().catch(() => {});
      await b?.end().catch(() => {});
      await obs?.end().catch(() => {});
      await postgres?.stop().catch(() => {});
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    });

    // ═══════════════════════════════════════════════════════════════════════
    describe('la premisa del muestreo acotado', () => {
      it('CASE 1 — las diez partes de EMPRESAS particionan el espacio de claves', async () => {
        if (datasetSkip !== false) return;
        // 🔴 De este hecho depende TODO el join dirigido: si dos partes se solaparan, una banda de
        // claves podría vivir en dos ficheros y la ventana leería sólo una. Se MIDE.
        const ranges = await probeCompanyPartRanges(layout!);
        assert.equal(ranges.length, 10, 'faltan partes de EMPRESAS en el dataset local');
        assert.equal(
          companyPartsPartitionKeySpace(ranges),
          true,
          'los rangos de EMPRESAS se solapan: el join dirigido dejaría de ser completo',
        );
      });

      it('CASE 2 — la muestra es ACOTADA y sus topes son observables', () => {
        if (datasetSkip !== false) return;
        const meters = sample!.meters;
        // Los topes son los declarados, no «lo que se leyó».
        assert.ok(
          meters.establishmentBytesRead <=
            CUT_E_DEFAULT_BOUNDS.maxBytesPerEstablishmentPart *
              CUT_E_DEFAULT_BOUNDS.establishmentParts.length,
          'la lectura de ESTABELECIMENTOS superó su propio tope',
        );
        assert.ok(
          meters.companyBytesRead <=
            CUT_E_DEFAULT_BOUNDS.maxBytesPerCompanyWindow * (meters.companyWindowsOpened + 10),
          'la lectura de EMPRESAS superó su propio tope',
        );
        assert.ok(
          meters.establishmentRowsAccepted <= CUT_E_DEFAULT_BOUNDS.maxAcceptedEstablishments,
          'se aceptaron más filas que el tope declarado',
        );
        // 🔴 Y la prueba de que NO es un barrido nacional: se leyó una fracción del dataset.
        assert.ok(
          meters.establishmentBytesRead + meters.companyBytesRead < 2 * 1024 * 1024 * 1024,
          'la lectura dejó de ser una muestra',
        );
      });

      it('CASE 3 — el join dirigido cubre la muestra', () => {
        if (datasetSkip !== false) return;
        const wanted = new Set(sample!.establishments.map((row) => row.cnpjBasico));
        const found = [...wanted].filter((key) => sample!.companiesByBasico.has(key)).length;
        // Un join que cubriera poco haría que el corte midiese sobre todo `missing_root_company`.
        assert.ok(
          found / wanted.size > 0.95,
          `la cobertura del join cayó a ${((found / wanted.size) * 100).toFixed(2)}%`,
        );
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    describe('la capacidad de CUT D existe en ESTE PostgreSQL', () => {
      it('CASE 4 — SAFE_PROMOTION_CAPABILITY = PRESENT, sin mock', async () => {
        if (datasetSkip !== false) return;
        const { rows } = await obs.query(
          `SELECT p.prosecdef, p.proconfig
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = $1`,
          [PROMOTE_FISCAL_IDENTITY_RPC],
        );
        assert.equal(rows.length, 1, 'la función de promoción no existe en esta base');
        assert.equal(rows[0].prosecdef, false, 'debe ser SECURITY INVOKER');
        assert.deepEqual((rows[0].proconfig as string[] | null) ?? [], [
          'search_path=pg_catalog, public, pg_temp',
        ]);
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    describe('la publicación REAL', () => {
      it('CASE 5 — el mes real queda publicado y fijado', () => {
        if (datasetSkip !== false) return;
        assert.equal(pin!.sourcePeriod, CUT_E_REAL_PERIOD);
        assert.equal(pin!.snapshotRunId, publishedRunId);
      });

      it('CASE 6 — las filas publicadas son las que el constructor REAL aceptó', async () => {
        if (datasetSkip !== false) return;
        const { rows } = await a.query(
          `SELECT count(*)::int AS n FROM public.source_company_snapshots
            WHERE source_key = 'br_receita_cnpj_dados_abertos'
              AND source_period = $1 AND snapshot_run_id = $2`,
          [CUT_E_REAL_PERIOD, publishedRunId],
        );
        assert.equal(Number(rows[0].n), built!.snapshots.length);
        assert.ok(built!.snapshots.length > 1000, 'la publicación es demasiado pequeña para medir');
      });

      it('CASE 7 — 🔴 CUT E1: las colisiones de sanitización EXCLUYEN SU FILA, no el lote', () => {
        if (datasetSkip !== false) return;
        // El HALLAZGO de CUT E: `assertSanitizedRawData` documentaba que «the row is rejected rather
        // than published» y la implementación LANZABA, así que DOS filas reales impedían publicar el
        // mes completo. CUT E1 corrigió la disposición EN EL PRODUCTO.
        //
        // 🔴 La prueba de que el lote NO abortó es estructural, no una aserción: `buildCutERealSnapshots`
        // hace UNA llamada con la muestra COMPLETA y no captura nada. Si el parser volviera a lanzar,
        // el `before` de este describe habría fallado y no habría publicación que inspeccionar.
        const sanitization = built!.sanitizationRejections;
        assert.equal(
          sanitization.length,
          2,
          'la muestra real de julio-2026 contiene exactamente dos filas con colisión',
        );

        // La exclusión la hace el PARSER, y se ve en su propio resumen — no un contador del arnés.
        assert.equal(built!.summary.rejectedSanitizedRawDataCollision, sanitization.length);
        assert.equal(built!.offeredRows, sample!.establishments.length, 'muestra completa ofrecida');
        assert.equal(built!.summary.totalEstablishmentRows, built!.offeredRows);
        assert.equal(
          built!.summary.acceptedRows + built!.summary.rejectedRows,
          built!.summary.totalEstablishmentRows,
          'el resumen reconcilia sobre datos REALES, con colisiones presentes',
        );

        // 🔴 El registro de rechazo no lleva CNPJ ni valor ofensor, tampoco con datos reales.
        const serialized = JSON.stringify(sanitization);
        assert.equal(/\d{8}/.test(serialized), false, 'ninguna tirada de ocho dígitos');
        for (const rejection of sanitization) {
          assert.deepEqual(Object.keys(rejection).sort(), [
            'reasonCode',
            'safeIdentifier',
            'sourceFile',
            'sourceRowIndex',
          ]);
        }
      });

      it('CASE 7B — 🔴 las filas excluidas NO están publicadas, y las demás SÍ', async () => {
        if (datasetSkip !== false) return;
        // Lo que la publicación real contiene es exactamente lo aceptado: ni la fila excluida
        // reaparece, ni se perdió ninguna otra por su culpa.
        const { rows } = await a.query(
          `SELECT count(*)::int AS n FROM public.source_company_snapshots
            WHERE source_key = 'br_receita_cnpj_dados_abertos'
              AND source_period = $1 AND snapshot_run_id = $2`,
          [CUT_E_REAL_PERIOD, publishedRunId],
        );
        assert.equal(Number(rows[0].n), built!.summary.acceptedRows);
        assert.equal(
          Number(rows[0].n),
          built!.offeredRows - built!.summary.rejectedRows,
          'publicado = ofrecido − rechazado, sin bisección externa',
        );
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    describe('§ 7 — simetría de normalización contra datos REALES', () => {
      it('CASE 8 — el valor persistido es el que el normalizador produce, fila a fila', async () => {
        if (datasetSkip !== false) return;
        const { rows } = await a.query(
          `SELECT legal_name, normalized_legal_name
             FROM public.source_company_snapshots
            WHERE source_key = 'br_receita_cnpj_dados_abertos'
              AND source_period = $1 AND snapshot_run_id = $2`,
          [CUT_E_REAL_PERIOD, publishedRunId],
        );
        assert.ok(rows.length > 1000);

        let asymmetric = 0;
        for (const row of rows) {
          const canonical = normalizeBrCompanyLegalName(row.legal_name);
          const expected = canonical.status === 'valid' ? canonical.normalized : null;
          if (expected !== row.normalized_legal_name) asymmetric += 1;
        }
        // 🔴 Un conteo, no el nombre que divergió: un mensaje de fallo que citara la razão social
        // sería la fuga que el propio resolver evita.
        assert.equal(asymmetric, 0, `${asymmetric} filas reales rompen la simetría writer/resolver`);
      });

      it('CASE 9 — la muestra real EJERCITA de verdad la normalización', () => {
        if (datasetSkip !== false) return;
        // Una simetría verde sobre nombres que no contienen nada que normalizar no prueba nada, así
        // que se mide qué trae REALMENTE la muestra.
        const persisted = built!.snapshots.map((snapshot) => snapshot.legal_name ?? '');
        const withPunctuation = persisted.filter((name) => /[^A-Za-z0-9 ]/.test(name)).length;
        const withLegalSuffix = persisted.filter((name) => /\b(LTDA|S\/A|S\.A|SA)\b/i.test(name)).length;
        assert.ok(withPunctuation > 100, 'la muestra no trae puntuación real que normalizar');
        assert.ok(withLegalSuffix > 100, 'la muestra no trae sufijos legales reales');

        // 🔴 Los espacios dobles hay que buscarlos en la FUENTE, no en lo persistido: `normalizeText`
        // del constructor colapsa `\s+` ANTES de que `legal_name` se escriba. La primera versión de
        // esta prueba los buscó en lo persistido y falló — no porque Receita no los publique (la
        // muestra trae más de cien), sino porque para cuando la fila se persiste ya no están.
        const rawNames = sample!.establishments
          .map((row) => sample!.companiesByBasico.get(row.cnpjBasico)?.razaoSocial ?? '')
          .filter((name) => name !== '');
        assert.ok(
          rawNames.filter((name) => / {2,}/.test(name)).length > 0,
          'la muestra no trae espacios dobles reales en origen',
        );
        // Y la propiedad que ese hallazgo implica: nada persistido conserva un espacio doble.
        assert.equal(
          persisted.filter((name) => / {2,}/.test(name)).length,
          0,
          'el constructor dejó pasar un espacio doble a `legal_name`',
        );
      });

      it('CASE 10 — la MISMA forma canónica recupera el conjunto esperado dentro del run fijado', async () => {
        if (datasetSkip !== false) return;
        const probes = [...uniqueGroups().slice(0, 20), ...multiGroups().slice(0, 20)];
        assert.ok(probes.length > 0);
        for (const group of probes) {
          const { rows } = await a.query(
            `SELECT normalized_tax_id
               FROM public.source_company_snapshots
              WHERE source_key = 'br_receita_cnpj_dados_abertos'
                AND country_code = 'BR'
                AND source_period = $1
                AND snapshot_run_id = $2
                AND normalized_legal_name = $3`,
            [CUT_E_REAL_PERIOD, publishedRunId, group.canonicalName],
          );
          assert.equal(
            rows.length,
            group.rows.length,
            'la consulta por nombre canónico no devuelve el conjunto que la muestra publicó',
          );
          const expected = new Set(group.rows.map((row) => row.normalizedTaxId));
          for (const row of rows) {
            assert.equal(expected.has(String(row.normalized_tax_id)), true);
          }
        }
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    describe('§ 8 — las cinco cohortes, sobre nombres REALES', () => {
      it('CASE 11 — COHORTE A: nombre con UN establecimiento ⇒ RESOLVED_UNIQUE', async () => {
        if (datasetSkip !== false) return;
        const cohort = uniqueGroups().slice(0, 25);
        assert.ok(cohort.length > 0, 'la muestra no produjo cohorte A');
        for (const group of cohort) {
          const resolution = await resolveFor(group.rows[0]!.legalName);
          assert.equal(resolution.status, 'RESOLVED_UNIQUE', resolution.reason);
          assert.equal(resolution.reason, 'unique_exact_normalized_legal_name');
          assert.equal(resolution.observedCount, 1);
          assert.equal(resolution.disambiguatedByCity, false);
          assert.equal(resolution.resolvedNormalizedTaxId, group.rows[0]!.normalizedTaxId);
          assert.equal(resolution.snapshotRunId, publishedRunId);
        }
      });

      it('CASE 12 — COHORTE B: nombre multi-sucursal SIN ciudad ⇒ AMBIGUOUS, sin identidad', async () => {
        if (datasetSkip !== false) return;
        const cohort = multiGroups().slice(0, 25);
        assert.ok(cohort.length > 0, 'la muestra no produjo cohorte B');
        for (const group of cohort) {
          const resolution = await resolveFor(group.rows[0]!.legalName);
          assert.equal(resolution.status, 'AMBIGUOUS', resolution.reason);
          assert.equal(resolution.reason, 'multiple_name_matches_and_no_usable_candidate_city');
          assert.equal(resolution.observedCount, group.rows.length);
          // 🔴 Lo que NO viaja: una respuesta ambigua nunca lleva identidad.
          assert.equal(resolution.resolvedNormalizedTaxId, null);
        }
      });

      it('CASE 13 — COHORTE C: multi-sucursal + ciudad que deja UNA ⇒ RESOLVED_UNIQUE', async () => {
        if (datasetSkip !== false) return;
        const cohort = cityDisambiguableGroups().slice(0, 25);
        assert.ok(cohort.length > 0, 'la muestra no produjo cohorte C');
        for (const group of cohort) {
          const city = [...group.cityCounts.entries()].find(([, count]) => count === 1)![0];
          const target = group.rows.find((row) => row.canonicalCity === city)!;
          const resolution = await resolveFor(target.legalName, city);
          assert.equal(resolution.status, 'RESOLVED_UNIQUE', resolution.reason);
          assert.equal(resolution.reason, 'unique_after_city_disambiguation');
          assert.equal(resolution.disambiguatedByCity, true);
          assert.equal(resolution.observedCount, 1);
          assert.equal(resolution.resolvedNormalizedTaxId, target.normalizedTaxId);
        }
      });

      it('CASE 14 — COHORTE D: dos sucursales en el MISMO municipio ⇒ AMBIGUOUS', async () => {
        if (datasetSkip !== false) return;
        const cohort = sameCityAmbiguousGroups().slice(0, 25);
        assert.ok(cohort.length > 0, 'la muestra no produjo cohorte D');
        for (const group of cohort) {
          const [city, count] = [...group.cityCounts.entries()].find(([, n]) => n > 1)!;
          const resolution = await resolveFor(group.rows[0]!.legalName, city);
          assert.equal(resolution.status, 'AMBIGUOUS', resolution.reason);
          assert.equal(resolution.reason, 'multiple_name_matches_in_same_municipality');
          assert.equal(resolution.observedCount, count);
          assert.equal(resolution.resolvedNormalizedTaxId, null);
        }
      });

      it('CASE 15 — COHORTE E: variantes de forma de un nombre REAL resuelven igual', async () => {
        if (datasetSkip !== false) return;
        const cohort = uniqueGroups().slice(0, 15);
        assert.ok(cohort.length > 0);
        for (const group of cohort) {
          const original = group.rows[0]!.legalName;
          // 🔴 SÓLO variaciones de FORMA. Ni una letra cambia, ni se recorta un sufijo legal: eso
          // sería otra empresa, no otra escritura de la misma.
          const variants = [
            original.toLowerCase(),
            original.replace(/ /g, '  '),
            ` ${original} `,
            original.replace(/\./g, ' '),
            withAccents(original),
          ];
          for (const variant of variants) {
            const canonical = normalizeBrCompanyLegalName(variant);
            assert.equal(canonical.status, 'valid');
            assert.equal(
              canonical.normalized,
              group.canonicalName,
              'una variante de forma cambió el nombre canónico',
            );
            const resolution = await resolveFor(variant);
            assert.equal(resolution.status, 'RESOLVED_UNIQUE', resolution.reason);
            assert.equal(resolution.resolvedNormalizedTaxId, group.rows[0]!.normalizedTaxId);
          }
        }
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    describe('§ 9 — CUT D de extremo a extremo, sobre una identidad REAL', () => {
      it('CASE 16 — sin CNPJ ⇒ resuelto ⇒ PROMOVIDO ⇒ el adaptador exacto encuentra lo mismo', async () => {
        if (datasetSkip !== false) return;
        const group = uniqueGroups()[0]!;
        const batchId = await newBatch();
        const [candidateId] = await newCandidates(batchId, await epochOf(batchId), [
          { name: group.rows[0]!.legalName, country_code: 'BR', identity_key: 'name:pre-resolution' },
        ]);

        // ── Antes: sin identidad fiscal. ──
        const before = await candidateOf(candidateId!);
        assert.equal(before.tax_identifier, null);
        assert.equal(before.identity_key, 'name:pre-resolution');
        const epochBefore = await epochOf(batchId);

        // ── CUT C. ──
        const resolution = await resolveFor(group.rows[0]!.legalName);
        assert.equal(resolution.status, 'RESOLVED_UNIQUE', resolution.reason);

        // ── CUT D, por el bucle de decisión REAL contra la función REAL. ──
        const client = supabaseShim();
        const snapshot = await loadBatchIdentityRegistry(client, batchId);
        assert.equal(snapshot.fenceCapabilityAbsent, false);
        assert.equal(snapshot.degraded, false);
        assert.equal(snapshot.epoch, epochBefore);

        const promotion = await runFencedIdentityPromotion({
          client,
          batchId,
          candidateId: candidateId!,
          countryCode: 'BR',
          taxIdentifier: resolution.resolvedNormalizedTaxId!,
          candidateName: group.rows[0]!.legalName,
          snapshot,
        });
        assert.equal(promotion.status, 'PROMOTED', promotion.reason);
        assert.equal(promotion.mutated, true);
        assert.equal(promotion.adjudicated, true);

        // ── Después: durable, coherente, y la época avanzó EXACTAMENTE uno. ──
        const after_ = await candidateOf(candidateId!);
        assert.equal(after_.tax_identifier, resolution.resolvedNormalizedTaxId);
        assert.notEqual(after_.identity_key, 'name:pre-resolution');
        assert.equal(typeof after_.identity_key, 'string');
        assert.equal(await epochOf(batchId), epochBefore + 1);

        // ── Y el adaptador exacto resuelve el MISMO establecimiento. ──
        const adapter = createBrReceitaCnpjPinnedEnrichmentAdapter(pin!, {
          getClient: readerClient,
        });
        const enrichment = await adapter.enrichCandidate({
          candidateName: group.rows[0]!.legalName,
          candidateTaxId: after_.tax_identifier,
          countryCode: 'BR',
          capability: 'enrichment_after_discovery',
        } as never);
        assert.equal(enrichment.status, 'matched');
        assert.equal(enrichment.metadata?.['snapshot_run_id'], publishedRunId);
        assert.equal(enrichment.metadata?.['source_period'], CUT_E_REAL_PERIOD);

        // 🔴 La identidad persistida es la MISMA que el resolver adjudicó, y sigue siendo un CNPJ
        // válido tras el viaje de ida y vuelta por PostgreSQL.
        const revalidated = normalizeBrazilCnpj(after_.tax_identifier);
        assert.equal(revalidated.status, 'valid');
        assert.equal(revalidated.normalized, group.rows[0]!.normalizedTaxId);
      });

      it('CASE 17 — con la migración LOCAL ausente el camino dice CAPABILITY_ABSENT y no escribe', async () => {
        if (datasetSkip !== false) return;
        const group = uniqueGroups()[1]!;
        const batchId = await newBatch();
        const [candidateId] = await newCandidates(batchId, await epochOf(batchId), [
          { name: group.rows[0]!.legalName, country_code: 'BR' },
        ]);

        // 🔴 AMBAS funciones fingen no existir, que es lo que diría una base sin la 126 ni la
        // migración LOCAL. Cegar sólo una es un estado que no existe (ver CASE 17B).
        const blinded = createCutESupabaseShim(a, {
          pretendMissing: new Set([PROMOTE_FISCAL_IDENTITY_RPC, BATCH_IDENTITY_SNAPSHOT_RPC]),
        });
        const snapshot = await loadBatchIdentityRegistry(blinded, batchId);
        assert.equal(snapshot.fenceCapabilityAbsent, true);
        assert.equal(snapshot.degraded, false, 'la foto degradó: no PRUEBA la ausencia');
        assert.equal(snapshot.epoch, null);

        const promotion = await runFencedIdentityPromotion({
          client: blinded,
          batchId,
          candidateId: candidateId!,
          countryCode: 'BR',
          taxIdentifier: group.rows[0]!.normalizedTaxId,
          candidateName: group.rows[0]!.legalName,
          snapshot,
        });
        assert.equal(promotion.status, 'CAPABILITY_ABSENT', promotion.reason);
        assert.equal(promotion.reason, 'identity_fence_migration_not_applied');
        assert.equal(promotion.mutated, false);
        // 🔴 Y NADA se escribió: el comportamiento de CUT C queda intacto, y contado.
        assert.equal((await candidateOf(candidateId!)).tax_identifier, null);
      });

      it('CASE 17B — 🔴 LA TOPOLOGÍA DE PRODUCCIÓN: 126 aplicada, 133 AUSENTE', async () => {
        if (datasetSkip !== false) return;
        // 🔴 Esta es la topología REAL del despliegue, y CASE 17 no la modela: allí AMBAS
        // funciones fingen faltar, así que la época sale `null` y el corredor nunca llega a la
        // promoción. Producción tiene la 126 —época real, snapshot legible— y le falta SÓLO la
        // 133, de modo que la única que responde «esa función no existe» es la promoción.
        //
        // Leer esa respuesta como «la valla se observó viva y se evaporó» dejaba al candidato SIN
        // adjudicar, y por tanto la segunda pasada exacta de CUT C no se ejecutaba: una REGRESIÓN
        // de un corte ya entregado durante toda la ventana entre el merge y el apply.
        //
        // La época no PRUEBA nada sobre la 133. Son dos migraciones distintas.
        const group = uniqueGroups()[5]!;
        const batchId = await newBatch();
        const [candidateId] = await newCandidates(batchId, await epochOf(batchId), [
          { name: group.rows[0]!.legalName, country_code: 'BR' },
        ]);

        // 🔴 La 126 NO se ciega aquí: la foto se lee contra la base real.
        const honest = supabaseShim();
        const snapshot = await loadBatchIdentityRegistry(honest, batchId);
        assert.equal(snapshot.fenceCapabilityAbsent, false, 'la 126 se leyó como ausente');
        assert.equal(snapshot.degraded, false);
        assert.notEqual(snapshot.epoch, null, 'la 126 está aplicada: la época es real');

        const blindedPromotionOnly = createCutESupabaseShim(a, {
          pretendMissing: new Set([PROMOTE_FISCAL_IDENTITY_RPC]),
        });
        const promotion = await runFencedIdentityPromotion({
          client: blindedPromotionOnly,
          batchId,
          candidateId: candidateId!,
          countryCode: 'BR',
          taxIdentifier: group.rows[0]!.normalizedTaxId,
          candidateName: group.rows[0]!.legalName,
          snapshot,
        });
        assert.equal(promotion.status, 'CAPABILITY_ABSENT', promotion.reason);
        assert.equal(promotion.reason, 'promotion_migration_not_applied');
        // 🔴 ADJUDICADO: es lo que deja sobrevivir intacto el comportamiento de CUT C.
        assert.equal(promotion.adjudicated, true);
        assert.equal(promotion.promotionCapability, 'ABSENT');
        assert.equal(promotion.mutated, false);
        assert.equal((await candidateOf(candidateId!)).tax_identifier, null);
      });

      it('CASE 17C — 🔴 la capacidad es MONÓTONA: OBSERVADA viva, perderla es fallo CERRADO', async () => {
        if (datasetSkip !== false) return;
        // La otra mitad del invariante. Aquí la 133 no se supone: se OBSERVA, porque una promoción
        // real la ejecuta contra la base de verdad. Sólo entonces desaparece, y eso ya no es «la
        // migración no está aplicada» sino un despliegue inconsistente (caché de esquema rancia,
        // función caída). Tratarlo como prueba de ausencia es lo que dejaría evaporarse la valla a
        // mitad de un lote — el defecto que la corrección de CUT-3B4 cerró.
        const observed = uniqueGroups()[6]!;
        const lost = uniqueGroups()[7]!;
        const batchId = await newBatch();
        const [firstId, secondId] = await newCandidates(batchId, await epochOf(batchId), [
          { name: observed.rows[0]!.legalName, country_code: 'BR' },
          { name: lost.rows[0]!.legalName, country_code: 'BR' },
        ]);

        const honest = supabaseShim();
        const snapshot = await loadBatchIdentityRegistry(honest, batchId);
        const first = await runFencedIdentityPromotion({
          client: honest,
          batchId,
          candidateId: firstId!,
          countryCode: 'BR',
          taxIdentifier: observed.rows[0]!.normalizedTaxId,
          candidateName: observed.rows[0]!.legalName,
          snapshot,
        });
        assert.equal(first.status, 'PROMOTED', first.reason);
        // 🔴 La ÚNICA prueba de que la 133 existe: la promoción respondió.
        assert.equal(first.promotionCapability, 'PRESENT');

        const blindedPromotionOnly = createCutESupabaseShim(a, {
          pretendMissing: new Set([PROMOTE_FISCAL_IDENTITY_RPC]),
        });
        const second = await runFencedIdentityPromotion({
          client: blindedPromotionOnly,
          batchId,
          candidateId: secondId!,
          countryCode: 'BR',
          taxIdentifier: lost.rows[0]!.normalizedTaxId,
          candidateName: lost.rows[0]!.legalName,
          snapshot: first.snapshot,
          // 🔴 Lo que la CORRIDA ya estableció, hilado por quien llama.
          promotionCapability: first.promotionCapability,
        });
        assert.equal(second.status, 'ERROR', second.reason);
        assert.equal(second.reason, 'promotion_capability_lost');
        assert.notEqual(second.status, 'CAPABILITY_ABSENT');
        // 🔴 Y NO adjudicado: de esa identidad no sale un reintento exacto contra el adaptador.
        assert.equal(second.adjudicated, false);
        assert.equal(second.promotionCapability, 'PRESENT', 'PRESENT dejó de ser terminal');
        assert.equal(second.mutated, false);
        assert.equal((await candidateOf(secondId!)).tax_identifier, null);
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    describe('§ 10 — dos candidatos, UN establecimiento real', () => {
      it('CASE 18 — uno gana y el otro es RECHAZADO: nunca dos con la misma identidad fiscal', async () => {
        if (datasetSkip !== false) return;
        const group = uniqueGroups()[2]!;
        const name = group.rows[0]!.legalName;
        const taxIdentifier = group.rows[0]!.normalizedTaxId;

        const batchId = await newBatch();
        const [first, second] = await newCandidates(batchId, await epochOf(batchId), [
          { name, country_code: 'BR' },
          { name: `${name} (2)`, country_code: 'BR' },
        ]);

        // Ambos resuelven al MISMO establecimiento — el caso realista: dos filas de discovery
        // que son la misma empresa.
        const client = supabaseShim();
        const shared = await loadBatchIdentityRegistry(client, batchId);

        const [outcomeA, outcomeB] = await Promise.all([
          runFencedIdentityPromotion({
            client: createCutESupabaseShim(a),
            batchId,
            candidateId: first!,
            countryCode: 'BR',
            taxIdentifier,
            candidateName: name,
            snapshot: shared,
          }),
          runFencedIdentityPromotion({
            client: createCutESupabaseShim(b),
            batchId,
            candidateId: second!,
            countryCode: 'BR',
            taxIdentifier,
            candidateName: `${name} (2)`,
            snapshot: shared,
          }),
        ]);

        const statuses = [outcomeA.status, outcomeB.status].sort();
        assert.equal(
          statuses.includes('PROMOTED'),
          true,
          `ninguna promoción ganó: ${statuses.join('/')}`,
        );
        const loser = outcomeA.status === 'PROMOTED' ? outcomeB : outcomeA;
        assert.notEqual(loser.status, 'PROMOTED', 'las dos promociones ganaron');
        assert.equal(loser.mutated, false);
        assert.ok(
          ['FISCAL_IDENTITY_CONFLICT', 'STALE_IDENTITY_EPOCH', 'ERROR'].includes(loser.status),
          `desenlace no aprobado para el perdedor: ${loser.status}`,
        );

        // 🔴 LA INVARIANTE: en el lote hay como mucho UNA fila con esa identidad fiscal.
        const { rows } = await obs.query(
          `SELECT count(*)::int AS n FROM public.prospect_candidates
            WHERE batch_id = $1 AND tax_identifier = $2`,
          [batchId, taxIdentifier],
        );
        assert.equal(Number(rows[0].n), 1, 'dos candidatos del mismo lote comparten identidad fiscal');

        // Y el rechazo no cita la identidad con la que chocó.
        assert.equal(/\d{8}/.test(loser.reason), false, 'el motivo del rechazo cita dígitos');
      });

      it('CASE 19 — un segundo lote SÍ puede reclamar la misma identidad', async () => {
        if (datasetSkip !== false) return;
        // La valla es de LOTE. Dos lotes distintos que descubren la misma empresa no compiten:
        // afirmar lo contrario convertiría la valla en una unicidad global que nadie decidió.
        const group = uniqueGroups()[3]!;
        const batchId = await newBatch();
        const [candidateId] = await newCandidates(batchId, await epochOf(batchId), [
          { name: group.rows[0]!.legalName, country_code: 'BR' },
        ]);
        const client = supabaseShim();
        const promotion = await runFencedIdentityPromotion({
          client,
          batchId,
          candidateId: candidateId!,
          countryCode: 'BR',
          taxIdentifier: group.rows[0]!.normalizedTaxId,
          candidateName: group.rows[0]!.legalName,
          snapshot: await loadBatchIdentityRegistry(client, batchId),
        });
        assert.equal(promotion.status, 'PROMOTED', promotion.reason);
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    describe('lo que este corte NO hace', () => {
      it('CASE 20 — ninguna cohorte resolvió por algo que no sea el nombre exacto', async () => {
        if (datasetSkip !== false) return;
        // Un nombre real al que se le quita UNA letra no debe resolver a nada: si resolviera,
        // habría entrado un emparejamiento aproximado por alguna puerta.
        const group = uniqueGroups()[4]!;
        const mutilated = group.canonicalName.slice(0, -1);
        const resolution = await resolveFor(mutilated);
        assert.notEqual(
          resolution.status,
          'RESOLVED_UNIQUE',
          'un nombre truncado resolvió: hay emparejamiento aproximado',
        );
      });

      it('CASE 21 — el resolver nunca devuelve identidad sin unicidad', async () => {
        if (datasetSkip !== false) return;
        for (const group of multiGroups().slice(0, 30)) {
          const resolution = await resolveFor(group.rows[0]!.legalName);
          if (resolution.status !== 'RESOLVED_UNIQUE') {
            assert.equal(resolution.resolvedNormalizedTaxId, null);
          }
        }
      });
    });
  },
);

/**
 * Reintroduce acentos donde el castellano/portugués los llevaría.
 *
 * 🔴 Existe porque Receita publica la razão social SIN acentos (la muestra real trae 1 nombre
 * acentuado en 50.000), así que una cohorte de normalización construida sólo con nombres reales no
 * ejercitaría la descomposición NFD en absoluto. La variante es SINTÉTICA y § 8 lo autoriza
 * explícitamente para la cohorte E; el nombre subyacente sigue siendo real.
 */
function withAccents(name: string): string {
  return name
    .replace(/A/g, 'Á')
    .replace(/E/g, 'Ê')
    .replace(/O/g, 'Ó')
    .replace(/C/g, 'Ç');
}
