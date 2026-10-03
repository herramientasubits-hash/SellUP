"use client";

import * as React from "react";
import { ArrowRight, ClipboardPaste, Globe, Sparkles, UserPlus } from "@/icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/forms/field";
import { ModalShell } from "@/components/shared/modal-shell";
import { OptionTile } from "@/components/selection/option-tile";
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from "@/modules/accounts/types";
import { getPipelineStage, resolveCurrentStage } from "@/modules/pipeline/stages";
import { STAGE_NOTE_MIN_LENGTH, isStageNoteTextValid } from "@/modules/pipeline/stage-notes";
import { STAGE_MOVE_COPY } from "./pipeline-copy";

/** Lo que devuelve mover una empresa de etapa (la forma de `updateAccount`). */
export type ChangeStageResult = { success: true } | { success: false; error: string };

/**
 * El contexto que la persona le dio a SellUp al mover de etapa. Nunca se mueve
 * «a ciegas»: o lo hace la IA, o ya se hizo por fuera (contactos o notas
 * pegadas), o se mueve sin acción con un motivo que también se guarda.
 */
export type StageMoveContext =
  | { kind: "ai" }
  | { kind: "contacts" }
  | { kind: "paste"; text: string }
  | { kind: "none"; reason: string };

export type ChangeStageAction = (
  accountId: string,
  status: PipelineStatus,
  context: StageMoveContext,
) => Promise<ChangeStageResult>;

type Choice = "ai" | "outside" | "none";
type OutsideChoice = "contacts" | "hubspot" | "paste";

export interface StageMoveDialogProps {
  /** La empresa que se mueve; `null` = cerrado. */
  accountName: string | null;
  toStatus: PipelineStatus | null;
  /** Mueve con el contexto elegido. Solo se llama al confirmar, y una vez. */
  onConfirm: (context: StageMoveContext) => Promise<ChangeStageResult>;
  onCancel: () => void;
  /** Quien monta el diálogo puede abrir el agente de IA (el buscador del Agente 2A). */
  canUseAi?: boolean;
  /** Quien monta el diálogo puede abrir el alta de contactos de esa empresa. */
  canUploadContacts?: boolean;
}

function confirmLabel(choice: Choice | null, outside: OutsideChoice | null): string {
  if (choice === "ai") return STAGE_MOVE_COPY.confirm.ai;
  if (choice === "none") return STAGE_MOVE_COPY.confirm.none;
  if (choice === "outside" && outside === "contacts") return STAGE_MOVE_COPY.confirm.contacts;
  if (choice === "outside" && outside === "paste") return STAGE_MOVE_COPY.confirm.paste;
  return STAGE_MOVE_COPY.confirm.pick;
}

/**
 * StageMoveDialog — el ÚNICO flujo para mover una empresa de etapa (la barra de
 * acciones y el tablero lo comparten). Antes de mover pregunta cómo le damos a
 * SellUp el contexto de la etapa: que lo haga la IA (solo si la etapa destino
 * ya tiene agente), que ya se hizo por fuera (subir los contactos, traerlos de
 * HubSpot —pronto—, o pegar lo que pasó) o moverla sin acción con un motivo.
 * El botón principal dice qué va a pasar y se queda apagado hasta que la opción
 * esté completa. Si guardar falla, no se mueve y el diálogo sigue abierto.
 */
