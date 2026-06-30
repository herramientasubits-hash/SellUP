import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRole,
  resolveScopedUserIds,
  resolveScopedGroupMembers,
  ADMIN_ROLE_KEYS,
  TEAM_ROLE_KEYS,
  type CommercialScope,
} from '../commercial-scope-logic';
import { collectGroupSubtreeIds } from '../group-tree';

// ── classifyRole ────────────────────────────────────────────────

test('classifyRole: is_admin signal always wins', () => {
  assert.equal(classifyRole('seller_bd', true), 'admin');
  assert.equal(classifyRole(null, true), 'admin');
});

test('classifyRole: known role keys map to their class', () => {
  assert.equal(classifyRole('admin', false), 'admin');
  assert.equal(classifyRole('commercial_manager', false), 'team');
  assert.equal(classifyRole('commercial_lead', false), 'team');
  assert.equal(classifyRole('seller_bd', false), 'self');
});

test('classifyRole: key matching is case/whitespace insensitive', () => {
  assert.equal(classifyRole('  Commercial_Lead ', false), 'team');
  assert.equal(classifyRole('ADMIN', false), 'admin');
});

test('classifyRole: unknown or null role falls back to most restrictive (self)', () => {
  assert.equal(classifyRole('something_new', false), 'self');
  assert.equal(classifyRole(null, false), 'self');
  assert.equal(classifyRole('', false), 'self');
});

test('seed role keys are covered by the class constants', () => {
  assert.ok(ADMIN_ROLE_KEYS.includes('admin'));
  assert.ok(TEAM_ROLE_KEYS.includes('commercial_manager'));
  assert.ok(TEAM_ROLE_KEYS.includes('commercial_lead'));
});

// ── resolveScopedUserIds (anti-tampering core) ──────────────────

const adminScope: Pick<CommercialScope, 'canViewAll' | 'allowedUserIds'> = {
  canViewAll: true,
  allowedUserIds: [],
};
const teamScope: Pick<CommercialScope, 'canViewAll' | 'allowedUserIds'> = {
  canViewAll: false,
  allowedUserIds: ['self', 'reportA', 'reportB'],
};
const sellerScope: Pick<CommercialScope, 'canViewAll' | 'allowedUserIds'> = {
  canViewAll: false,
  allowedUserIds: ['self'],
};

test('admin with no request → no constraint (null)', () => {
  assert.equal(resolveScopedUserIds(adminScope), null);
});

test('admin can target any single user via filter', () => {
  assert.deepEqual(resolveScopedUserIds(adminScope, 'anyone'), ['anyone']);
});

test('team with no request → exactly the allowed set', () => {
  assert.deepEqual(resolveScopedUserIds(teamScope), [
    'self',
    'reportA',
    'reportB',
  ]);
});

test('team filtering to an in-scope user narrows to that user', () => {
  assert.deepEqual(resolveScopedUserIds(teamScope, 'reportA'), ['reportA']);
});

test('team filtering to an OUT-of-scope user yields no rows ([]), never a leak', () => {
  assert.deepEqual(resolveScopedUserIds(teamScope, 'outsider'), []);
});

test('seller filtering to another user (URL tampering) yields no rows', () => {
  assert.deepEqual(resolveScopedUserIds(sellerScope, 'someone_else'), []);
});

test('seller with no request sees only self', () => {
  assert.deepEqual(resolveScopedUserIds(sellerScope), ['self']);
});

test('blank/whitespace requested id is ignored (treated as no request)', () => {
  assert.deepEqual(resolveScopedUserIds(teamScope, '   '), [
    'self',
    'reportA',
    'reportB',
  ]);
  assert.equal(resolveScopedUserIds(adminScope, ''), null);
});

// ── resolveScopedGroupMembers ───────────────────────────────────

test('group dimension: admin passes the requested members through', () => {
  assert.deepEqual(
    resolveScopedGroupMembers(adminScope, ['x', 'y']),
    ['x', 'y'],
  );
  assert.equal(resolveScopedGroupMembers(adminScope, null), null);
});

test('group dimension: team keeps only requested members already in scope', () => {
  assert.deepEqual(
    resolveScopedGroupMembers(teamScope, ['reportA', 'outsider']),
    ['reportA'],
  );
});

test('group dimension: team with no group request → full allowed set', () => {
  assert.deepEqual(resolveScopedGroupMembers(teamScope, null), [
    'self',
    'reportA',
    'reportB',
  ]);
});

// ── collectGroupSubtreeIds (hierarchy expansion) ────────────────

const groups = [
  { id: 'co', name: 'Colombia', parent_group_id: null },
  { id: 'manu', name: 'Manufactura', parent_group_id: 'co' },
  { id: 'tex', name: 'Textiles', parent_group_id: 'manu' },
  { id: 'tech', name: 'Tecnología', parent_group_id: 'co' },
  { id: 'mx', name: 'México', parent_group_id: null },
];

test('subtree of a root includes all descendants', () => {
  const ids = collectGroupSubtreeIds(['co'], groups).sort();
  assert.deepEqual(ids, ['co', 'manu', 'tech', 'tex']);
});

test('subtree of a mid node includes only its branch', () => {
  assert.deepEqual(collectGroupSubtreeIds(['manu'], groups).sort(), [
    'manu',
    'tex',
  ]);
});

test('subtree of a leaf is just itself', () => {
  assert.deepEqual(collectGroupSubtreeIds(['tex'], groups), ['tex']);
});

test('unknown root id is ignored (no phantom groups)', () => {
  assert.deepEqual(collectGroupSubtreeIds(['ghost'], groups), []);
});

test('multiple roots union their subtrees without duplicates', () => {
  assert.deepEqual(collectGroupSubtreeIds(['manu', 'mx'], groups).sort(), [
    'manu',
    'mx',
    'tex',
  ]);
});

test('cycle in parent pointers does not loop forever', () => {
  const cyclic = [
    { id: 'a', name: 'A', parent_group_id: 'b' },
    { id: 'b', name: 'B', parent_group_id: 'a' },
  ];
  assert.deepEqual(collectGroupSubtreeIds(['a'], cyclic).sort(), ['a', 'b']);
});
