'use client';

import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { CostDisplayValue } from '@/modules/usage-tracking/cost-display';

interface CostValueProps {
  display: CostDisplayValue;
  className?: string;
}

/** Renders a resolved cost-display value, attaching a compact explanatory tooltip when the cost is partial/unknown. */
export function CostValue({ display, className }: CostValueProps) {
  if (!display.isPartial || !display.description) {
    return <span className={className}>{display.label}</span>;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className={`inline-flex items-center gap-1 cursor-help ${className ?? ''}`}>
              {display.label}
              <Info className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            </span>
          }
        />
        <TooltipContent className="max-w-[220px] text-[11px] leading-relaxed">
          {display.description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
