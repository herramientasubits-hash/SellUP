// Tests — deduplicación server-side de contactos (Hito 17A.7D)
// Cubre findContactDuplicate, emailKey, linkedinKey, nameKey y dedupErrorMessage.
// Sin Supabase, sin red — lógica pura.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  emailKey,
  linkedinKey,
  nameKey,
  findContactDuplicate,
  dedupErrorMessage,
  type ExistingContactForDedup,
} from '../contact-dedup';

// ── Fixtures ──────────────────────────────────────────────────────

const BASE: ExistingContactForDedup = {
  id: 'existing-1',
  email: 'ana@empresa.com',
  linkedin_url: 'https://linkedin.com/in/ana-garcia',
  full_name: 'Ana García',
};

// ── emailKey ─────────────────────────────────────────────────────

describe('emailKey', () => {
  it('normaliza a minúsculas y quita espacios', () => {
    assert.equal(emailKey('  ANA@Empresa.COM  '), 'ana@empresa.com');
  });

  it('devuelve null para string vacío', () => {
    assert.equal(emailKey(''), null);
  });

  it('devuelve null para null', () => {
    assert.equal(emailKey(null), null);
  });

  it('devuelve null para undefined', () => {
    assert.equal(emailKey(undefined), null);
  });
});

// ── linkedinKey ──────────────────────────────────────────────────

describe('linkedinKey', () => {
  it('normaliza a minúsculas, quita trailing slash y espacios', () => {
    assert.equal(
      linkedinKey('  https://LinkedIn.com/in/Ana-Garcia/  '),
      'https://linkedin.com/in/ana-garcia',
    );
  });

  it('quita múltiples trailing slashes', () => {
    assert.equal(
      linkedinKey('https://linkedin.com/in/ana//'),
      'https://linkedin.com/in/ana',
    );
  });

  it('devuelve null para null/undefined/vacío', () => {
    assert.equal(linkedinKey(null), null);
    assert.equal(linkedinKey(undefined), null);
    assert.equal(linkedinKey(''), null);
  });
});

// ── nameKey ──────────────────────────────────────────────────────

describe('nameKey', () => {
  it('normaliza acentos y colapsa espacios', () => {
    assert.equal(nameKey('  Ána  García  '), 'ana garcia');
  });

  it('equipara nombres con y sin tilde', () => {
    assert.equal(nameKey('Ána García'), nameKey('Ana Garcia'));
  });

  it('devuelve null para null/undefined/vacío', () => {
    assert.equal(nameKey(null), null);
    assert.equal(nameKey(undefined), null);
    assert.equal(nameKey(''), null);
  });
});

// ── findContactDuplicate — email ─────────────────────────────────

describe('findContactDuplicate — por email', () => {
  it('1. detecta duplicado exacto por email', () => {
    const result = findContactDuplicate(
      { email: 'ana@empresa.com', linkedin_url: null, full_name: 'Otra Persona' },
      [BASE],
    );
    assert.ok(result);
    assert.equal(result.matchedBy, 'email');
    assert.equal(result.contactId, 'existing-1');
  });

  it('2. detecta duplicado de email con diferente capitalización y espacios', () => {
    const result = findContactDuplicate(
      { email: '  ANA@EMPRESA.COM  ', linkedin_url: null, full_name: 'X' },
      [BASE],
    );
    assert.ok(result);
    assert.equal(result.matchedBy, 'email');
  });

  it('3. no bloquea cuando el email es diferente', () => {
    const result = findContactDuplicate(
      { email: 'otro@empresa.com', linkedin_url: null, full_name: 'X' },
      [BASE],
    );
    assert.equal(result, null);
  });
});

// ── findContactDuplicate — linkedin ──────────────────────────────

