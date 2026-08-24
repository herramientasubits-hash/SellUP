/**
 * legacy-lusha-preview-start-loader-parity.test.ts
 * (Agente 2A · AGENT2A-LEGACY-LUSHA-START-REJECTION-DIAGNOSTIC-1 · § 4 y § 6)
 *
 * LA INVARIANTE
 *
 *   Con los MISMOS hechos durables, el MISMO actor, el MISMO flag y las MISMAS
 *   identidades persistidas, la vista previa y el ARRANQUE no pueden discrepar en
 *   elegibilidad ni en modalidad.
 *
 * El incidente que la motiva es el de un candidato que la vista previa declaró
 * elegible con tope 6 y que el clic rechazó. Un veredicto así sólo puede nacer de tres
 * sitios: hechos que cambiaron de verdad entre el render y el clic (legítimo), un
 * evaluador distinto (defecto), o una PROYECCIÓN distinta — que los dos lados lean el
 * candidato con selects u opciones diferentes y por tanto evalúen sobre hechos que no
 * son los mismos. Los dos últimos son los que esta suite cierra.
 *
 * Y los cierra sobre el BORDE DE I/O REAL, no sobre objetos sintéticos: las suites de
 * core ya prueban el evaluador puro, pero un evaluador correcto alimentado por dos
 * lecturas distintas produce exactamente el síntoma observado. Aquí se ejecutan los
 * loaders de verdad contra un driver simulado y se comparan sus salidas.
 *
 * OFFLINE: sin red, sin base de datos, sin Apollo, sin Lusha y sin un solo crédito.
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── Hechos durables del candidato del incidente ──────────────────────────────

const CANDIDATE_ID = '7576d824-b49c-40bc-85aa-879032b4f134';
const APOLLO_PERSON_ID = '6633076e37001b0007d086ce';

/**
 * Fila tal y como está persistida: nacida en Apollo, Apollo YA terminó
 * `no_phone_found` y está fechado, sin teléfono, con LinkedIn y sin email.
 */
const CANDIDATE_ROW = {
  id: CANDIDATE_ID,
  status: 'pending_review',
  source: 'apollo',
  source_contact_id: APOLLO_PERSON_ID,
  email: null,
  linkedin_url: 'https://www.linkedin.com/in/perfil-sintetico',
  first_name: 'Nombre',
  last_name: 'Apellido',
  phone: null,
  phone_reveal_status: 'no_phone_found',
  phone_reveal_provider: 'apollo',
  phone_reveal_completed_at: '2026-08-20T15:04:00.000Z',
  run: {
    account_id: 'acct-1',
    company_name: 'Empresa De Prueba',
    company_country_code: null,
    company_domain: 'ejemplo.test',
  },
};

/** `contact_provider_identities` (migración 124): 0 filas, como en el incidente. */
const IDENTITY_ROWS: unknown[] = [];

type DbError = { code: string; message: string };

/** Cuántas veces se leyó cada tabla. Prueba QUÉ proyección pidió cada lado. */
const reads: string[] = [];

function chain(result: {
  data: unknown;
  error: DbError | null;
}): Record<string, unknown> {
  const self: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'in',
    'order',
    'limit',
    'maybeSingle',
    'single',
  ]) {
    self[method] = () => self;
  }
  self.then = (
    resolve: (v: { data: unknown; error: DbError | null }) => unknown,
  ): unknown => resolve(result);
  return self;
}

mock.module('@/lib/supabase/admin', {
  namedExports: {
    createSupabaseAdminClient: () => ({
      from: (table: string) => {
        reads.push(table);
        if (table === 'contact_enrichment_candidates') {
          return chain({ data: CANDIDATE_ROW, error: null });
        }
        if (table === 'contact_provider_identities') {
          return chain({ data: IDENTITY_ROWS, error: null });
        }
        return chain({ data: null, error: null });
      },
    }),
  },
});

// El flag del waterfall ENCENDIDO: es la condición bajo la que la vista previa contesta
// y bajo la que el arranque enchufa la vía de pago. Los dos leen la MISMA función.
mock.module('@/lib/feature-flags.server', {
  namedExports: {
    isPhoneRevealWaterfallEnabled: () => true,
    isLushaPhoneRevealFallbackEnabled: () => true,
  },
});

