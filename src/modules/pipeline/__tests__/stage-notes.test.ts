/**
 * Pipeline · notas de etapa — contrato PURO: el contexto que deja una persona al
 * mover de etapa se ANEXA a las notas con su cabecera (etapa · estado · fecha en
 * Bogotá · autor), nunca borra lo anterior, y se puede leer la última.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  STAGE_NOTE_MAX_LENGTH,
  appendStageNote,
  formatStageNoteHeader,
  isStageNoteTextValid,
  latestStageNote,
  normalizeStageNoteText,
  type StageNoteEntry,
} from '../stage-notes';

// 2 oct 2026, 09:05 en Bogotá.
const AT = new Date('2026-10-02T14:05:00Z');

const ENTRY: StageNoteEntry = {
  kind: 'paste',
  text: '  Reunión con Luisa: interesados en liderazgo.  ',
  stageName: 'Inteligencia de cuenta',
  statusLabel: 'Lista para investigar',
  at: AT,
  author: 'Ana Pérez',
};

describe('Notas de etapa — cabecera y bloque', () => {
  it('la cabecera dice etapa, estado, fecha en la zona de la app y autor', () => {
    const header = formatStageNoteHeader(ENTRY);
    assert.match(header, /^\[Inteligencia de cuenta · Lista para investigar · 2 de oct(\.)? de 2026, 9:05 a\.\s?m\. · Ana Pérez\]$/);
  });

  it('sin autor conocido, la cabecera no lo inventa', () => {
    assert.doesNotMatch(formatStageNoteHeader({ ...ENTRY, author: null }), /·\s*\]$|undefined|null/);
    assert.match(formatStageNoteHeader({ ...ENTRY, author: '  ' }), /a\.\s?m\.\]$/);
  });

  it('pegar guarda el texto tal cual (recortado); mover sin acción guarda el motivo', () => {
    assert.match(appendStageNote(null, ENTRY), /\]\nReunión con Luisa: interesados en liderazgo\.$/);
    assert.match(
      appendStageNote(null, { ...ENTRY, kind: 'none', text: 'Ya no responde correos' }),
      /\]\nMovida sin acción\. Motivo: Ya no responde correos$/,
    );
  });
});

describe('Notas de etapa — anexar sin borrar', () => {
  it('las notas de antes quedan intactas y el bloque nuevo va al final', () => {
    const previous = 'Cliente de 2024. Llamar a RRHH.';
    const next = appendStageNote(previous, ENTRY);
    assert.ok(next.startsWith(`${previous}\n\n[`));
    assert.equal(next.split('\n\n').length, 2);
  });

  it('sin notas previas, la nota es solo el bloque', () => {
    assert.ok(appendStageNote('', ENTRY).startsWith('[Inteligencia de cuenta'));
    assert.ok(appendStageNote('  \n', ENTRY).startsWith('[Inteligencia de cuenta'));
  });
});

describe('Notas de etapa — validación', () => {
  it('hace falta un mínimo de 10 caracteres útiles', () => {
    assert.equal(isStageNoteTextValid('corto'), false);
    assert.equal(isStageNoteTextValid('        hola        '), false);
    assert.equal(isStageNoteTextValid('Ya no responde'), true);
  });

  it('se recorta al máximo y se normalizan los saltos de línea', () => {
    assert.equal(normalizeStageNoteText('a\r\nb'), 'a\nb');
    assert.equal(normalizeStageNoteText('x'.repeat(STAGE_NOTE_MAX_LENGTH + 50)).length, STAGE_NOTE_MAX_LENGTH);
  });
});

describe('Notas de etapa — la última', () => {
  it('lee la última nota de etapa aunque haya notas libres antes', () => {
    const first = appendStageNote('Notas sueltas', ENTRY);
    const second = appendStageNote(first, { ...ENTRY, kind: 'none', text: 'Ya no responde correos', statusLabel: 'Nueva', stageName: 'Enriquecimiento de contactos' });
    const latest = latestStageNote(second);
    assert.ok(latest);
    assert.match(latest.header, /^Enriquecimiento de contactos · Nueva · /);
    assert.equal(latest.body, 'Movida sin acción. Motivo: Ya no responde correos');
  });

  it('sin notas de etapa, no hay última', () => {
    assert.equal(latestStageNote(null), null);
    assert.equal(latestStageNote('Solo una nota libre.'), null);
  });
});
