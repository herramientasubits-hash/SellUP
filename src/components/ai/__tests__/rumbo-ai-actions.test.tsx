/**
 * Rumbo IA en toda la plataforma (dueña 19-10):
 *  - las acciones de IA dicen «… con Rumbo IA» y tienen sus tres pesos de botón;
 *  - la marca de Rumbo se mueve en ciclo, sin saltar al reiniciar;
 *  - una página abierta antes de un deploy se reconoce para recargarla.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';

import { RUMBO_ACTION_LABELS, RUMBO_IA, withRumbo } from '../rumbo-labels';
import { buttonVariants } from '../../ui/button';
import { ChatMark } from '../../chat/chat-mark';
import { launcherLabel } from '../../first-call/first-call-launcher';
import { isVersionSkewError } from '../../../lib/version-skew';
import { BrainCircuit, Rumbo, Sparkles } from '../../../icons';

describe('acciones de Rumbo IA', () => {
  it('cada acción dice qué hace «con Rumbo IA»', () => {
    assert.equal(RUMBO_IA, 'Rumbo IA');
    assert.equal(withRumbo('Buscar contactos'), 'Buscar contactos con Rumbo IA');
    assert.equal(RUMBO_ACTION_LABELS.generate, 'Generar con Rumbo IA');
    assert.equal(RUMBO_ACTION_LABELS.findContacts, 'Buscar contactos con Rumbo IA');
    for (const label of Object.values(RUMBO_ACTION_LABELS)) assert.match(label, / con Rumbo IA$/);
  });

  it('el botón de preparar sigue el estado de la empresa', () => {
    assert.equal(launcherLabel({ regenerate: false, prepared: false }), 'Preparar primer contacto con Rumbo IA');
    assert.equal(launcherLabel({ regenerate: false, prepared: true }), 'Nueva preparación con Rumbo IA');
    assert.equal(launcherLabel({ regenerate: true, prepared: true }), 'Otra versión con Rumbo IA');
  });

  it('tres pesos de botón de IA: relleno, contorno y sin borde, distintos de los normales', () => {
    // Como «Piezas de IA» de UBITS: primario con degradado y secundario con el contorno
    // normal, los dos en pastilla (el borde en degradado se descartó).
    assert.match(buttonVariants({ variant: 'ai' }), /su-ai-gradient/);
    assert.match(buttonVariants({ variant: 'ai' }), /rounded-full/);
    assert.match(buttonVariants({ variant: 'ai-outline' }), /rounded-full/);
    assert.doesNotMatch(buttonVariants({ variant: 'ai-outline' }), /su-ai-border/);
    assert.match(buttonVariants({ variant: 'ai-ghost' }), /su-ai-ghost/);
    for (const v of ['ai-outline', 'ai-ghost'] as const) assert.match(buttonVariants({ variant: v }), /su-ai-icons/);
    assert.doesNotMatch(buttonVariants({ variant: 'outline' }), /su-ai/);
  });
});

describe('la marca de Rumbo', () => {
  it('el ícono de IA de siempre (Sparkles, BrainCircuit) dibuja la brújula de Rumbo', () => {
    assert.equal(Sparkles, Rumbo);
    assert.equal(BrainCircuit, Rumbo);
    const html = renderToStaticMarkup(h(Sparkles, { className: 'size-4' }));
    assert.match(html, /data-icon="rumbo"/);
    assert.match(html, /class="size-4"/);
  });

  it('lo que se mueve es la aguja; el aro queda quieto', () => {
    const html = renderToStaticMarkup(h(ChatMark, { motion: 'thinking' }));
    assert.match(html, /chat-mark--thinking/);
    assert.match(html, /class="chat-mark-needle"/);
  });
});

describe('página abierta antes de un deploy', () => {
  it('reconoce los errores de versión cruzada y no otros', () => {
    assert.ok(isVersionSkewError(new Error('Failed to find Server Action "7f3a". This request might be from an older or newer deployment.')));
    assert.ok(isVersionSkewError({ name: 'ChunkLoadError', message: 'Loading chunk 123 failed.' }));
    assert.equal(isVersionSkewError(new Error('No encontramos esa preparación.')), false);
    assert.equal(isVersionSkewError(null), false);
  });
});
