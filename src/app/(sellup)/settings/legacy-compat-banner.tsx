import Link from 'next/link';
import { Info } from "@/icons";

interface LegacyCompatBannerProps {
  message: string;
  ctaLabel: string;
  ctaHref: string;
}

export function LegacyCompatBanner({ message, ctaLabel, ctaHref }: LegacyCompatBannerProps) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted-foreground">{message}</span>
        <Link
          href={ctaHref}
          className="whitespace-nowrap rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          {ctaLabel} →
        </Link>
      </div>
    </div>
  );
}
