'use client';

/**
 * Pestaña «Origen y calidad» de la ficha del contacto: de dónde salió, qué tan
 * relevante lo evaluó la IA, qué se normalizó y cómo quedó en HubSpot.
 *
 * SOLO LECTURA. Todo llega del ViewModel (`buildContactTraceabilityViewModel`),
 * que construye la ficha; esta pieza no decide nada ni llama a ninguna acción.
 * Salió de `contact-detail-sheet.tsx` sin cambiar un texto. La tarjeta de
 * HubSpot se quedó allí y entra como `children`.
 */

import * as React from 'react';
import { Bot, CheckCircle2, FileCheck2, Sparkles, XCircle, type LucideIcon } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { DetailItem, DetailList } from '@/components/shared/detail-list';
import { DrawerSection } from '@/components/shared/drawer-section';
import type { buildContactTraceabilityViewModel } from '@/modules/contacts/contact-traceability';

// ── Calidad y trazabilidad ────────────────────────────────────────────────────

/** Una tarjeta del panel: la sección del drawer con su lista de pares en una columna. */
export function TraceCard({
  icon,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <DrawerSection title={title} icon={icon}>
      <DetailList className="gap-y-3 sm:grid-cols-1">{children}</DetailList>
    </DrawerSection>
  );
}

/** Un par etiqueta/valor: el `DetailItem` del sistema. */
export const TraceRow = DetailItem;

function EmptyTrace({ message }: { message: string }) {
  return (
    <p className="py-2 text-xs text-text-muted">{message}</p>
  );
}

export type ContactTraceabilityViewModel = ReturnType<typeof buildContactTraceabilityViewModel>;

export function ContactTraceabilityPanel({
  vm,
  children,
}: {
  vm: ContactTraceabilityViewModel;
  /** La cuarta tarjeta (HubSpot), que arma la ficha. */
  children?: React.ReactNode;
}) {

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Card 1 — Origen */}
      <TraceCard icon={Bot} title="Origen del contacto">
        <TraceRow label="Origen">
          <span className="flex items-center gap-1.5">
            {vm.hasSourceCandidate ? (
              <Badge variant="brand">
                {vm.originLabel}
              </Badge>
            ) : (
              <Badge variant="neutral">
                {vm.originLabel}
              </Badge>
            )}
          </span>
        </TraceRow>
        <TraceRow label="Fuente">
          <Badge variant="neutral">
            {vm.sourceLabel}
          </Badge>
        </TraceRow>
        {vm.hasSourceCandidate && vm.sourceCandidateId && (
          <TraceRow label="ID candidato">
            <span className="break-all font-mono text-xs text-muted-foreground">
              {vm.sourceCandidateId}
            </span>
          </TraceRow>
        )}
      </TraceCard>

      {/* Card 2 — Calidad y datos accionables */}
      <TraceCard icon={Sparkles} title="Calidad y datos accionables">
        {vm.hasRelevanceData ? (
          <>
            <TraceRow label="Relevancia">
              <RelevanceBadge label={vm.relevanceLabel} />
            </TraceRow>
            {vm.relevanceScore !== null && (
              <TraceRow label="Puntuación">
                <span className="tabular-nums">{vm.relevanceScore.toFixed(2)}</span>
              </TraceRow>
            )}
          </>
        ) : (
          <EmptyTrace message="Sin evaluación de IA registrada" />
        )}
        {vm.hasCompletionData ? (
          <>
            {vm.completedFields.length > 0 && (
              <TraceRow label="Datos completados">
                <span className="flex flex-wrap gap-1">
                  {vm.completedFields.map((f) => (
                    <Badge key={f} variant="neutral">
                      {f}
                    </Badge>
                  ))}
                </span>
              </TraceRow>
            )}
            {vm.hasActionableChannel !== null && (
              <TraceRow label="Canal accionable">
                <span className="flex items-center gap-1">
                  {vm.hasActionableChannel ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-text-muted" />
                  )}
                  <span>{vm.hasActionableChannel ? 'Sí' : 'No'}</span>
                </span>
              </TraceRow>
            )}
          </>
        ) : null}
      </TraceCard>

      {/* Card 3 — Normalización */}
      <TraceCard icon={FileCheck2} title="Normalización">
        {vm.isNormalized ? (
          <>
            <TraceRow label="Estado">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                <span>Normalizado</span>
              </span>
            </TraceRow>
            {vm.normalizedFields.length > 0 && (
              <TraceRow label="Campos normalizados">
                <span className="flex flex-wrap gap-1">
                  {vm.normalizedFields.map((f) => (
                    <Badge key={f} variant="neutral">
                      {f}
                    </Badge>
                  ))}
                </span>
              </TraceRow>
            )}
          </>
        ) : (
          <EmptyTrace message="Sin normalización registrada" />
        )}
      </TraceCard>

      {/* Card 4 — HubSpot (resumen). La pinta la ficha: su guarda estática exige que
          el tono del check viva en `contact-detail-sheet.tsx`. */}
      {children}
    </div>
  );
}

const RELEVANCE_VARIANT: Record<string, 'positive' | 'warning' | 'neutral'> = {
  Alta: 'positive',
  Media: 'warning',
  Baja: 'neutral',
};

function RelevanceBadge({ label }: { label: string }) {
  return <Badge variant={RELEVANCE_VARIANT[label] ?? 'neutral'}>{label}</Badge>;
}