describe('findContactDuplicate — por LinkedIn', () => {
  it('4. detecta duplicado por LinkedIn URL normalizada', () => {
    const result = findContactDuplicate(
      {
        email: null,
        linkedin_url: 'https://LinkedIn.com/in/Ana-Garcia/',
        full_name: 'Otra Persona',
      },
      [BASE],
    );
    assert.ok(result);
    assert.equal(result.matchedBy, 'linkedin');
  });

  it('5. no bloquea cuando LinkedIn es diferente', () => {
    const result = findContactDuplicate(
      { email: null, linkedin_url: 'https://linkedin.com/in/otro', full_name: 'X' },
      [BASE],
    );
    assert.equal(result, null);
  });

  it('6. email tiene prioridad sobre LinkedIn cuando ambos coinciden', () => {
    const result = findContactDuplicate(
      {
        email: 'ana@empresa.com',
        linkedin_url: 'https://linkedin.com/in/ana-garcia',
        full_name: 'X',
      },
      [BASE],
    );
    assert.ok(result);
    assert.equal(result.matchedBy, 'email');
  });
});

// ── findContactDuplicate — nombre ────────────────────────────────

describe('findContactDuplicate — por nombre', () => {
  it('7. bloquea por nombre cuando NO hay email ni LinkedIn', () => {
    const result = findContactDuplicate(
      { email: null, linkedin_url: null, full_name: 'Ana García' },
      [BASE],
    );
    assert.ok(result);
    assert.equal(result.matchedBy, 'name');
  });

  it('8. NO bloquea por nombre si el nuevo contacto tiene email diferente', () => {
    const result = findContactDuplicate(
      { email: 'otro@empresa.com', linkedin_url: null, full_name: 'Ana García' },
      [BASE],
    );
    assert.equal(result, null);
  });

  it('9. NO bloquea por nombre si el nuevo contacto tiene LinkedIn diferente', () => {
    const result = findContactDuplicate(
      { email: null, linkedin_url: 'https://linkedin.com/in/otro', full_name: 'Ana García' },
      [BASE],
    );
    assert.equal(result, null);
  });

  it('10. no bloquea mismo nombre en lista vacía', () => {
    const result = findContactDuplicate(
      { email: null, linkedin_url: null, full_name: 'Ana García' },
      [],
    );
    assert.equal(result, null);
  });
});

// ── Cuentas diferentes — aislamiento ────────────────────────────

describe('findContactDuplicate — aislamiento por cuenta', () => {
  it('11. no bloquea cuando existing pertenece a otra cuenta (lista vacía para la cuenta actual)', () => {
    // La query en actions.ts filtra por account_id antes de pasar el array;
    // si la lista está vacía, no hay match posible.
    const result = findContactDuplicate(
      { email: 'ana@empresa.com', linkedin_url: null, full_name: 'Ana García' },
      [], // contacts de otra cuenta no se pasan aquí
    );
    assert.equal(result, null);
  });
});

// ── Sin duplicados ───────────────────────────────────────────────

describe('findContactDuplicate — contacto válido sin duplicado', () => {
  it('12. permite crear contacto cuando no hay ninguna coincidencia', () => {
    const result = findContactDuplicate(
      {
        email: 'nuevo@empresa.com',
        linkedin_url: 'https://linkedin.com/in/nuevo',
        full_name: 'Nuevo Contacto',
      },
      [BASE],
    );
    assert.equal(result, null);
  });
});

// ── dedupErrorMessage ────────────────────────────────────────────

describe('dedupErrorMessage', () => {
  it('13. devuelve mensaje de email', () => {
    assert.equal(
      dedupErrorMessage('email'),
      'Ya existe un contacto con este email en esta cuenta.',
    );
  });

  it('14. devuelve mensaje de linkedin', () => {
    assert.equal(
      dedupErrorMessage('linkedin'),
      'Ya existe un contacto con este LinkedIn en esta cuenta.',
    );
  });

  it('15. devuelve mensaje de nombre', () => {
    assert.equal(
      dedupErrorMessage('name'),
      'Ya existe un contacto con este nombre en esta cuenta.',
    );
  });
});