export function StageMoveDialog({
  accountName,
  toStatus,
  onConfirm,
  onCancel,
  canUseAi = false,
  canUploadContacts = false,
}: StageMoveDialogProps) {
  const isOpen = accountName !== null && toStatus !== null;
  const [choice, setChoice] = React.useState<Choice | null>(null);
  const [outside, setOutside] = React.useState<OutsideChoice | null>(null);
  const [pasted, setPasted] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Cada apertura empieza de cero: lo elegido para otra empresa no se arrastra.
  const openKey = isOpen ? `${accountName}:${toStatus}` : null;
  const [lastOpenKey, setLastOpenKey] = React.useState(openKey);
  if (lastOpenKey !== openKey) {
    setLastOpenKey(openKey);
    setChoice(null);
    setOutside(null);
    setPasted("");
    setReason("");
    setError(null);
  }

  const stageId = toStatus ? resolveCurrentStage(toStatus).stageId : null;
  const stage = stageId ? getPipelineStage(stageId) : null;
  const stageHasAgent = stage?.phase === "hecho";
  const aiBlockedReason = !stageHasAgent ? STAGE_MOVE_COPY.aiSoon : !canUseAi ? STAGE_MOVE_COPY.aiUnavailable : null;
  const contactsBlockedReason = canUploadContacts ? null : STAGE_MOVE_COPY.contactsUnavailable;

  const context: StageMoveContext | null =
    choice === "ai" && !aiBlockedReason
      ? { kind: "ai" }
      : choice === "outside" && outside === "contacts" && !contactsBlockedReason
        ? { kind: "contacts" }
        : choice === "outside" && outside === "paste" && isStageNoteTextValid(pasted)
          ? { kind: "paste", text: pasted }
          : choice === "none" && isStageNoteTextValid(reason)
            ? { kind: "none", reason }
            : null;

  async function confirm() {
    if (!context || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await onConfirm(context);
      if (!result.success) setError(result.error);
    } catch {
      setError(STAGE_MOVE_COPY.failed);
    } finally {
      setIsSaving(false);
    }
  }

  const stageLabel = toStatus ? PIPELINE_STATUS_LABELS[toStatus] : "";

  return (
    <ModalShell
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isSaving) onCancel();
      }}
      size="xl"
      title={isOpen ? STAGE_MOVE_COPY.title(accountName, stageLabel) : ""}
      description={STAGE_MOVE_COPY.question}
      actions={
        <>
          <Button type="button" variant="outline" disabled={isSaving} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" disabled={!context || isSaving} onClick={confirm}>
            {isSaving ? STAGE_MOVE_COPY.saving : confirmLabel(choice, outside)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label={STAGE_MOVE_COPY.groupLabel} className="flex flex-col gap-2">
          <OptionTile
            option={{
              value: "ai",
              label: STAGE_MOVE_COPY.ai,
              badge: aiBlockedReason ? undefined : STAGE_MOVE_COPY.aiBadge,
              description: aiBlockedReason ?? (stage ? STAGE_MOVE_COPY.aiDescription(stage.agent) : undefined),
              icon: Sparkles,
              disabled: aiBlockedReason !== null,
            }}
            selected={choice === "ai"}
            onSelect={() => setChoice("ai")}
          />
          <OptionTile
            option={{
              value: "outside",
              label: STAGE_MOVE_COPY.outside,
              description: STAGE_MOVE_COPY.outsideDescription,
              icon: ClipboardPaste,
            }}
            selected={choice === "outside"}
            onSelect={() => setChoice("outside")}
          />

          {choice === "outside" && (
            <div className="flex flex-col gap-2 border-l-2 border-border/60 pl-3">
              <div role="radiogroup" aria-label={STAGE_MOVE_COPY.outsideGroupLabel} className="flex flex-col gap-2">
                <OptionTile
                  option={{
                    value: "contacts",
                    label: STAGE_MOVE_COPY.contacts,
                    description: contactsBlockedReason ?? STAGE_MOVE_COPY.contactsDescription,
                    icon: UserPlus,
                    disabled: contactsBlockedReason !== null,
                  }}
                  selected={outside === "contacts"}
                  onSelect={() => setOutside("contacts")}
                />
                {/* No hay hoy cómo traer contactos DESDE HubSpot a SellUp: la opción
                    se ve, apagada y explicada, y nunca escribe en HubSpot. */}
                <OptionTile
                  option={{
                    value: "hubspot",
                    label: STAGE_MOVE_COPY.hubspot,
                    description: STAGE_MOVE_COPY.hubspotSoon,
                    icon: Globe,
                    disabled: true,
                  }}
                  selected={false}
                />
                <OptionTile
                  option={{
                    value: "paste",
                    label: STAGE_MOVE_COPY.paste,
                    description: STAGE_MOVE_COPY.pasteDescription,
                    icon: ClipboardPaste,
                  }}
                  selected={outside === "paste"}
                  onSelect={() => setOutside("paste")}
                />
              </div>
              {outside === "paste" && (
                <Field
                  label={STAGE_MOVE_COPY.pasteLabel}
                  description={STAGE_MOVE_COPY.pasteHint}
                  error={
                    pasted.trim() !== "" && !isStageNoteTextValid(pasted)
                      ? STAGE_MOVE_COPY.tooShort(STAGE_NOTE_MIN_LENGTH)
                      : undefined
                  }
                >
                  <Textarea rows={5} value={pasted} onChange={(event) => setPasted(event.target.value)} />
                </Field>
              )}
            </div>
          )}

          <OptionTile
            option={{
              value: "none",
              label: STAGE_MOVE_COPY.none,
              description: STAGE_MOVE_COPY.noneDescription,
              icon: ArrowRight,
            }}
            selected={choice === "none"}
            onSelect={() => setChoice("none")}
          />
        </div>

        {choice === "none" && (
          <Field
            label={STAGE_MOVE_COPY.noneLabel}
            description={STAGE_MOVE_COPY.noneHint}
            error={
              reason.trim() !== "" && !isStageNoteTextValid(reason)
                ? STAGE_MOVE_COPY.tooShort(STAGE_NOTE_MIN_LENGTH)
                : undefined
            }
          >
            <Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </ModalShell>
  );
}
