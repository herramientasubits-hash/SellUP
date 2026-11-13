// Guardas estáticas de la auditoría de permisos (bloque C: administración y
// transversales). Se leen los fuentes SIN comentarios para que un comentario no
// haga pasar la guarda.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { restrictCreatedByIds } from '@/modules/agent1-effectiveness/people-scope';

function src(rel: string): string {
  const raw = readFileSync(path.join(process.cwd(), rel), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function fnBody(code: string, signature: string, length = 900): string {
  const start = code.indexOf(signature);
  assert.ok(start !== -1, `no se encontró ${signature}`);
  return code.slice(start, start + length);
}

const PREVIEW_AWARE_ADMIN_FILES = [
  'src/modules/ai-config/actions.ts',
  'src/modules/integrations/actions.ts',
  'src/modules/prospecting-config/actions.ts',
  'src/modules/source-catalog/source-credential-actions.ts',
  'src/modules/source-catalog/denue-batches-actions.ts',
  'src/modules/source-catalog/socrata-batches-actions.ts',
  'src/modules/source-catalog/source-discovery-actions.ts',
  'src/modules/automations/actions.ts',
  'src/modules/system-status/actions.ts',
  'src/modules/usage-tracking/actions.ts',
  'src/modules/admin/cleanup-qa-prospecting.ts',
];

describe('«Ver como…»: las comprobaciones de administración usan isCurrentUserAdmin', () => {
  for (const file of PREVIEW_AWARE_ADMIN_FILES) {
    it(file, () => {
      const code = src(file);
      assert.match(code, /import\s*\{[^}]*\bisCurrentUserAdmin\b[^}]*\}\s*from\s*'@\/modules\/access\/actions'/);
      assert.doesNotMatch(code, /from\('roles'\)/, 'no debe leer el rol directo de la tabla roles');
      assert.doesNotMatch(code, /rpc\('is_admin'/, 'no debe llamar is_admin directo');
    });
  }

  it('ai-config ya no exporta su propia copia de isCurrentUserAdmin', () => {
    assert.doesNotMatch(src('src/modules/ai-config/actions.ts'), /export async function isCurrentUserAdmin/);
  });

  const ROUTES = [
    'src/app/api/integrations/slack/oauth/start/route.ts',
    'src/app/api/integrations/slack/oauth/callback/route.ts',
    'src/app/api/debug/agent1-apollo-config/route.ts',
    'src/app/api/debug/agent1-provider-scorecard/route.ts',
    'src/app/api/debug/agent2-apollo-people-search/route.ts',
    'src/app/api/debug/agent2a-phone-waterfall-config/route.ts',
    'src/app/api/debug/ai-provider-health/route.ts',
    'src/app/api/debug/commercial-scope-config/route.ts',
  ];
  for (const route of ROUTES) {
    it(`${route} niega administración con «Ver como…» activo`, () => {
      assert.match(src(route), /readRolePreview\(\)/);
    });
  }
});

describe('Bandeja de créditos: sólo personas activas', () => {
  const code = src('src/modules/credit-approvals/actions.ts');
  it('usa getCurrentActiveUser y no getCurrentUser', () => {
    assert.match(code, /getCurrentActiveUser\(\)/);
    assert.doesNotMatch(code, /getCurrentUser\(\)/);
  });
  it('getCurrentActiveUser exige access_status active', () => {
    const body = fnBody(src('src/modules/access/actions.ts'), 'export async function getCurrentActiveUser', 300);
    assert.match(body, /access_status === 'active'/);
  });
});

describe('Catálogo de fuentes: probar conexión y detalle son de administración', () => {
  const code = src('src/modules/source-catalog/actions.ts');
  it('testSourceConnectionAction exige admin antes de probar', () => {
    const body = fnBody(code, 'export async function testSourceConnectionAction', 1500);
    const gate = body.indexOf('isCurrentUserAdmin()');
    assert.ok(gate !== -1 && gate < body.indexOf('runSourceConnectionTest('));
  });
  it('getSourceDetailDrawerDataAction exige admin antes de leer', () => {
    const body = fnBody(code, 'export async function getSourceDetailDrawerDataAction', 1200);
    const gate = body.indexOf('isCurrentUserAdmin()');
    assert.ok(gate !== -1 && gate < body.indexOf('getSourceConnectionRecord('));
  });
});

describe('Webhook de SAMU y health', () => {
  it('SAMU cierra sin secreto (503) y compara en tiempo constante', () => {
    const code = src('src/app/api/integrations/samu/webhook/route.ts');
    assert.match(code, /status: 503/);
    assert.match(code, /timingSafeEqual/);
    assert.doesNotMatch(code, /providedSecret !== expectedSecret/);
  });
  it('/api/health no revela variables de entorno', () => {
    assert.doesNotMatch(src('src/app/api/health/route.ts'), /process\.env/);
  });
});

describe('Uso de IA: manager y líder ven su equipo; teléfonos sólo admin', () => {
  it('panel del Agente 1 deja pasar roles de equipo con su alcance', () => {
    const code = src('src/modules/agent1-effectiveness/actions.ts');
    assert.match(code, /TEAM_ROLE_KEYS/);
    assert.match(code, /resolveUsagePeopleScope\(/);
    assert.match(code, /restrictCreatedByIds\(/);
  });
  it('resultados de Rumbo filtran por las personas del alcance', () => {
    const code = src('src/modules/agent3-results/queries.ts');
    assert.match(code, /resolveUsagePeopleScope\(/);
    assert.match(code, /createdByIds:/);
    assert.match(src('src/server/agents/first-call/approach-results.server.ts'), /\.in\('created_by'/);
  });
  it('la tarjeta de supresión de teléfonos sólo se pinta para admin', () => {
    const code = src('src/app/(sellup)/ai-usage/page.tsx');
    assert.match(code, /viewerIsAdmin \? \(\s*<Suspense fallback=\{<PhoneSuppressionNotEvaluablePanelSkeleton/);
  });
  it('restrictCreatedByIds intersecta con el equipo', () => {
    assert.deepEqual(restrictCreatedByIds(undefined, ['a', 'b']), ['a', 'b']);
    assert.deepEqual(restrictCreatedByIds(['a', 'z'], ['a', 'b']), ['a']);
    assert.deepEqual(restrictCreatedByIds(['z'], ['a']), []);
    assert.equal(restrictCreatedByIds(undefined, null), undefined);
    assert.deepEqual(restrictCreatedByIds(['x'], null), ['x']);
  });
});

describe('Identidad con «Ver como…» y sesiones no activas', () => {
  it('Mis avisos toma el rol de getCurrentUser (no relee roles)', () => {
    const body = fnBody(src('src/modules/notifications/my-notification-actions.ts'), 'async function me()', 500);
    assert.match(body, /getCurrentUser\(\)/);
    assert.doesNotMatch(body, /roles\(key\)/);
  });
  it('Actividad resuelve a la persona con resolveCommercialScope', () => {
    const body = fnBody(src('src/modules/system-status/activity-actions.ts'), 'async function resolveCurrentUser', 400);
    assert.match(body, /resolveCommercialScope\(\)/);
    assert.doesNotMatch(body, /auth\.getUser/);
  });
  it('campanita y validateExploratorySearch exigen acceso activo', () => {
    assert.equal((src('src/modules/notifications/actions.ts').match(/hasActiveAccess\(\)/g) ?? []).length, 4);
    assert.match(src('src/modules/industry-catalog/action.ts'), /hasActiveAccess\(\)/);
  });
});

describe('Drive: el token de otra persona no es una acción del servidor', () => {
  it('actions.ts ya no exporta getAuthorizedDriveClientForUser ni getDriveConnectionStats', () => {
    const code = src('src/modules/drive/actions.ts');
    assert.doesNotMatch(code, /export async function getAuthorizedDriveClientForUser/);
    assert.doesNotMatch(code, /export async function getDriveConnectionStats/);
  });
  it("drive.server.ts no es 'use server'", () => {
    assert.doesNotMatch(src('src/modules/drive/drive.server.ts'), /^'use server'/m);
  });
});

describe('Acciones de lectura de administración con guarda', () => {
  const CASES: Array<[string, string[]]> = [
    ['src/modules/ai-config/actions.ts', ['getAllAIProviders', 'getAllAIModels', 'getAIConfigSummary', 'getProviderConnectionStatus', 'getAiProviderConnectionStatus']],
    ['src/modules/automations/actions.ts', ['getAllAutomations', 'getAutomationsSummary', 'getAutomationConfig']],
    ['src/modules/integrations/actions.ts', ['getAllIntegrations', 'getHubSpotIntegration', 'getSlackIntegration', 'getSamuIntegration', 'getTavilyIntegration', 'getGoogleCSEIntegration']],
    ['src/modules/prospecting-config/actions.ts', ['getAllProspectingProviders', 'getProspectingStats', 'getApolloConnection', 'getLushaConnection']],
    ['src/modules/access/actions.ts', ['getUsersSummary', 'getAllRoles', 'getOrganizationGroups']],
  ];
  for (const [file, fns] of CASES) {
    const code = src(file);
    for (const fn of fns) {
      it(`${fn} (${file})`, () => {
        const body = fnBody(code, `export async function ${fn}(`, 450);
        assert.match(body, /isCurrentUserAdmin\(\)|denyUnlessAdmin\(\)/);
      });
    }
  }
});
