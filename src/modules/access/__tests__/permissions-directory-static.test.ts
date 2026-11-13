// Permisos 13-11 — guardas estáticas de la auditoría de Empresas / Por revisar /
// Descartadas / Búsquedas. La RLS de `internal_users` sólo deja a un no-admin leer
// SU fila: un embed `internal_users!…` o un `owner:owner_id (…)` con la sesión
// devuelve vacío para los demás (nombres en blanco, empresa sin dueño en HubSpot).
// Estas guardas impiden que vuelvan.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8');
/** Sin comentarios de línea ni de bloque: se mira el código, no la prosa. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const BATCH_ACTIONS = code(read('modules', 'prospect-batches', 'actions.ts'));
const ACCOUNT_ACTIONS = code(read('modules', 'accounts', 'actions.ts'));
const PIPELINE_ACTIONS = code(read('modules', 'pipeline', 'actions.ts'));
const DISCARD_QUERIES = code(read('modules', 'prospect-discards', 'queries.ts'));

describe('nombres de otras personas: por el directorio, no con la sesión', () => {
  it('Búsquedas, Por revisar y su auditoría no usan embeds de internal_users', () => {
    assert.doesNotMatch(BATCH_ACTIONS, /internal_users!/);
    assert.match(BATCH_ACTIONS, /loadDirectoryUsers\(/);
  });

  it('Empresas: responsable, creador y autor del cambio salen del directorio', () => {
    assert.doesNotMatch(ACCOUNT_ACTIONS, /owner:owner_id/);
    assert.doesNotMatch(ACCOUNT_ACTIONS, /created_by_user:created_by/);
    assert.doesNotMatch(ACCOUNT_ACTIONS, /actor:actor_user_id/);
    assert.match(ACCOUNT_ACTIONS, /loadDirectoryNames\(/);
    assert.match(ACCOUNT_ACTIONS, /loadDirectoryUsers\(/);
  });

  it('Flujo: quién aprobó el prospecto de origen sale del directorio', () => {
    assert.doesNotMatch(PIPELINE_ACTIONS, /internal_users!/);
    assert.match(PIPELINE_ACTIONS, /loadDirectoryUser\(row\.reviewed_by\)/);
  });

  it('Descartadas: quién descartó sale del directorio', () => {
    assert.doesNotMatch(DISCARD_QUERIES, /loadUserNames\(/);
    assert.match(DISCARD_QUERIES, /loadDirectoryNames\(/);
  });
});

describe('🔴 dueño en HubSpot al aprobar la candidata de otro', () => {
  it('el correo de quien lanzó la búsqueda se lee con el directorio (servicio)', () => {
    assert.match(BATCH_ACTIONS, /const userRow = await loadDirectoryUser\(searcherUserId\)/);
    assert.match(BATCH_ACTIONS, /const sellerRow = await loadDirectoryUser\(searcherUserId\)/);
    assert.doesNotMatch(BATCH_ACTIONS, /\.eq\('id', searcherUserId\)/);
  });
});

describe('«Ver como…»: las puertas de admin no leen el rol de la base', () => {
  for (const [name, text] of [
    ['prospect-batches/actions.ts', BATCH_ACTIONS],
    ['accounts/actions.ts', ACCOUNT_ACTIONS],
    ['prospect-batches/claude-classifier-actions.ts', code(read('modules', 'prospect-batches', 'claude-classifier-actions.ts'))],
    [
      'wizard-run-provider-capability.server.ts',
      code(read('modules', 'prospect-batches', 'chat-wizard-execution', 'wizard-run-provider-capability.server.ts')),
    ],
    ['duplicate-checker/actions.ts', code(read('modules', 'duplicate-checker', 'actions.ts'))],
  ] as const) {
    it(`${name} usa isCurrentUserAdmin y no la tabla roles`, () => {
      assert.doesNotMatch(text, /from\('roles'\)/);
      assert.match(text, /isCurrentUserAdmin\(/);
    });
  }
});

describe("ayudantes que no deben ser acciones ('use server' exportadas)", () => {
  it('auditoría, mapeo de dueño HubSpot y lote manual no se exportan como acciones', () => {
    assert.doesNotMatch(BATCH_ACTIONS, /export async function logProspectCandidateAudit\b/);
    assert.doesNotMatch(BATCH_ACTIONS, /export async function getHubSpotOwnerMapping\b/);
    assert.doesNotMatch(BATCH_ACTIONS, /export async function getOrCreateTechnicalManualBatch\b/);
    assert.doesNotMatch(ACCOUNT_ACTIONS, /export async function logAccountAudit\b/);
  });

  it('la auditoría vive en un módulo de servidor sin use server', () => {
    const audit = read('modules', 'prospect-batches', 'candidate-audit.server.ts');
    assert.doesNotMatch(audit, /^'use server'/m);
    assert.match(audit, /export async function logProspectCandidateAudit\(/);
  });

  it('validar una importación exige que el actor sea la sesión y el lote esté en su alcance', () => {
    assert.match(BATCH_ACTIONS, /checkImportValidationActor\(batchId, userId\)/);
  });
});

describe('alcance antes de gastar o de decidir', () => {
  it('«Más como esta» y «Sus competidores» comprueban la candidata', () => {
    const src = code(read('modules', 'prospect-batches', 'competitor-search', 'more-like-this-actions.ts'));
    assert.equal(src.match(/canActOnCandidate\(parsed\.data\.candidateId\)/g)?.length, 2);
  });

  it('seguir una referencia comprueba la búsqueda; la ficha, la empresa', () => {
    assert.match(code(read('modules', 'prospect-batches', 'competitor-search', 'watch-actions.ts')), /canActOnBatch\(/);
    assert.match(code(read('modules', 'prospect-batches', 'competitor-search', 'actions.ts')), /canActOnAccount\(accountId\)/);
  });

  it('resolver el match de HubSpot de una empresa comprueba la empresa', () => {
    assert.match(code(read('modules', 'accounts', 'hubspot-company-review-actions.ts')), /canActOnAccount\(input\.accountId\)/);
  });

  it('revalidar y leer el árbol corporativo comprueban el registro', () => {
    assert.match(code(read('app', 'api', 'prospect-batches', 'revalidate-candidates', 'route.ts')), /canActOnBatch\(batchId\)/);
    const tree = code(read('app', 'api', 'prospect-batches', 'corporate-tree-runs', 'associations', 'route.ts'));
    assert.match(tree, /canActOnCandidate\(/);
    assert.match(tree, /canActOnAccount\(/);
    assert.match(tree, /access_status', 'active'/);
  });

  it('«Enviar a revisión» de una candidata usa la regla de la candidata (asignada incluida)', () => {
    assert.match(code(read('modules', 'prospect-discards', 'send-to-review-actions.ts')), /isCandidateInScope: canActOnCandidate/);
    assert.match(code(read('modules', 'prospect-discards', 'send-to-review-core.ts')), /isCandidateInScope\(current\.id/);
  });

  it('una búsqueda «Sólo las que te asignaron» se abre con sólo esa parte', () => {
    assert.match(BATCH_ACTIONS, /hasAssignedCandidatesInBatch\(id, scope\.allowedUserIds\)/);
    assert.match(BATCH_ACTIONS, /pageQuery = pageQuery\.in\('assigned_to', assignedOnlyTo\)/);
  });

  it('dejar una empresa sin responsable es sólo de admin; un responsable elegido pasa por «Asignar a…»', () => {
    assert.match(ACCOUNT_ACTIONS, /ownerChanged && !input\.owner_id && !\(await isCurrentUserAdmin/);
    assert.match(ACCOUNT_ACTIONS, /checkChosenOwner\(input\.owner_id, internalUserId\)/);
    assert.match(BATCH_ACTIONS, /loadAssignmentTarget\(actor, input\.owner_id\)/);
  });
});
