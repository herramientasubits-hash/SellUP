'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  hasOwnershipUnverifiedFlag,
  OWNERSHIP_UNVERIFIED_DETAIL,
  OWNERSHIP_UNVERIFIED_LABEL,
} from '@/modules/prospect-batches/ownership-review-flag';
import {
  IMPORT_REVIEW_FLAG_LABELS,
  readImportReviewFlags,
} from '@/modules/prospect-batches/import-review-flags';

interface CandidateDetailBannersProps {
  flags: string[];
  hasNitConflict: boolean;
}

/** Los avisos que abren la ficha: lo que hay que saber antes de leer el resto. */
export function CandidateDetailBanners({ flags, hasNitConflict }: CandidateDetailBannersProps) {
  return (
    <>
      {flags.includes('limited_public_data') && (
        <Alert variant="info">
          <AlertDescription className="text-xs leading-relaxed text-current">
            Datos comerciales públicos limitados. Puedes revisarlo con la información oficial disponible.
          </AlertDescription>
        </Alert>
      )}
      {hasNitConflict && (
        <Alert variant="warning">
          <AlertDescription className="text-xs leading-relaxed text-current">
            NIT inconsistente detectado en evidencia web. Verificar datos antes de aprobar.
          </AlertDescription>
        </Alert>
      )}
      {flags.includes('liquidation_signal') && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs leading-relaxed text-current">
            Esta empresa presenta una señal crítica de liquidación o cese de operaciones.
          </AlertDescription>
        </Alert>
      )}
      {/*
        🔴 VISIBILIDAD DE OWNERSHIP (opción C) — ámbar, no destructivo, y a
        propósito: esto NO afirma que el dominio sea incorrecto. Afirma que
        no se pudo verificar la relación, que es una pregunta sin responder
        y no un rechazo.
      */}
      {hasOwnershipUnverifiedFlag(flags) && (
        <Alert variant="warning" data-testid="ownership-unverified-banner">
          <AlertDescription className="text-xs leading-relaxed text-current">
            <strong className="font-semibold">{OWNERSHIP_UNVERIFIED_LABEL}.</strong>{' '}
            {OWNERSHIP_UNVERIFIED_DETAIL}
          </AlertDescription>
        </Alert>
      )}
      {/* AGENT1-IMPORT-PARITY-3 — avisos de la importación: revisar, no rechazo. */}
      {readImportReviewFlags(flags).map((flag) => (
        <Alert variant="warning" key={flag} data-testid={`import-review-flag-${flag}`}>
          <AlertDescription className="text-xs leading-relaxed text-current">
            {IMPORT_REVIEW_FLAG_LABELS[flag]}
          </AlertDescription>
        </Alert>
      ))}
    </>
  );
}
