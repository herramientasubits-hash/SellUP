'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// Canonical conversational-agent orb. Visual language intentionally mirrors the
// Agente 1 orb (src/components/prospect-batches/chat-wizard/ai-orb.tsx); kept as a
// neutral shared atom so Agente 1 stays fully untouched while new agent wizards
// share one consistent identity.

type AgentChatOrbSize = 'sm' | 'md';

interface AgentChatOrbProps {
  size?: AgentChatOrbSize;
  className?: string;
}

// 3D sphere — layered radial gradients: specular highlight top-right,
// pink bloom bottom-left, deep-purple spherical body with dark edges.
const ORB_STYLE: React.CSSProperties = {
  background: [
    'radial-gradient(ellipse at 68% 26%, rgba(165,215,255,0.95) 0%, rgba(110,175,255,0.55) 18%, transparent 42%)',
    'radial-gradient(ellipse at 28% 74%, rgba(220,50,255,0.65) 0%, transparent 46%)',
    'radial-gradient(circle at 50% 50%, #8b5cf6 0%, #6d28d9 38%, #4c1d95 62%, #2e0a7c 83%, #0e0025 100%)',
  ].join(', '),
  boxShadow: '0 2px 10px rgba(109,40,217,0.55), inset 0 1px 3px rgba(255,255,255,0.25)',
};

export function AgentChatOrb({ size = 'sm', className }: AgentChatOrbProps) {
  return (
    <div
      aria-hidden
      style={ORB_STYLE}
      className={cn(
        'shrink-0 rounded-full',
        size === 'sm' && 'h-6 w-6',
        size === 'md' && 'h-8 w-8',
        className,
      )}
    />
  );
}
