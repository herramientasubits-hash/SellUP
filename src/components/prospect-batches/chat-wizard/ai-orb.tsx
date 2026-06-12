'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

type AIOrBSize = 'sm' | 'md';

interface AIOrBProps {
  size?: AIOrBSize;
  className?: string;
}

export function AIOrb({ size = 'sm', className }: AIOrBProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'shrink-0 rounded-full su-ai-gradient flex items-center justify-center',
        size === 'sm' && 'h-6 w-6',
        size === 'md' && 'h-8 w-8',
        className,
      )}
    >
      <Sparkles
        className={cn(
          'text-white',
          size === 'sm' && 'h-3 w-3',
          size === 'md' && 'h-4 w-4',
        )}
        aria-hidden
      />
    </div>
  );
}
