/**
 * Auditoría de permisos B (13-11) — guardas ESTÁTICAS sobre el código de las acciones.
 *
 * Fijan que no vuelvan los huecos encontrados:
 *  - ninguna acción de contactos/teléfonos lee el rol directo de `internal_users`/`roles`
 *    (se saltaba «Ver como…»): todas pasan por `current-actor.server`;
 *  - las acciones que gastan o enseñan datos de un candidato comprueban su alcance;
 *  - los nombres de otras personas salen del directorio (cliente de servicio);
 *  - `logContactAudit` no es una acción invocable desde el cliente;
 *  - archivar contactos sólo por `archiveContact` (admin) y la UI no lo ofrece a no admins;
 *  - Rumbo comprueba la empresa antes de registrar la corrida.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Sin comentarios: una guarda no debe pasar sólo porque un comentario nombra algo. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const CE = 'src/modules/contact-enrichment';

const ACTOR_FILES = [
  `${CE}/phone-reveal-actions.ts`,
  `${CE}/candidate-identity-completion-actions.ts`,
  `${CE}/candidate-stored-phones-actions.ts`,
  `${CE}/lusha-phone-fallback-actions.ts`,
  `${CE}/phone-cache-suppression-actions.ts`,
  `${CE}/phone-reveal-manual-recovery-actions.ts`,
  `${CE}/phone-reveal-recovery-actions.ts`,
  `${CE}/phone-reveal-waterfall-actions.ts`,
  `${CE}/phone-reveal-waterfall-legacy-actions.ts`,
  `${CE}/post-approval-reveal-actions.ts`,
  `${CE}/search-more-phones-actions.ts`,
];

describe('«Ver como…»: el rol sale de getCurrentUser/isCurrentUserAdmin', () => {
  it('el resolvedor compartido se construye sobre las funciones de acceso', () => {
    const src = code(`${CE}/current-actor.server.ts`);
    assert.match(src, /getCurrentUser\(\)/);
    assert.match(src, /isCurrentUserAdmin\(\)/);
    assert.doesNotMatch(src, /^'use server'/m);
  });

  for (const file of [...ACTOR_FILES, 'src/modules/contacts/actions.ts']) {
    it(`${file} no lee el rol directo de la base`, () => {
      const src = code(file);
      assert.doesNotMatch(src, /from\('roles'\)/);
      assert.match(src, /requireActiveActor\(/);
    });
  }

  it('el diagnóstico de Lusha es de admin activo y usa el id interno', () => {
    const src = code('src/app/(sellup)/contacts/actions/diagnose-lusha-credentials.ts');
    assert.match(src, /actor\.isAdmin/);
    assert.match(src, /triggeredBy: internalUserId/);
    assert.doesNotMatch(src, /triggeredBy: user\.id/);
  });
});

describe('Alcance por candidato antes de gastar o enseñar', () => {
  const gated = [
    `${CE}/search-more-phones-actions.ts`,
    `${CE}/phone-reveal-waterfall-legacy-actions.ts`,
    `${CE}/phone-reveal-manual-recovery-actions.ts`,
    `${CE}/phone-reveal-waterfall-actions.ts`,
  ];
  for (const file of gated) {
    it(`${file} comprueba canSeeContactCandidate`, () => {
      assert.match(code(file), /canSeeContactCandidate\(/);
    });
  }

  it('las tres lecturas del waterfall (auditoría y vistas previas) están detrás del alcance', () => {
    const matches = code(`${CE}/phone-reveal-waterfall-actions.ts`).match(/canSeeContactCandidate\(/g) ?? [];
    assert.equal(matches.length, 3);
  });

  it('«Buscar más números»: preflight y compra', () => {
    const matches = code(`${CE}/search-more-phones-actions.ts`).match(/canSeeContactCandidate\(/g) ?? [];
    assert.equal(matches.length, 2);
  });
});

describe('Empresas de otro equipo en «Buscar contactos»', () => {
  const actions = code(`${CE}/actions.ts`);

  it('la request comprueba la cuenta RESUELTA (HubSpot ⇒ cuenta existente)', () => {
    assert.match(actions, /if \(accountResolution\.accountId\) await requireAccountInScope\(accountResolution\.accountId\)/);
  });

  it('la aprobación no crea el contacto en una cuenta ajena (HubSpot o reasignada)', () => {
    assert.match(actions, /!\(await canActOnAccount\(resolved\.accountId\)\)/);
    assert.match(actions, /readCandidateCompanyReassignment\(record\.enrichment_metadata\)/);
  });

  it('la reasignación pasa la comprobación de la cuenta destino', () => {
    assert.match(code(`${CE}/candidate-company-reassignment-actions.ts`), /isAccountInScope: \(accountId\) => canActOnAccount\(accountId\)/);
  });

  it('el selector de empresa recibe el alcance (acción y ruta)', () => {
    assert.match(actions, /sellupScopeUserIds: await currentScopeUserIds\(\)/);
    assert.match(code('src/app/api/contact-enrichment/resolve-company/route.ts'), /sellupScopeUserIds: await currentScopeUserIds\(\)/);
  });

  it('la elegibilidad masiva cuenta sólo las empresas del alcance (igual que al crear)', () => {
    const matches = actions.match(/await filterAccountIdsInScope\(requestedIds\)/g) ?? [];
    assert.equal(matches.length, 2);
  });
});

describe('Nombres de otras personas: del directorio', () => {
  it('«Descartó» en Rechazados', () => {
    const actions = code(`${CE}/actions.ts`);
    assert.match(actions, /loadDirectoryNames\(candidates\.map\(\(c\) => c\.reviewed_by\)\)/);
    assert.doesNotMatch(actions, /loadUserNames\(/);
  });

  it('autor de cada cambio en la auditoría del contacto', () => {
    const contacts = code('src/modules/contacts/actions.ts');
    assert.doesNotMatch(contacts, /actor:actor_user_id/);
    assert.match(contacts, /loadDirectoryUsers\(/);
  });
});

describe('Contactos: auditoría y archivo', () => {
  const contacts = code('src/modules/contacts/actions.ts');

  it('logContactAudit ya no es una acción exportada', () => {
    assert.doesNotMatch(contacts, /export async function logContactAudit/);
    const helper = code('src/modules/contacts/contact-audit.server.ts');
    assert.match(helper, /export async function logContactAudit/);
    assert.doesNotMatch(helper, /^'use server'/m);
  });

  it('ni el cambio de estado ni la edición archivan', () => {
    assert.match(contacts, /if \(newStatus === 'archived'\) return \{ success: false, error: ARCHIVE_ONLY_VIA_ARCHIVE_MESSAGE \}/);
    assert.match(contacts, /if \(input\.contact_status === 'archived'\)/);
  });

  it('la UI sólo ofrece «Archivar contacto» a un admin', () => {
    for (const file of ['src/components/contacts/contact-row-actions.tsx', 'src/components/contacts/contacts-data-table-client.tsx']) {
      const src = code(file);
      assert.match(src, /useNavAccess\(\)/, file);
      assert.match(src, /isAdmin/, file);
    }
  });
});

describe('Rumbo (Agente 3)', () => {
  it('la ruta comprueba la empresa ANTES de registrar la corrida', () => {
    const src = code('src/app/api/agent3/first-call/route.ts');
    const scope = src.indexOf('getAccountById(parsed.request.accountId)');
    const record = src.indexOf('recordFirstContactRunStart(');
    assert.ok(scope > 0 && record > scope);
  });

  it('un dato del decisor sólo va a un contacto de esa empresa', () => {
    const src = code('src/modules/speech/actions.ts');
    assert.match(src, /\.eq\('account_id', brief\.account_id\)\s*\.in\('id', contactIds\)/);
  });
});
