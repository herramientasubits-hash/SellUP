'use client';

/**
 * connection-controls.tsx — los controles de la sección «Conexión» de un
 * proveedor (IA o de prospección): probar la conexión, cambiar la API key y
 * desconectar, con su confirmación.
 *
 * Es solo presentación: el estado y las acciones viven en la pestaña que lo
 * usa y llegan por props. Nada aquí llama al servidor.
 */

import { Loader2, Lock, Power, Zap } from '@/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/forms/field';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import type { ActionFeedback } from './detail-format';
import { InlineFeedback } from './detail-shared';

export interface ConnectionControlsProps {
  isPending: boolean;
  hasCredential: boolean;
  feedback: ActionFeedback | null;
  /** Formulario de la API key. */
  showKeyForm: boolean;
  apiKeyInput: string;
  keyPlaceholder: string;
  onApiKeyChange: (value: string) => void;
  onToggleKeyForm: () => void;
  onCancelKeyForm: () => void;
  onSaveKey: () => void;
  /** Confirmación de la desconexión. */
  showDisconnectConfirm: boolean;
  disconnectTitle: string;
  disconnectDescription: string;
  onRequestDisconnect: () => void;
  onCancelDisconnect: () => void;
  onDisconnect: () => void;
  onTest: () => void;
}

function ApiKeyForm({
  isPending,
  apiKeyInput,
  keyPlaceholder,
  onApiKeyChange,
  onCancelKeyForm,
  onSaveKey,
}: Pick<
  ConnectionControlsProps,
  'isPending' | 'apiKeyInput' | 'keyPlaceholder' | 'onApiKeyChange' | 'onCancelKeyForm' | 'onSaveKey'
>) {
  return (
    <div className="space-y-2 border-t border-border/50 pt-3">
      <Field label="Nueva API key" description="Reemplaza la credencial guardada. No se vuelve a mostrar.">
        <Input
          type="password"
          value={apiKeyInput}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder={keyPlaceholder}
          inputSize="sm"
          autoComplete="new-password"
        />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="xs" variant="outline" type="button" onClick={onCancelKeyForm}>
          Cancelar
        </Button>
        <Button size="xs" type="button" disabled={isPending || !apiKeyInput.trim()} onClick={onSaveKey}>
          {isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Guardar API key
        </Button>
      </div>
    </div>
  );
}

export function ConnectionControls(props: ConnectionControlsProps) {
  const { isPending, hasCredential, feedback } = props;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="xs" variant="outline" type="button" disabled={isPending || !hasCredential} onClick={props.onTest}>
          {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Zap aria-hidden="true" />}
          Probar conexión
        </Button>
        <Button size="xs" variant="outline" type="button" disabled={isPending} onClick={props.onToggleKeyForm}>
          <Lock aria-hidden="true" />
          Actualizar API key
        </Button>
        {hasCredential && (
          <Button size="xs" variant="destructive" type="button" disabled={isPending} onClick={props.onRequestDisconnect}>
            <Power aria-hidden="true" />
            Desconectar
          </Button>
        )}
      </div>

      {props.showKeyForm && (
        <ApiKeyForm
          isPending={isPending}
          apiKeyInput={props.apiKeyInput}
          keyPlaceholder={props.keyPlaceholder}
          onApiKeyChange={props.onApiKeyChange}
          onCancelKeyForm={props.onCancelKeyForm}
          onSaveKey={props.onSaveKey}
        />
      )}

      <ConfirmDialog
        open={props.showDisconnectConfirm}
        onOpenChange={(open) => {
          if (!open) props.onCancelDisconnect();
        }}
        variant="destructive"
        icon={Power}
        title={props.disconnectTitle}
        description={props.disconnectDescription}
        confirmLabel="Confirmar desconexión"
        loading={isPending}
        onConfirm={props.onDisconnect}
      />

      <InlineFeedback feedback={feedback} />
    </>
  );
}
