'use client';

/**
 * use-wizard-message-sound.ts — click mecánico corto cuando aparece un mensaje del
 * asistente en el wizard.
 *
 * Extraído literalmente de `prospect-chat-wizard.tsx` (A1-APOLLO-QA-CONTROL-SURFACE-1):
 * cuarenta líneas de síntesis de audio dentro de un componente de orquestación
 * hacían que el archivo pasara el techo de tamaño del repo, y no comparten estado
 * con nada más del wizard.
 *
 * Sin cambios de comportamiento: mismos nodos, mismas frecuencias, mismas
 * envolventes, y el mismo `catch` silencioso — un navegador sin `AudioContext` no
 * puede romper la conversación por no poder hacer un clic.
 */

import * as React from 'react';

export function useWizardMessageSound(): () => void {
  return React.useCallback(() => {
    try {
      const ctx = new AudioContext();
      // Noise buffer for the click transient
      const bufferSize = Math.floor(ctx.sampleRate * 0.015);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 8);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      // Bandpass filter to shape the click
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 3200;
      filter.Q.value = 1.2;
      // Short gain envelope
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(ctx.currentTime);
      noise.stop(ctx.currentTime + 0.03);
      // Tiny tonal tap for body
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 1800;
      oscGain.gain.setValueAtTime(0.04, ctx.currentTime);
      oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.015);
      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.015);
      setTimeout(() => ctx.close(), 80);
    } catch {
      // Silently ignore if AudioContext is unavailable
    }
  }, []);
}
