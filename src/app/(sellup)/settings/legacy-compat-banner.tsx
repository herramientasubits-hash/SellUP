import Link from 'next/link';
import { Info } from 'lucide-react';

interface LegacyCompatBannerProps {
  message: string;
  ctaLabel: string;
  ctaHref: string;
}

export function LegacyCompatBanner({ message, ctaLabel, ctaHref }: LegacyCompatBannerProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-su-brand/20 bg-su-brand-soft/40 px-4 py-3 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted-foreground">{message}</span>
        <Link
          href={ctaHref}
          className="whitespace-nowrap font-medium text-su-brand hover:underline"
        >
          {ctaLabel} →
        </Link>
      </div>
    </div>
  );
}
