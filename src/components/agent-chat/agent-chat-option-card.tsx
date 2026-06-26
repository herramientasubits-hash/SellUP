'use client';

import * as React from 'react';
import { ChevronRight } from 'lucide-react';

// ── Conversational option card ────────────────────────────────────────────────
// A clickable card used to present in-conversation choices (e.g. company
// matches). Native <button> for full keyboard semantics; surface styling mirrors
// SurfaceCard tokens. Neutral and reusable across agent wizards.

interface AgentChatOptionCardProps {
  icon?: React.ReactNode;
  title: string;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  ariaLabel?: string;
  onClick: () => void;
}

export function AgentChatOptionCard({
  icon,
  title,
  meta,
  trailing,
  ariaLabel,
  onClick,
}: AgentChatOptionCardProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? title}
      onClick={onClick}
      className="w-full rounded-2xl border border-border/50 bg-card p-4 text-left transition-all duration-200 hover:border-su-brand/40 hover:shadow-sm focus-visible:border-su-brand/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-su-brand/20"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {icon && <div className="shrink-0">{icon}</div>}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{title}</p>
            {meta && <div className="mt-0.5 flex flex-wrap items-center gap-2">{meta}</div>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {trailing}
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
      </div>
    </button>
  );
}
