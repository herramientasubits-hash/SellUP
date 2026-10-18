'use client';

/**
 * «Preparar primer contacto» desde afuera de una empresa (dueña 18-10): primero la
 * empresa, como en «Buscar contactos». Se busca en SellUp y en HubSpot para asociarla;
 * si no está, se piden país y dominio y se crea (en SellUp, y en HubSpot con la
 * revisión de duplicados de siempre). Después se abre el Agente 3 de esa empresa.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { ChatPanel, ChatQuestionPanel } from '@/components/chat';
import { AgentChatTimeline } from '@/components/agent-chat/agent-chat-timeline';
import type { AgentChatMessage } from '@/components/agent-chat/agent-chat-types';
import { AiAnalyzingState } from '@/components/ai/ai-analyzing-state';
import { buildResolveInput } from '@/components/contact-enrichment/contact-enrichment-chat-reducer';
import { resolveContactEnrichmentCompanyAction } from '@/modules/contact-enrichment/actions';
import type { CompanyCandidate } from '@/modules/contact-enrichment/types';
import { resolveFirstContactCompanyAction, type FirstContactCompanyHubSpot } from '@/modules/speech/first-contact-company-actions';
import { LATAM_COUNTRIES } from '@/modules/accounts/types';

type Step =
  | { id: 'ask' }
  | { id: 'searching'; query: string }
  | { id: 'choose'; query: string; candidates: CompanyCandidate[] }
  | { id: 'country'; name: string }
  | { id: 'domain'; name: string; countryCode: string }
  | { id: 'resolving'; label: string };

const SOURCE_LABEL: Readonly<Record<CompanyCandidate['source'], string>> = {
  sellup: 'En SellUp',
  hubspot: 'En HubSpot',
  manual: 'Nueva',
};

const HUBSPOT_NOTE: Readonly<Record<FirstContactCompanyHubSpot, string>> = {
  linked: 'Ya estaba vinculada a HubSpot.',
  created: 'También quedó en HubSpot.',
  pending_review: 'En HubSpot hay una empresa parecida: quedó para revisar antes de crearla.',
  not_created: 'No se pudo dejar en HubSpot todavía; se reintenta al aprobar contactos.',
};

function candidateLabel(c: CompanyCandidate): { label: string; description: string } {
  const where = [c.domain, c.country].filter(Boolean).join(' · ');
  return { label: c.name, description: [SOURCE_LABEL[c.source], where].filter(Boolean).join(' · ') };
}

export function FirstContactCompanyPicker({
  open,
  onOpenChange,
  onResolved,
  onBack,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** «Volver» a «¿Qué quieres hacer?» de Rumbo. */
  onBack?: () => void;
  /** La empresa quedó lista en SellUp: se abre el Agente 3 para ella. */
  onResolved: (accountId: string) => void;
}) {
  const [step, setStep] = React.useState<Step>({ id: 'ask' });
  const [answers, setAnswers] = React.useState<AgentChatMessage[]>([]);

  const reset = React.useCallback(() => {
    setStep({ id: 'ask' });
    setAnswers([]);
  }, []);

  const say = (question: string, answer: string) =>
    setAnswers((prev) => [
      ...prev,
      { id: `q-${prev.length}`, role: 'assistant', content: question },
      { id: `a-${prev.length}`, role: 'user', content: answer },
    ]);

  const search = async (query: string) => {
    say('¿Para qué empresa preparamos el primer contacto?', query);
    setStep({ id: 'searching', query });
    try {
      const result = await resolveContactEnrichmentCompanyAction(buildResolveInput(query));
      const candidates = (result.success ? result.data?.candidates ?? [] : []).filter((c) => c.source !== 'manual');
      if (candidates.length === 0) {
        setStep({ id: 'country', name: query.trim() });
        return;
      }
      setStep({ id: 'choose', query, candidates });
    } catch {
      toast.error('No pudimos buscar la empresa. Vuelve a intentarlo.');
      setStep({ id: 'ask' });
    }
  };

  const resolve = async (label: string, input: Parameters<typeof resolveFirstContactCompanyAction>[0]) => {
    setStep({ id: 'resolving', label });
    const result = await resolveFirstContactCompanyAction(input).catch(() => null);
    if (!result || !result.success) {
      toast.error(result && !result.success ? result.error : 'No pudimos preparar la empresa. Vuelve a intentarlo.');
      setStep({ id: 'ask' });
      return;
    }
    if (result.created) toast.success('Empresa creada en SellUp.', { description: HUBSPOT_NOTE[result.hubspot] });
    reset();
    onResolved(result.accountId);
  };

  const question = (() => {
    switch (step.id) {
      case 'ask':
        return (
          <ChatQuestionPanel
            title="¿Para qué empresa preparamos el primer contacto?"
            description="Su nombre, su dominio o su ID de HubSpot. La buscamos en SellUp y en HubSpot; si no está, la creamos."
            options={[]}
            otherLabel="Empresa"
            otherPlaceholder="Ej.: Grupo Ciisa, grupociisa.com o 1234567890"
            otherMaxLength={160}
            onOther={(text) => text.trim() && void search(text.trim())}
          />
        );
      case 'choose':
        return (
          <ChatQuestionPanel
            title="¿Es alguna de estas?"
            options={[
              ...step.candidates.map((c, i) => ({ value: String(i), ...candidateLabel(c) })),
              { value: 'new', label: 'No es ninguna: crearla', description: `Crear «${step.query}» en SellUp (y en HubSpot).` },
            ]}
            onBack={() => setStep({ id: 'ask' })}
            onAnswer={(value) => {
              if (value === 'new') {
                say('¿Es alguna de estas?', 'No es ninguna');
                setStep({ id: 'country', name: step.query.trim() });
                return;
              }
              const chosen = step.candidates[Number(value)];
              if (!chosen) return;
              say('¿Es alguna de estas?', chosen.name);
              void resolve(chosen.source === 'hubspot' ? 'Trayendo la empresa de HubSpot…' : 'Abriendo la empresa…', { candidate: chosen });
            }}
          />
        );
      case 'country':
        return (
          <ChatQuestionPanel
            title={`¿De qué país es ${step.name}?`}
            description="No la encontramos en SellUp ni en HubSpot: la vamos a crear."
            options={LATAM_COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
            filterPlaceholder="Buscar país"
            onBack={() => setStep({ id: 'ask' })}
            onAnswer={(code) => {
              say(`¿De qué país es ${step.name}?`, LATAM_COUNTRIES.find((c) => c.code === code)?.name ?? code);
              setStep({ id: 'domain', name: step.name, countryCode: code });
            }}
          />
        );
      case 'domain':
        return (
          <ChatQuestionPanel
            title="¿Cuál es su sitio web?"
            description="Ayuda a no duplicarla y a investigarla mejor."
            options={[{ value: 'none', label: 'No lo sé' }]}
            otherLabel="Dominio"
            otherPlaceholder="Ej.: empresa.com"
            otherMaxLength={120}
            onBack={() => setStep({ id: 'country', name: step.name })}
            onAnswer={() => {
              say('¿Cuál es su sitio web?', 'No lo sé');
              void resolve('Creando la empresa…', { manual: { name: step.name, countryCode: step.countryCode, domain: null } });
            }}
            onOther={(domain) => {
              say('¿Cuál es su sitio web?', domain.trim());
              void resolve('Creando la empresa…', { manual: { name: step.name, countryCode: step.countryCode, domain: domain.trim() } });
            }}
          />
        );
      default:
        return null;
    }
  })();

  const working = step.id === 'searching' || step.id === 'resolving';

  return (
    <ChatPanel
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      subtitle="Primer contacto · elegir empresa"
      onBack={
        onBack
          ? () => {
              reset();
              onBack();
            }
          : undefined
      }
      markMotion={working ? 'thinking' : 'breathing'}
      onNewConversation={reset}
      newConversationLabel="Empezar de nuevo"
      newConversationDisabled={working}
      closeDisabled={step.id === 'resolving'}
    >
      {working ? (
        <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="first-contact-company-working">
          <AiAnalyzingState className="flex-1" title={step.id === 'searching' ? 'Buscando en SellUp y HubSpot' : step.label} />
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="first-contact-company-picker">
          <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-5">
            <AgentChatTimeline
              messages={[
                {
                  id: 'intro',
                  role: 'assistant',
                  content: 'Preparo el primer contacto con una empresa: primero la buscamos en SellUp y HubSpot, y si no está, la creamos.',
                },
                ...answers,
              ]}
            />
          </div>
          {question && <div className="shrink-0 px-4 pb-4 pt-2">{question}</div>}
        </div>
      )}
    </ChatPanel>
  );
}
