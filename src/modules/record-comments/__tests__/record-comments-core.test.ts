import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  isMissingTableError,
  normalizeCommentInput,
  normalizeResolutionNote,
  openPhoneReport,
  phoneKey,
  sortThread,
  summarizeField,
} from '../record-comments-core';
import {
  RECORD_COMMENT_FIELD_KEYS,
  RECORD_COMMENT_FIELDS_BY_TARGET,
  RECORD_COMMENT_KINDS,
  RECORD_COMMENT_REASONS,
  type RecordComment,
} from '../types';

const ID = '3f2c1a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b';

function comment(overrides: Partial<RecordComment>): RecordComment {
  return {
    id: overrides.id ?? Math.random().toString(36),
    accountId: ID,
    contactId: null,
    fieldKey: 'general',
    fieldValue: null,
    kind: 'note',
    reason: null,
    body: 'x',
    author: { id: 'u1', name: 'Ana' },
    createdAt: '2026-11-17T10:00:00.000Z',
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    ...overrides,
  };
}

describe('normalizeCommentInput', () => {
  it('acepta una nota bien formada y limpia espacios', () => {
    const result = normalizeCommentInput({
      target: 'contact',
      targetId: ID,
      fieldKey: 'linkedin',
      kind: 'note',
      body: '  El LinkedIn es de otra persona  ',
      fieldValue: '  ',
    });
    assert.deepEqual(result, {
      ok: true,
      value: {
        target: 'contact',
        targetId: ID,
        fieldKey: 'linkedin',
        fieldValue: null,
        kind: 'note',
        reason: null,
        body: 'El LinkedIn es de otra persona',
      },
    });
  });

  it('un motivo rápido es siempre una alerta sobre el teléfono, con el motivo como texto si no hay otro', () => {
    const result = normalizeCommentInput({
      target: 'contact',
      targetId: ID,
      fieldKey: 'general',
      kind: 'note',
      reason: 'phone_not_exists',
      fieldValue: '+57 300 123 4567',
      body: '',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.kind, 'alert');
    assert.equal(result.value.fieldKey, 'phone');
    assert.equal(result.value.body, 'El número no existe');
    assert.equal(result.value.fieldValue, '+57 300 123 4567');
  });

  it('rechaza ficha, dato, tipo, motivo y texto inválidos', () => {
    const base = { target: 'account' as const, targetId: ID, fieldKey: 'general' as const, kind: 'note' as const, body: 'ok' };
    assert.equal(normalizeCommentInput(null).ok, false);
    assert.equal(normalizeCommentInput({ ...base, target: 'deal' as never }).ok, false);
    assert.equal(normalizeCommentInput({ ...base, targetId: 'no-es-uuid' }).ok, false);
    assert.equal(normalizeCommentInput({ ...base, fieldKey: 'salary' as never }).ok, false);
    assert.equal(normalizeCommentInput({ ...base, kind: 'task' as never }).ok, false);
    assert.equal(normalizeCommentInput({ ...base, reason: 'spam' as never }).ok, false);
    assert.equal(normalizeCommentInput({ ...base, body: '   ' }).ok, false);
    assert.equal(normalizeCommentInput({ ...base, body: 'x'.repeat(2001) }).ok, false);
    assert.equal(normalizeCommentInput({ ...base, fieldValue: 'x'.repeat(501) }).ok, false);
  });
});

describe('normalizeResolutionNote', () => {
  it('vacío es null; demasiado largo se rechaza', () => {
    assert.deepEqual(normalizeResolutionNote('  '), { ok: true, note: null });
    assert.deepEqual(normalizeResolutionNote(' Actualicé el número '), { ok: true, note: 'Actualicé el número' });
    assert.equal(normalizeResolutionNote('x'.repeat(1001)).ok, false);
  });
});

describe('isMissingTableError', () => {
  it('reconoce «la tabla no existe» de Postgres y de PostgREST, y nada más', () => {
    assert.equal(isMissingTableError({ code: '42P01', message: 'relation does not exist' }), true);
    assert.equal(isMissingTableError({ code: 'PGRST205', message: "Could not find the table 'public.record_comments'" }), true);
    assert.equal(isMissingTableError({ code: '23505', message: 'duplicate key' }), false);
    assert.equal(isMissingTableError(null), false);
  });
});

describe('marcas por dato', () => {
  const comments = [
    comment({ id: 'a', fieldKey: 'phone', fieldValue: '+57 (300) 123-4567', kind: 'alert', reason: 'phone_not_exists', createdAt: '2026-11-17T10:00:00Z' }),
    comment({ id: 'b', fieldKey: 'phone', fieldValue: '+573001234567', kind: 'note', createdAt: '2026-11-17T11:00:00Z' }),
    comment({ id: 'c', fieldKey: 'phone', fieldValue: '+57 311 000 0000', kind: 'alert', reason: 'phone_no_answer', resolvedAt: '2026-11-17T12:00:00Z', resolvedBy: { id: 'u2', name: 'Leo' } }),
    comment({ id: 'd', fieldKey: 'linkedin', kind: 'alert' }),
  ];

  it('el teléfono se compara sin formato: cada número tiene sus propios comentarios', () => {
    assert.equal(phoneKey('+57 (300) 123-4567'), '+573001234567');
    const summary = summarizeField(comments, 'phone', '+57 300 123 4567');
    assert.equal(summary.total, 2);
    assert.equal(summary.openAlerts, 1);
    assert.equal(summary.latest?.id, 'b', 'el más reciente primero');
    assert.equal(summarizeField(comments, 'linkedin').openAlerts, 1);
  });

  it('el reporte abierto de un número sólo cuenta alertas con motivo sin resolver', () => {
    assert.equal(openPhoneReport(comments, '+573001234567')?.id, 'a');
    assert.equal(openPhoneReport(comments, '+57 311 000 0000'), null, 'la resuelta ya no marca el número');
    assert.equal(openPhoneReport(comments, ''), null);
  });

  it('el hilo pone primero las alertas abiertas y luego lo más reciente', () => {
    assert.deepEqual(sortThread(comments).map((c) => c.id), ['a', 'd', 'b', 'c']);
  });
});

describe('vocabulario: el código y la migración 168 dicen lo mismo', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '168_record_comments.sql'), 'utf8');
  const listIn = (constraint: string) => {
    const at = sql.indexOf(constraint);
    const block = sql.slice(at, sql.indexOf(')', sql.indexOf('IN (', at)) + 1);
    return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  };

  it('datos, tipos y motivos', () => {
    assert.deepEqual(listIn('record_comments_field_key_check'), [...RECORD_COMMENT_FIELD_KEYS]);
    assert.deepEqual(listIn('record_comments_kind_check'), [...RECORD_COMMENT_KINDS]);
    assert.deepEqual(listIn('record_comments_reason_check'), [...RECORD_COMMENT_REASONS]);
  });

  it('cada ficha sólo ofrece datos que existen', () => {
    for (const keys of Object.values(RECORD_COMMENT_FIELDS_BY_TARGET)) {
      for (const key of keys) assert.ok((RECORD_COMMENT_FIELD_KEYS as readonly string[]).includes(key), key);
    }
  });
});
