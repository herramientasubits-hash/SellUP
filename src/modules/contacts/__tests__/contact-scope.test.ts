// Contactos por alcance comercial: un contacto se ve sólo si su empresa se ve
// (dueña o creada por alguien del alcance), con la misma regla que Empresas.
// Las acciones llaman a createClient() (cookies de next/headers), así que no se
// pueden invocar bajo `node --test`: la regla se prueba en los helpers puros y
// el cableado con una guarda estática sobre actions.ts.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  contactAccountScopeOrClause,
  isContactAccountInScope,
} from '../contact-scope';

const ME = '11111111-1111-1111-1111-111111111111';
const TEAMMATE = '22222222-2222-2222-2222-222222222222';
const STRANGER = '33333333-3333-3333-3333-333333333333';

describe('isContactAccountInScope', () => {
  it('sin restricción (bandera apagada o admin) deja ver todo', () => {
    assert.equal(isContactAccountInScope({ owner_id: STRANGER, created_by: STRANGER }, null), true);
  });

  it('un usuario nuevo sin empresas no ve contactos de empresas ajenas', () => {
    assert.equal(
      isContactAccountInScope({ owner_id: STRANGER, created_by: STRANGER }, [ME]),
      false,
    );
  });

  it('ve los contactos de empresas que son suyas o que creó', () => {
    assert.equal(isContactAccountInScope({ owner_id: ME, created_by: STRANGER }, [ME]), true);
    assert.equal(isContactAccountInScope({ owner_id: STRANGER, created_by: ME }, [ME]), true);
  });

  it('un líder ve los contactos de empresas de su equipo', () => {
    assert.equal(
      isContactAccountInScope({ owner_id: TEAMMATE, created_by: null }, [ME, TEAMMATE]),
      true,
    );
  });

  it('alcance vacío o contacto sin empresa visible ⇒ no se ve', () => {
    assert.equal(isContactAccountInScope({ owner_id: ME, created_by: ME }, []), false);
    assert.equal(isContactAccountInScope(null, [ME]), false);
    assert.equal(isContactAccountInScope({ owner_id: null, created_by: null }, [ME]), false);
  });
});

describe('contactAccountScopeOrClause', () => {
  it('filtra por dueño o creador de la empresa', () => {
    assert.equal(
      contactAccountScopeOrClause([ME, TEAMMATE]),
      `owner_id.in.(${ME},${TEAMMATE}),created_by.in.(${ME},${TEAMMATE})`,
    );
  });
});

describe('actions.ts aplica el alcance en cada lectura de contactos', () => {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.resolve(moduleDir, '..', 'actions.ts'), 'utf8');

  function body(fn: string): string {
    const start = source.indexOf(`export async function ${fn}(`);
    assert.ok(start >= 0, `${fn} existe`);
    const next = source.indexOf('\nexport ', start + 1);
    return source.slice(start, next === -1 ? undefined : next);
  }

  it('la bandera ENABLE_COMMERCIAL_SCOPE gobierna el alcance, como en Empresas', () => {
    assert.match(source, /if \(!isCommercialScopeEnabled\(\)\) return null;/);
    assert.match(source, /if \(!scope\) return \[\];/);
  });

  it('getAllContacts filtra por la empresa con join interno', () => {
    const fn = body('getAllContacts');
    assert.match(fn, /resolveContactScopeIds\(\)/);
    assert.match(fn, /account_id!inner/);
    assert.match(fn, /referencedTable: 'account'/);
  });

  it('getContactById no abre un contacto fuera del alcance', () => {
    assert.match(body('getContactById'), /isContactAccountInScope\(/);
  });

  it('getContactsByAccount y getContactsSummary revisan la empresa', () => {
    assert.match(body('getContactsByAccount'), /canSeeAccountContacts\(/);
    assert.match(body('getContactsSummary'), /canSeeAccountContacts\(/);
  });
});
