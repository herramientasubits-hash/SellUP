/**
 * Comentarios (168) — lo que este corte NO hace, comprobado sobre los archivos.
 * Sin red ni base: sólo lectura de ficheros, sin comentarios.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const ACTIONS = strip(read('src/modules/record-comments/actions.ts'));
const SQL = read('supabase/migrations/168_record_comments.sql')
  .split('\n')
  .map((line) => (line.trimStart().startsWith('--') ? '' : line))
  .join('\n');

function exportedBodies(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /export async function (\w+)/g;
  const starts = [...src.matchAll(re)];
  starts.forEach((match, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
    out.set(match[1], src.slice(match.index, end));
  });
  return out;
}

describe('acciones de comentarios', () => {
  const bodies = exportedBodies(ACTIONS);

  it('las cuatro acciones existen', () => {
    assert.deepEqual([...bodies.keys()].sort(), [
      'createRecordComment',
      'getRecordComments',
      'getRecordCommentsInbox',
      'resolveRecordComment',
    ]);
  });

  it('🔴 cada acción exige sesión activa y comprueba el alcance antes de leer o escribir', () => {
    for (const [name, body] of bodies) {
      assert.match(body, /requireActiveActor\(\)/, `${name} sin sesión`);
      const firstQuery = body.indexOf(".from('record_comments')");
      const scopeAt = Math.max(
        body.indexOf('canActOnTarget('),
        body.indexOf('canActOnAccount('),
        body.indexOf('currentScopeUserIds('),
      );
      assert.ok(scopeAt >= 0, `${name} no comprueba el alcance`);
      if (name !== 'resolveRecordComment') {
        assert.ok(scopeAt < firstQuery, `${name} lee/escribe antes de comprobar el alcance`);
      }
    }
    // Resolver lee la fila para saber su empresa y comprueba antes de escribir.
    const resolve = bodies.get('resolveRecordComment') ?? '';
    assert.ok(resolve.indexOf('canActOnAccount(') < resolve.indexOf('.update('));
  });

  it('🔴 el autor sale de la sesión, nunca del navegador', () => {
    const create = bodies.get('createRecordComment') ?? '';
    assert.match(create, /author_id: actor\.internalUserId/);
    const resolve = bodies.get('resolveRecordComment') ?? '';
    assert.match(resolve, /resolved_by: actor\.internalUserId/);
  });

  it('🔴 no escribe en HubSpot, no llama proveedores ni toca teléfonos o contactos', () => {
    assert.doesNotMatch(ACTIONS, /hubspot|apollo|lusha|tavily|anthropic/i);
    assert.doesNotMatch(ACTIONS, /contact_phones|budget|credit/i);
    assert.doesNotMatch(ACTIONS, /\.from\('contacts'\)[\s\S]{0,80}\.(update|insert|upsert|delete)\(/);
    assert.doesNotMatch(ACTIONS, /\.from\('accounts'\)/);
    assert.doesNotMatch(ACTIONS, /\.delete\(/, 'un comentario no se borra');
  });
});

describe('migración 168', () => {
  it('sólo crea su tabla, sus disparadores e índices; no toca datos ni otras tablas', () => {
    assert.doesNotMatch(SQL, /\b(UPDATE|DELETE FROM|INSERT INTO)\s+public\.(?!record_comments)/i);
    assert.doesNotMatch(SQL, /ALTER TABLE\s+public\.(?!record_comments)/i);
    assert.doesNotMatch(SQL, /contact_phones|budget|hubspot/i);
  });

  it('🔴 nadie fuera del servidor la lee o la escribe', () => {
    assert.match(SQL, /ENABLE ROW LEVEL SECURITY/);
    assert.match(SQL, /REVOKE ALL ON public\.record_comments FROM anon, authenticated;/);
    assert.doesNotMatch(SQL, /TO (anon|authenticated|public)\b/i);
  });

  it('se declara NO aplicada en Producción', () => {
    assert.match(read('supabase/migrations/168_record_comments.sql'), /NO APLICADA EN PRODUCCIÓN/);
  });
});
