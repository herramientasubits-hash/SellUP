import Link from 'next/link';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface LegacyCompatBannerProps {
  message: string;
  ctaLabel: string;
  ctaHref: string;
}

export function LegacyCompatBanner({ message, ctaLabel, ctaHref }: LegacyCompatBannerProps) {
  return (
    <Alert variant="info">
      <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{message}</span>
        <Link
          href={ctaHref}
          className="whitespace-nowrap rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          {ctaLabel} →
        </Link>
      </AlertDescription>
    </Alert>
  );
}
