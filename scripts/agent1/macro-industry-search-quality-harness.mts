/**
 * macro-industry-search-quality-harness.mts — Comparador OFFLINE de las
 * hipótesis de consulta de las 12 Macro Industrias.
 *
 * AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 · §§ 15, 16, 17 y 23.
 *
 * ── Qué responde ──────────────────────────────────────────────────────────────
 *
 * «¿Le estamos preguntando al proveedor cosas materialmente distintas para Salud
 * & Farmacéuticos, para Retail y para Tecnología?»
 *
 * El retest de Salud (`74a49b01`) demostró que la respuesta podía ser NO sin que
 * nadie lo notara: dos corridas con keywords distintas devolvieron las mismas 20
 * empresas porque los términos amplios dominaban el OR. Esa comprobación costó 20
 * créditos. Este arnés la hace por 0.
 *
 * ── Cero llamadas al proveedor ────────────────────────────────────────────────
 *
 * No hay red, no hay Supabase, no hay claves. Sólo el catálogo de código y el
 * redactor de consulta, que es puro. Ejecutar esto NUNCA gasta un crédito.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────────
 *
 *   node --import tsx scripts/agent1/macro-industry-search-quality-harness.mts
 *   node --import tsx scripts/agent1/macro-industry-search-quality-harness.mts --json
 *
 * (Extensión `.mts` a propósito: tsx compila `.ts` a CJS y el `await` de nivel
 * superior fallaría.)
 */

import {
  buildMacroIndustryQueryPlan,
  MACRO_QUERY_MAX_BROAD_SHARE,
} from '../../src/server/agents/prospecting-toolkit/apollo-macro-industry-query-terms';
import {
  MACRO_INDUSTRIES,
  MACRO_INDUSTRY_CATALOG_VERSION,
} from '../../src/modules/macro-industry-catalog/macro-industries';

type Row = {
  key: string;
  displayName: string;
  effectiveKeywords: string[];
  specificTravelled: string[];
  broadAdmitted: string[];
  broadWithheld: string[];
  exclusions: string[];
  broadShare: number;
  coverageComplete: boolean;
  fingerprint: string;
};

const rows: Row[] = MACRO_INDUSTRIES.map((definition) => {
  const plan = buildMacroIndustryQueryPlan({ definition });
  return {
    key: plan.macroIndustryKey,
    displayName: plan.macroIndustryDisplayName,
    effectiveKeywords: plan.effectiveKeywords,
    specificTravelled: plan.coverage.coveringSpecificTerms,
    broadAdmitted: plan.admittedBroadTerms,
    broadWithheld: plan.withheldBroadTerms.map((w) => `${w.term} (${w.reason})`),
    exclusions: plan.exclusionTerms,
    broadShare: plan.coverage.broadTermShare,
    coverageComplete: plan.coverage.complete,
    fingerprint: plan.fingerprint,
  };
});

// ─── Comprobaciones que este arnés existe para hacer ──────────────────────────

const failures: string[] = [];

// 1. Toda macro industria emite una consulta con cobertura completa.
for (const row of rows) {
  if (!row.coverageComplete) {
    failures.push(`${row.key}: cobertura incompleta`);
  }
  if (row.broadShare > MACRO_QUERY_MAX_BROAD_SHARE) {
    failures.push(
      `${row.key}: los términos amplios ocupan ${(row.broadShare * 100).toFixed(0)}% de la consulta`,
    );
  }
}

// 2. Las 12 huellas son distintas entre sí. Dos macro industrias con la misma
//    huella preguntarían lo mismo, que es el defecto del retest de Salud.
const fingerprints = new Map<string, string[]>();
for (const row of rows) {
  const bucket = fingerprints.get(row.fingerprint) ?? [];
  bucket.push(row.key);
  fingerprints.set(row.fingerprint, bucket);
}
for (const [fingerprint, keys] of fingerprints) {
  if (keys.length > 1) {
    failures.push(`huella compartida ${fingerprint.slice(0, 12)}…: ${keys.join(', ')}`);
  }
}

// 3. Solape de términos entre pares. Un solape alto significa que dos hipótesis
//    devolverían en gran medida el mismo conjunto.
const OVERLAP_ALERT = 0.34;
const overlaps: Array<{ a: string; b: string; jaccard: number }> = [];
for (let i = 0; i < rows.length; i += 1) {
  for (let j = i + 1; j < rows.length; j += 1) {
    const a = new Set(rows[i].effectiveKeywords);
    const b = new Set(rows[j].effectiveKeywords);
    const intersection = [...a].filter((term) => b.has(term)).length;
    const union = new Set([...a, ...b]).size;
    const jaccard = union === 0 ? 0 : intersection / union;
    if (jaccard > 0) overlaps.push({ a: rows[i].key, b: rows[j].key, jaccard });
    if (jaccard >= OVERLAP_ALERT) {
      failures.push(
        `solape ${(jaccard * 100).toFixed(0)}% entre ${rows[i].key} y ${rows[j].key}`,
      );
    }
  }
}

// ─── Salida ───────────────────────────────────────────────────────────────────

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify(
      { catalogVersion: MACRO_INDUSTRY_CATALOG_VERSION, rows, overlaps, failures },
      null,
      2,
    ),
  );
} else {
  console.log(`\nCatálogo macro ${MACRO_INDUSTRY_CATALOG_VERSION} — ${rows.length} macro industrias\n`);
  for (const row of rows) {
    console.log(`── ${row.displayName}  [${row.key}]`);
    console.log(`   huella            ${row.fingerprint.slice(0, 16)}…`);
    console.log(`   viajan            ${row.effectiveKeywords.length} términos`);
    console.log(`   específicos       ${row.specificTravelled.join(', ')}`);
    console.log(
      `   amplios admitidos ${row.broadAdmitted.join(', ') || '(ninguno)'}  ` +
        `— ${(row.broadShare * 100).toFixed(0)}% de la consulta`,
    );
    console.log(`   amplios retenidos ${row.broadWithheld.join(', ') || '(ninguno)'}`);
    console.log(`   exclusiones (locales, NO viajan) ${row.exclusions.length}`);
    console.log('');
  }

  const top = [...overlaps].sort((x, y) => y.jaccard - x.jaccard).slice(0, 8);
  console.log('── Mayor solape de términos entre pares');
  for (const pair of top) {
    console.log(`   ${(pair.jaccard * 100).toFixed(0)}%  ${pair.a} ↔ ${pair.b}`);
  }
  console.log('');
}

if (failures.length > 0) {
  console.error('\nFALLOS:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('OK — 12 hipótesis distintas, ningún término amplio dominante, 0 llamadas al proveedor.\n');
