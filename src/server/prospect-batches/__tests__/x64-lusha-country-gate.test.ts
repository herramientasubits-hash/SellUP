/**
 * x64-lusha-country-gate.test.ts — X6.4-A.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * La corrida `bedebe9b-0e22-4c8d-99e7-2c8d4a95a4c8` (CO × retail) persistió
 * «Maestro Perú» (`www.maestro.com.pe`) con `country_code = 'CO'`. La pierna
 * Lusha pasaba por `evaluateProspectIntakeGate`, cuyo eje de país compara el
 * `countryCode` que el PROVEEDOR declaró — y Lusha declaró `CO`, así que no
 * había contradicción que ver. La evidencia estaba en el dominio, y el gate que
 * lee dominios (`evaluateCountryCompatibility`) sólo lo invocaba la ruta Apollo.
 *
 * ── 🔴 ALCANCE: el ownership NO entra en X6.4 ───────────────────────────────
 *
 * Una versión anterior aplicaba también `evaluateCompanyOwnership` a esta
 * pierna. Se retiró al medirlo contra datos REALES: 4 de las 25 empresas del
 * lote vivo `26f49596` eran rechazos falsos (EPM, RCN TV, Caracol Televisión,
 * Universidad de Nariño), más `D1 S.A.S` en `bedebe9b…`. El defecto vive en el
 * heurístico nombre↔dominio y es otro corte. Aquí se fija que X6.4 NO introduce
 * ownership en la ruta Lusha.
 *
 * 🔴 0 proveedores · 0 créditos · 0 red · 0 Supabase real · 0 Producción ·
 * 0 migraciones · 0 banderas. Todo inyectado o puro.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { evaluateLushaCountryGate } from '../lusha-country-gate';
import { resolveLushaCandidatesDuplicateState } from '../lusha-pending-review';
import type { LushaPreviewCompany, LushaPreviewInput } from '../lusha-preview';
import { resolveLushaDiscardDisposition } from '@/modules/prospect-discards/lusha-mapping';
import { decideCandidateSurvival } from '@/server/agents/prospecting-toolkit/candidate-survival';
import type { ProspectSearchCriteria } from '@/server/agents/prospect-intake/types';

// ── Arnés ────────────────────────────────────────────────────────────────────

const CRITERIA: ProspectSearchCriteria = {
  countryCode: 'CO',
  industry: 'Retail',
  subindustries: [],
  minEmployees: 200,
} as unknown as ProspectSearchCriteria;

function company(overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  return {
    providerCompanyId: 'lusha-1',
    name: 'Makro Colombia',
    domain: 'www.makro.com.co',
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Retail',
    employeesExact: 1200,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: null,
    score: 1,
    passesGate: true,
    ...overrides,
  } as unknown as LushaPreviewCompany;
}

// Igual que el writer: Lusha sólo aporta `domain`, y el gate lo normaliza.
const co = (domain: string | null, targetCountryCode: string | null = 'CO') =>
  evaluateLushaCountryGate({ domain, website: null, targetCountryCode });

// ═══════════════════════════════════════════════════════════════════════════
// § A · una corrida CO no admite una empresa claramente extranjera
// ═══════════════════════════════════════════════════════════════════════════

describe('§ A · país incompatible', () => {
  it('1 — el caso REAL: `maestro.com.pe` en una corrida CO se rechaza', () => {
    const rejection = co('www.maestro.com.pe');
    assert.ok(rejection !== null, '🔴 sin rechazo se repite la corrida bedebe9b');
    assert.equal(rejection.kind, 'country_incompatible');
    // El motivo es el VERBATIM de la autoridad, no una etiqueta nuestra.
    assert.match(rejection.reason, /foreign_country_tld:\.com\.pe:PE/);
  });

  it('1b — el `country_code` que el PROVEEDOR declara no salva a la empresa', () => {
    // Lusha etiquetó `CO` esa fila. El dominio dice otra cosa, y el dominio manda.
    assert.equal(co('maestro.com.pe')?.kind, 'country_incompatible');
  });

  it('1c — una URL ENTERA en `domain` se normaliza antes de juzgar', () => {
    // Lusha puede devolver `https://www.maestro.com.pe/` como `domain`.
    assert.equal(co('https://www.maestro.com.pe/?utm=x')?.kind, 'country_incompatible');
  });

  it('1d — otros ccTLD extranjeros caen por la MISMA tabla, sin una nueva', () => {
    for (const domain of ['tienda.com.mx', 'tienda.cl', 'tienda.com.br']) {
      assert.equal(co(domain)?.kind, 'country_incompatible', domain);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § B · país válido y AUSENCIA de evidencia — ninguno se rechaza
// ═══════════════════════════════════════════════════════════════════════════

describe('§ B · país válido y ausencia de evidencia', () => {
  it('2 — un dominio colombiano (`.com.co`) continúa', () => {
    assert.equal(co('www.makro.com.co'), null);
  });

  it('2b — el ccTLD desnudo `.co` continúa', () => {
    assert.equal(co('wom.co'), null);
  });

  it('3 — un dominio GLOBAL sin señal de país continúa: ausencia ≠ rechazo', () => {
    // 🔴 La regla del contrato X6.2-A: la falta de evidencia no rechaza. Esta
    // empresa sigue su camino y acaba, como hoy, en `needs_review`.
    assert.equal(co('www.haceb.com'), null);
  });

  it('3b — sin dominio NO se inventa un rechazo', () => {
    assert.equal(co(null), null);
  });

  it('3c — sin país pedido no hay contradicción posible', () => {
    assert.equal(co('www.maestro.com.pe', null), null);
  });

  it('3d — un TLD extranjero CON señal de path Colombia sigue pasando', () => {
    // La excepción ya existente de `evaluateCountryCompatibility`; no se toca.
    assert.equal(
      evaluateLushaCountryGate({
        domain: 'tienda.com.pe',
        website: 'https://tienda.com.pe/colombia/retail',
        targetCountryCode: 'CO',
      }),
      null,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § C · el rechazo ocurre ANTES de persistir, y deja disposición durable
// ═══════════════════════════════════════════════════════════════════════════

describe('§ C · antes de persistir + trazabilidad', () => {
  it('la empresa extranjera NO llega al chequeo de duplicados ni a `resolved`', async () => {
    const duplicateChecks: string[] = [];
    const input = { countryCode: 'CO' } as unknown as LushaPreviewInput;

    const outcome = await resolveLushaCandidatesDuplicateState(
      {
        checkCompanyDuplicate: async (dup: { name?: string | null }) => {
          duplicateChecks.push(dup.name ?? '');
          return {
            status: 'new_candidate',
            confidence: 0,
            input: { name: dup.name ?? '' },
            matches: [],
            summary: '',
            checkedSources: ['sellup', 'hubspot'],
          } as never;
        },
        fetchActiveCandidates: async () => [],
        officialSourceResolvers: [],
      } as never,
      input,
      [
        company({ providerCompanyId: 'l-1', name: 'Makro Colombia', domain: 'www.makro.com.co' }),
        company({ providerCompanyId: 'l-2', name: 'Maestro Perú', domain: 'www.maestro.com.pe' }),
      ],
      CRITERIA,
    );

    assert.equal(outcome.countryExcluded.length, 1);
    assert.equal(outcome.countryExcluded[0].company.name, 'Maestro Perú');
    assert.equal(outcome.countryExcluded[0].rejection.kind, 'country_incompatible');

    assert.deepEqual(outcome.resolved.map((r) => r.company.name), ['Makro Colombia']);
    assert.equal(
      duplicateChecks.includes('Maestro Perú'),
      false,
      '🔴 una empresa rechazada por país no puede llegar al chequeo de duplicados',
    );

    // 🔴 Ningún contador existente cambia de significado.
    assert.equal(outcome.gate.hardExcludedCount, 0);
    assert.equal(outcome.hardExcludedCompanies.length, 0);
  });

  it('una empresa a la que su dominio NO acredita sigue su curso (ownership fuera)', async () => {
    // 🔴 X6.4 no introduce ownership en esta pierna. `RCN TV` sobre
    // `canalrcn.com` —un rechazo FALSO del heurístico— llega al chequeo de
    // duplicados como siempre.
    const duplicateChecks: string[] = [];
    const outcome = await resolveLushaCandidatesDuplicateState(
      {
        checkCompanyDuplicate: async (dup: { name?: string | null }) => {
          duplicateChecks.push(dup.name ?? '');
          return {
            status: 'new_candidate',
            confidence: 0,
            input: { name: dup.name ?? '' },
            matches: [],
            summary: '',
            checkedSources: ['sellup', 'hubspot'],
          } as never;
        },
        fetchActiveCandidates: async () => [],
        officialSourceResolvers: [],
      } as never,
      { countryCode: 'CO' } as unknown as LushaPreviewInput,
      [
        company({ providerCompanyId: 'l-3', name: 'RCN TV', domain: 'canalrcn.com' }),
        company({ providerCompanyId: 'l-4', name: 'EPM', domain: 'une.com.co' }),
      ],
      CRITERIA,
    );
    assert.equal(outcome.countryExcluded.length, 0);
    assert.deepEqual(duplicateChecks.sort(), ['EPM', 'RCN TV']);
    assert.equal(outcome.resolved.length, 2);
  });

  it('la disposición durable usa un código que YA existe (0 migraciones)', () => {
    assert.deepEqual(
      resolveLushaDiscardDisposition({
        kind: 'country_incompatible',
        reason: 'foreign_country_tld:.com.pe:PE',
      }),
      { disposition: 'country_rejected', reasonCode: 'foreign_country_tld:.com.pe:PE' },
    );
  });

  it('sin motivo legible la disposición NO se pierde: cae a su código de respaldo', () => {
    assert.deepEqual(resolveLushaDiscardDisposition({ kind: 'country_incompatible' }), {
      disposition: 'country_rejected',
      reasonCode: 'country_incompatible',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § D · lo que este corte NO puede haber tocado
// ═══════════════════════════════════════════════════════════════════════════

const GATE_SOURCE = readFileSync(
  path.join(process.cwd(), 'src/server/prospect-batches/lusha-country-gate.ts'),
  'utf8',
);
const WRITER_SOURCE = readFileSync(
  path.join(process.cwd(), 'src/server/prospect-batches/lusha-pending-review.ts'),
  'utf8',
);
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('§ D · no-regresión y alcance', () => {
  it('🔴 X6.4 NO introduce ownership en la ruta Lusha', () => {
    for (const [name, source] of [
      ['lusha-country-gate.ts', GATE_SOURCE],
      ['lusha-pending-review.ts', WRITER_SOURCE],
    ] as const) {
      const code = strip(source);
      assert.equal(
        /evaluateCompanyOwnership|isBlockedByCompanyOwnership|resolveOwnershipEvaluationName/.test(
          code,
        ),
        false,
        `🔴 ${name} no puede invocar el gate de ownership: queda fuera de X6.4`,
      );
    }
  });

  it('el gate REUTILIZA la autoridad de país de Apollo, no la reimplementa', () => {
    assert.match(GATE_SOURCE, /import \{ evaluateCountryCompatibility \}/);
    const code = strip(GATE_SOURCE);
    // Ni listas de TLD propias, ni umbrales, ni una segunda tabla de países.
    assert.equal(/\.com\.pe|\.com\.mx|FOREIGN_COUNTRY_TLDS\s*=/.test(code), false);
  });

  it('`company-ownership-gate.ts` no fue modificado por este corte', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/company-ownership-gate.ts'),
      'utf8',
    );
    assert.equal(/X6\.4/.test(source), false, '🔴 X6.4 no puede tocar el gate de ownership');
  });

  it('`enrichment_cap_reached` no es un rechazo: X5 sigue en pie', () => {
    const decision = decideCandidateSurvival({
      mandatoryRejection: null,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
    });
    assert.equal(decision.survives, true);
    assert.equal(decision.cohort, 'survives_incomplete');

    const survival = strip(
      readFileSync(
        path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/candidate-survival.ts'),
        'utf8',
      ),
    );
    assert.equal(
      /enrichment_cap_reached/.test(survival),
      false,
      '🔴 el cupo de enrichment no puede volver a decidir supervivencia',
    );
  });

  it('el gate no puede convertirse en un tope de objetivo', () => {
    const code = strip(GATE_SOURCE);
    assert.equal(
      /targetGap|target_cap|requestedTarget|acceptedForTarget/.test(code),
      false,
      '🔴 el gate de país no sabe de objetivos',
    );
  });
});
