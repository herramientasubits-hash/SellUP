'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Reusable component for text cells that need truncation with ellipsis and
 * a native hover tooltip showing the full text.
 *
 * Requires the parent <td> to have a fixed or constrained width (guaranteed
 * by .su-table with table-layout:fixed).
 */
export function TruncatedCell({
  children,
  title,
  className,
}: {
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  const resolvedTitle = typeof children === 'string' ? children : title;
  return (
    <span
      title={resolvedTitle}
      className={cn(
        'block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap',
        className,
      )}
    >
      {children}
    </span>
  );
}