// Los módulos bajo prueba se importan DESPUÉS de los dobles, y dentro de `before`
// porque tsx compila estos ficheros a CJS y el `await` de nivel superior no existe ahí.
type WaterfallDeps = typeof import('../phone-reveal-waterfall-deps');
type WaterfallCore = typeof import('../phone-reveal-waterfall-core');
let depsModule: WaterfallDeps;
let coreModule: WaterfallCore;

before(async () => {
  depsModule = await import('../phone-reveal-waterfall-deps');
  coreModule = await import('../phone-reveal-waterfall-core');
});

const ACTOR = { internalUserId: 'user-admin', roleKey: 'admin' } as const;

// ═══════════════════════════════════════════════════════════════
// H · § 6 — paridad de la PROYECCIÓN real
// ═══════════════════════════════════════════════════════════════

describe('H — la vista previa y el ARRANQUE leen exactamente la misma evidencia', () => {
  it('las dos proyecciones son idénticas campo a campo', async () => {
    // Lo que llama la server action de la vista previa.
    const previewEvidence = await depsModule.loadLegacyEvidenceForWaterfall(
      CANDIDATE_ID,
      {
        includeIdentityFacts: true,
      },
    );
    // Lo que llama el ARRANQUE, a través de su constructor REAL de deps.
    const startEvidence = await depsModule
      .buildStartLegacyWaterfallDeps(ACTOR)
      .loadLegacyEvidence(CANDIDATE_ID);

    assert.ok(previewEvidence);
    assert.ok(startEvidence);
    assert.deepEqual(startEvidence, previewEvidence);
  });

  it('ningún campo que decide la modalidad puede faltar en uno de los dos lados', async () => {
    const startEvidence = await depsModule
      .buildStartLegacyWaterfallDeps(ACTOR)
      .loadLegacyEvidence(CANDIDATE_ID);
    assert.ok(startEvidence);
    // La terna canónica de la evidencia Apollo, el origen, el id nativo y —lo que este
    // hito añadió— las identidades y los hechos de búsqueda. Un `undefined` en
    // cualquiera de los dos últimos haría que el arranque evaluara la vía de pago sobre
    // hechos que nadie cargó, y el veredicto falso sería «no hay con qué buscar».
    assert.equal(startEvidence.phoneRevealStatus, 'no_phone_found');
    assert.equal(startEvidence.phoneRevealProvider, 'apollo');
    assert.ok(startEvidence.phoneRevealCompletedAt);
    assert.equal(startEvidence.hasPhone, false);
    assert.equal(startEvidence.candidateStatus, 'pending_review');
    assert.equal(startEvidence.source, 'apollo');
    assert.equal(startEvidence.sourceContactId, APOLLO_PERSON_ID);
    assert.deepEqual(startEvidence.providerIdentities, []);
    assert.ok(startEvidence.identitySearchFacts, 'los hechos de búsqueda SÍ se cargaron');
    assert.equal(
      startEvidence.identitySearchFacts?.linkedinUrl,
      CANDIDATE_ROW.linkedin_url,
    );
  });

  it('el ARRANQUE lee `contact_provider_identities`: sin eso compraría lo que ya tiene', async () => {
    reads.length = 0;
    await depsModule
      .buildStartLegacyWaterfallDeps(ACTOR)
      .loadLegacyEvidence(CANDIDATE_ID);
    assert.ok(
      reads.includes('contact_provider_identities'),
      `tablas leídas: ${reads.join(', ')}`,
    );
  });

  it('con la MISMA evidencia, los dos evaluadores dan el MISMO veredicto y el MISMO tope', async () => {
    const evidence = await depsModule.loadLegacyEvidenceForWaterfall(CANDIDATE_ID, {
      includeIdentityFacts: true,
    });
    assert.ok(evidence);

    // El lado de la vista previa: el flag está encendido, que es exactamente la
    // condición con la que el arranque enchufa la vía de pago.
    const previewView = coreModule.buildLegacyPhoneRevealAuthorizationPreview(evidence, {
      identitySearchAuthorized: true,
    });
    // El lado del arranque: `identitySearchAllowed` resuelto por el constructor REAL de
    // deps a partir del MISMO flag.
    const startAllowed =
      depsModule.buildStartLegacyWaterfallDeps(ACTOR).identitySearchAllowed === true;
    const startView = coreModule.buildLegacyPhoneRevealAuthorizationPreview(evidence, {
      identitySearchAuthorized: startAllowed,
    });

    assert.equal(startAllowed, true, 'el arranque puede comprar la identidad que falta');
    assert.deepEqual(startView, previewView);
    assert.equal(previewView.eligible, true);
    assert.equal(previewView.requiresIdentitySearch, true);
    assert.equal(previewView.maxCredits, 6);
  });

  it('el evaluador es UNO: la vista previa no lo reimplementa', async () => {
    const evidence = await depsModule.loadLegacyEvidenceForWaterfall(CANDIDATE_ID, {
      includeIdentityFacts: true,
    });
    assert.ok(evidence);
    const direct = coreModule.evaluatePhoneRevealWaterfallLegacyEligibility(evidence, {
      identitySearchAuthorized: true,
    });
    const view = coreModule.buildLegacyPhoneRevealAuthorizationPreview(evidence, {
      identitySearchAuthorized: true,
    });
    assert.equal(view.eligible, direct.eligible);
    assert.equal(view.reason, direct.reason);
    assert.equal(view.requiresIdentitySearch, direct.requiresIdentitySearch === true);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 4 — guardas ESTÁTICAS del cableado
// ═══════════════════════════════════════════════════════════════

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = join(here, '..');

function readModule(relative: string): string {
  return readFileSync(join(moduleDir, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const actions = readModule('phone-reveal-waterfall-actions.ts');
const gate = readModule('phone-reveal-waterfall-legacy-start-gate.ts');
const legacyActions = readModule('phone-reveal-waterfall-legacy-actions.ts');
const deps = readModule('phone-reveal-waterfall-deps.ts');

describe('§ 4 — el cableado no puede divergir en silencio', () => {
  it('la vista previa legacy pide los hechos de identidad', () => {
    const slice = actions.slice(
      actions.indexOf('getLegacyPhoneRevealAuthorizationPreviewAction'),
    );
    assert.ok(/includeIdentityFacts:\s*true/.test(slice));
    assert.ok(/identitySearchAuthorized:\s*true/.test(slice));
  });

  it('la vista previa legacy usa el MISMO loader que el arranque', () => {
    const slice = actions.slice(
      actions.indexOf('getLegacyPhoneRevealAuthorizationPreviewAction'),
    );
    assert.ok(/loadLegacyEvidenceForWaterfall\(/.test(slice));
    assert.ok(/buildLegacyPhoneRevealAuthorizationPreview\(/.test(slice));
  });

  it('la ruta legacy AUTOMÁTICA cablea la puerta de privacidad ANTES de reservar', () => {
    // Sin esto, un candidato bloqueado GRATIS crea corrida y reserva créditos para
    // liberarlos acto seguido: el neto económico ya era 0, pero quedaban escrituras que
    // nadie podía gastar y exposición ocupada durante el intervalo.
    const slice = deps.slice(
      deps.indexOf('export async function startLegacyPhoneRevealWaterfallForCandidate'),
    );
    const wirings = slice.match(/gatePrivacyBeforeReserving:\s*true/g) ?? [];
    assert.equal(wirings.length, 2, 'la cablean las DOS entradas: manual y automática');
  });

  it('la traducción de motivos es exhaustiva y no tiene cajón de sastre', () => {
    // Un motivo nuevo debe romper la compilación, no heredar una frase genérica.
    assert.ok(/const exhaustive:\s*never\s*=\s*reason/.test(gate));
    // `not_eligible` sólo sobrevive para la entrada inválida del cliente.
    const occurrences = gate.match(/return 'not_eligible';/g) ?? [];
    assert.equal(occurrences.length, 1, 'un solo camino a `not_eligible`');
  });

  it('la server action delega en el gate puro y NO reimplementa el mapeo', () => {
    assert.ok(/classifyLegacyPhoneRevealStartFailure\(/.test(legacyActions));
    // El motivo mecánico sigue viajando intacto al cliente para diagnóstico.
    assert.ok(/reason:\s*result\.reason/.test(legacyActions));
  });

  it('el arranque legacy emite su evento en TODAS las salidas', () => {
    const slice = deps.slice(
      deps.indexOf('export async function startLegacyPhoneRevealWaterfallForCandidate'),
    );
    const emissions = slice.match(/emitLegacyStartOutcome\(/g) ?? [];
    assert.equal(emissions.length, 2, 'la excepción y el resultado del core');
  });
});
