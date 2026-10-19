import type { ReactNode } from 'react';
import { Brain, ExternalLink, Lightbulb, ShieldAlert } from '@/icons';
import { SellerAnswersForm } from './seller-answers-form';
import { formatInAppZone } from '@/lib/format-date';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { StatusBadge } from '@/components/data-display';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  RESEARCH_TOPICS,
  RESEARCH_TOPIC_LABELS,
  type ResearchBrief,
  type ResearchFact,
} from '@/server/agents/first-call/types';
import { ubitsProductName } from '@/server/agents/first-call/ubits-messaging-library';

const LINK_CLASSES =
  'inline-flex items-center gap-1 rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40';

function formatDay(iso: string): string {
  return formatInAppZone(iso, { day: '2-digit', month: 'short', year: 'numeric' }, 'es-CO');
}

function FactItem({ fact }: { fact: ResearchFact }) {
  return (
    <li id={`fact-${fact.id}`} className="space-y-1">
      <p className="text-sm text-foreground">
        <span className="mr-2 text-xs tabular-nums text-muted-foreground">{fact.id}</span>
        {fact.statement}
      </p>
      {fact.quote && (
        <blockquote className="border-l-2 border-border/80 pl-3 text-xs italic text-muted-foreground">
          «{fact.quote}»
        </blockquote>
      )}
      <p className="text-xs text-muted-foreground">
        {fact.sourceUrl ? (
          <a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer" className={LINK_CLASSES}>
            {fact.sourceLabel}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : (
          fact.sourceLabel
        )}
        {fact.publishedOn && <span> · {formatDay(`${fact.publishedOn}T12:00:00Z`)}</span>}
      </p>
    </li>
  );
}

interface ResearchBriefViewProps {
  brief: ResearchBrief | null;
  /** El botón para investigar (sólo si el agente está encendido). */
  launcher?: ReactNode;
  enabled: boolean;
  /** La ficha pasó sus 30 días: se muestra, pero conviene investigar de nuevo. */
  expired: boolean;
}

export function ResearchBriefView({ brief, launcher, enabled, expired }: ResearchBriefViewProps) {
  if (!brief || brief.status === 'running' || (brief.status === 'failed' && brief.facts.length === 0)) {
    const running = brief?.status === 'running';
    return (
      <EmptyState
        icon={Brain}
        title={running ? 'Investigando esta empresa…' : 'Aún no hay inteligencia comercial de esta empresa'}
        description={
          running
            ? 'El agente está leyendo su sitio oficial y sus noticias. Recarga en un momento.'
            : enabled
              ? 'El agente investiga qué hace, su tamaño, lo que le está pasando y cómo maneja su talento, con la fuente de cada dato. Luego prepara el primer contacto.'
              : 'Cuando el Agente 3 esté activado verás aquí qué hace la empresa, su momento y sus señales de talento, cada dato con su fuente.'
        }
        action={running ? undefined : launcher}
      />
    );
  }

  return (
    <div className="space-y-4">
      <SurfaceCard>
        <SurfaceCardHeader
          title="Lo que hay que saber antes de llamar"
          description={`Investigada el ${formatDay(brief.completedAt ?? brief.createdAt)}${expired ? ' · vencida: conviene investigar de nuevo' : ''}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                status={brief.status === 'sufficient' ? 'completed' : 'warning'}
                label={brief.status === 'sufficient' ? 'Suficiente para llamar' : 'Parcial'}
              />
              {launcher}
            </div>
          }
        />
        {brief.summary ? (
          <p className="text-sm leading-relaxed text-foreground">{brief.summary}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Sin resumen: revisa los datos de abajo.</p>
        )}
        {brief.status === 'partial' && (
          <p className="mt-3 text-xs text-muted-foreground">
            Faltó información para algunas preguntas. El guion será más general; usa la llamada para completar lo que falta.
          </p>
        )}
      </SurfaceCard>

      <ResearchBriefDetails brief={brief} />
    </div>
  );
}

/** Los datos de la investigación por pregunta, las hipótesis y lo que no se encontró (sin el encabezado). */
export function ResearchBriefDetails({
  brief,
  compact = false,
  canAddFacts = false,
  onAnswersSaved,
}: {
  brief: ResearchBrief;
  compact?: boolean;
  /** Responder lo que no se encontró y agregarlo a la investigación (con el agente encendido). */
  canAddFacts?: boolean;
  /** Se guardaron respuestas: quien lo monta rehace los textos. */
  onAnswersSaved?: (added: number) => void;
}) {
  // Lo que agregó el vendedor sobre la empresa va con «Lo que no se encontró», no en los temas.
  const sellerAnswers = brief.facts.filter((f) => f.sourceKind === 'seller' && !f.contactId);
  return (
    <div className="space-y-4">
      <div className={compact ? "grid gap-4" : "grid gap-4 lg:grid-cols-2"}>
        {RESEARCH_TOPICS.map((topic) => {
          const facts = brief.facts.filter((f) => f.topic === topic && f.sourceKind !== 'seller');
          if (facts.length === 0) return null;
          return (
            <SurfaceCard key={topic}>
              <SurfaceCardHeader title={RESEARCH_TOPIC_LABELS[topic]} />
              <ul className="space-y-3">
                {facts.map((fact) => (
                  <FactItem key={fact.id} fact={fact} />
                ))}
              </ul>
            </SurfaceCard>
          );
        })}
      </div>

      {(brief.hypotheses.length > 0 || brief.gaps.length > 0 || sellerAnswers.length > 0) && (
        <div className={compact ? "grid gap-4" : "grid gap-4 lg:grid-cols-2"}>
          {brief.hypotheses.length > 0 && (
            <SurfaceCard>
              <SurfaceCardHeader
                title="Hipótesis para UBITS"
                description="Posibles necesidades. Son hipótesis: confírmalas en la llamada."
              />
              <ul className="space-y-3">
                {brief.hypotheses.map((h, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                    <div className="space-y-1">
                      <p>{h.text}</p>
                      <div className="flex flex-wrap gap-1">
                        {ubitsProductName(h.productKey) && <Badge variant="outline">{ubitsProductName(h.productKey)}</Badge>}
                        {h.factRefs.map((ref) => (
                          <a key={ref} href={`#fact-${ref}`} className="text-xs tabular-nums text-muted-foreground hover:underline">
                            {ref}
                          </a>
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </SurfaceCard>
          )}
          {(brief.gaps.length > 0 || sellerAnswers.length > 0) && (
            <SurfaceCard>
              <SurfaceCardHeader
                title="Lo que no se encontró"
                description={canAddFacts ? 'Buenas preguntas para la llamada. Si sabes alguna, respóndela y la agregamos.' : 'Buenas preguntas para la llamada.'}
              />
              <SellerAnswersForm
                questions={brief.gaps.map((gap, i) => ({ question: gap, gapIndex: i, contactId: null }))}
                answered={sellerAnswers}
                briefId={canAddFacts ? brief.id : null}
                onSaved={onAnswersSaved}
              />
            </SurfaceCard>
          )}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldAlert className="size-3.5" aria-hidden="true" />
        Cada dato se comprobó contra su fuente; {brief.rejectedFacts === 1 ? 'se descartó 1 dato' : `se descartaron ${brief.rejectedFacts} datos`} sin cita
        verificable. {brief.sources.length} fuentes consultadas.
      </p>
    </div>
  );
}
