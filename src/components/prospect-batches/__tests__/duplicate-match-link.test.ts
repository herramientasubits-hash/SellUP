import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { duplicateMatchLink } from '../duplicate-match-link';

test('coincidencia de HubSpot enlaza a la ficha de esa empresa (caso Sportium)', () => {
  const link = duplicateMatchLink({ source: 'hubspot', matched_id: '2513369036' }, null);
  assert.deepEqual(link, {
    href: 'https://app.hubspot.com/contacts/companies/2513369036',
    label: 'Ver en HubSpot',
    external: true,
  });
});

test('coincidencia de SellUp enlaza a la empresa sólo si es la cuenta coincidente', () => {
  assert.deepEqual(duplicateMatchLink({ source: 'sellup', matched_id: 'acc-1' }, 'acc-1'), {
    href: '/accounts/acc-1',
    label: 'Ver empresa en SellUp',
    external: false,
  });
  // id de otro candidato: no hay página que abrir
  assert.equal(duplicateMatchLink({ source: 'sellup', matched_id: 'cand-9' }, 'acc-1'), null);
  assert.equal(duplicateMatchLink({ source: 'sellup', matched_id: 'cand-9' }, null), null);
});

test('sin id o fuente desconocida no hay enlace', () => {
  assert.equal(duplicateMatchLink({ source: 'hubspot', matched_id: null }, null), null);
  assert.equal(duplicateMatchLink({ source: 'hubspot', matched_id: '  ' }, null), null);
  assert.equal(duplicateMatchLink({ source: 'internal_pool', matched_id: 'x' }, 'x'), null);
});

test('la fila de «Coincidencias encontradas» pinta el enlace', () => {
  const src = readFileSync('src/components/prospect-batches/candidate-detail-duplicate-sections.tsx', 'utf8');
  assert.ok(src.includes('duplicateMatchLink(match, matchedAccountId)'));
  assert.ok(src.includes('matchedAccountId={candidate.matched_account_id}'));
});
