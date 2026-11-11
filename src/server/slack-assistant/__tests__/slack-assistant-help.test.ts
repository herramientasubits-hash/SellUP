// Guía de uso del asistente de Slack: búsqueda de fichas, filtro por rol y la
// guarda que impide que la guía cite pantallas o botones que ya no existen.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELP_TOPICS } from '../help/topics';
import { canUseTopic, lookupHelp, scoreTopic } from '../help/lookup';
import type { HelpTopic } from '../help/types';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const ROLES = new Set(['admin', 'commercial_lead', 'commercial_manager', 'seller_bd', 'growth']);

/** Etiquetas de pantalla citadas entre «» en el texto de una ficha. */
function quotedLabels(text: string): string[] {
  return [...text.matchAll(/«([^»]+)»/g)].map((m) => m[1]);
}

describe('guía de uso — fichas', () => {
  it('hay fichas y cada una tiene clave única, título, contenido y palabras clave', () => {
    assert.ok(HELP_TOPICS.length >= 8, `sólo ${HELP_TOPICS.length} fichas`);
    const keys = new Set<string>();
    for (const t of HELP_TOPICS) {
      assert.ok(!keys.has(t.key), `clave repetida ${t.key}`);
      keys.add(t.key);
      assert.ok(t.titulo.trim() && t.contenido.trim().length > 80, t.key);
      assert.ok(t.palabrasClave.length >= 3, `${t.key}: pocas palabras clave`);
      assert.ok(t.roles === 'todos' || (t.roles.length > 0 && t.roles.every((r) => ROLES.has(r))), `${t.key}: roles`);
      assert.ok(t.ruta === null || t.ruta.startsWith('/'), `${t.key}: ruta`);
    }
  });

  it('🔴 cada etiqueta declarada existe tal cual en su archivo (pantalla renombrada = ficha que actualizar)', () => {
    const missing: string[] = [];
    for (const t of HELP_TOPICS) {
      for (const ref of t.etiquetas) {
        const file = join(REPO_ROOT, ref.archivo);
        if (!existsSync(file)) {
          missing.push(`${t.key}: no existe ${ref.archivo}`);
          continue;
        }
        // Los botones de Rumbo se arman con withRumbo('…') en rumbo-labels.ts.
        const needle =
          ref.archivo.endsWith('rumbo-labels.ts') && ref.texto.endsWith(' con Rumbo IA')
            ? `withRumbo('${ref.texto.slice(0, -' con Rumbo IA'.length)}')`
            : ref.texto;
        if (!readFileSync(file, 'utf8').includes(needle)) missing.push(`${t.key}: «${ref.texto}» ya no está en ${ref.archivo}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('🔴 toda etiqueta citada entre «» en una ficha está declarada (y por lo tanto vigilada)', () => {
    const undeclared: string[] = [];
    for (const t of HELP_TOPICS) {
      const declared = new Set(t.etiquetas.map((e) => e.texto));
      for (const label of quotedLabels(`${t.contenido}\n${t.limites ?? ''}`)) {
        if (!declared.has(label)) undeclared.push(`${t.key}: «${label}»`);
      }
    }
    assert.deepEqual(undeclared, []);
  });

  it('las rutas apuntan a pantallas que existen', () => {
    const missing: string[] = [];
    for (const t of HELP_TOPICS) {
      if (!t.ruta) continue;
      const path = t.ruta.split('?')[0].replace(/^\//, '');
      const page = join(REPO_ROOT, 'src/app/(sellup)', path, 'page.tsx');
      if (!existsSync(page)) missing.push(`${t.key}: ${t.ruta}`);
    }
    assert.deepEqual(missing, []);
  });
});

const TOPIC: HelpTopic = {
  key: 'importar-empresas',
  titulo: 'Importar empresas desde un archivo',
  palabrasClave: ['importar', 'archivo', 'csv', 'excel', 'subir empresas'],
  roles: ['admin', 'growth'],
  ruta: '/accounts',
  contenido: 'Pasos…',
  limites: 'No importa contactos.',
  etiquetas: [],
};
const OTHER: HelpTopic = { ...TOPIC, key: 'rumbo', titulo: 'Rumbo: primer contacto', palabrasClave: ['rumbo', 'primer contacto', 'guion'], roles: 'todos' };

describe('guía de uso — búsqueda y roles', () => {
  it('encuentra la ficha por cómo pregunta la gente', () => {
    assert.ok(scoreTopic(TOPIC, '¿cómo importo empresas desde un Excel?') > scoreTopic(OTHER, '¿cómo importo empresas desde un Excel?'));
    assert.ok(scoreTopic(OTHER, 'cómo uso rumbo para el primer contacto') > 0);
    assert.equal(scoreTopic(TOPIC, ''), 0);
  });

  it('🔴 a quien no tiene el rol no se le dan los pasos, sólo quién la usa', () => {
    const seller = lookupHelp([TOPIC, OTHER], 'importar empresas desde archivo', { roleKey: 'seller_bd', isAdmin: false, appUrl: 'https://app.example' });
    assert.equal(seller.fichas[0].disponibleParaTi, false);
    assert.doesNotMatch(seller.fichas[0].contenido, /Pasos/);
    assert.match(seller.fichas[0].contenido, /administradores, Growth/);
    assert.equal(seller.fichas[0].enlace, null);
    assert.deepEqual(seller.temasDisponibles, ['Rumbo: primer contacto']);

    const growth = lookupHelp([TOPIC], 'importar', { roleKey: 'growth', isAdmin: false, appUrl: 'https://app.example/' });
    assert.equal(growth.fichas[0].contenido, 'Pasos…');
    assert.equal(growth.fichas[0].enlace, 'https://app.example/accounts');
    assert.equal(canUseTopic(TOPIC, null, true), true);
  });

  it('🔴 sin ficha: dice que no está documentado y que no invente', () => {
    const none = lookupHelp([TOPIC], 'cómo cambio mi foto de perfil', { roleKey: 'admin', isAdmin: true, appUrl: 'x' });
    assert.equal(none.encontrada, false);
    assert.match(none.nota, /NO inventes/);
  });
});
