'use client';

// «Buscar más números» — el CTA PAGADO
// (AGENT2A-SEARCH-MORE-PHONES-1)
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ ES UN COMPONENTE PROPIO Y NO CÓDIGO EN EL DRAWER
// ═══════════════════════════════════════════════════════════════════
//
// Dos razones, y la segunda es la que importa:
//
//   1. `contact-candidate-detail-sheet.tsx` pasa de 3 000 líneas. Añadirle un modal, una
//      máquina de estados y un sondeo lo haría ilegible justo en el archivo que ya cuesta
//      revisar;
//   2. este componente se puede probar SOLO. Las garantías que hay que demostrar —el primer
//      clic no gasta, el teléfono actual sigue visible mientras se busca, el sondeo no
//      gasta— son afirmaciones sobre ESTE árbol, y montarlo aislado las hace verificables
//      sin construir un candidato entero.
//
// ═══════════════════════════════════════════════════════════════════
// EL PRIMER CLIC NO GASTA
// ═══════════════════════════════════════════════════════════════════
//
// Es la propiedad central. El CTA abre un modal; SÓLO el botón de confirmación invoca
// `searchMoreCandidatePhonesAction`. Este componente no importa el cliente de Lusha, ni el
// de Apollo, ni el reservador de créditos: la única acción que gasta es esa, y llega por una
// sola línea que un test puede vigilar.
//
// La confirmación NOMBRA el proveedor (Lusha) y el TECHO (5 créditos), y dice que puede
// cobrarse aunque no aparezca nada nuevo — que es el desenlace más probable. Un operador que
// pulsa «Buscar más números» tiene que poder saber qué está comprando antes de comprarlo.
//
// ═══════════════════════════════════════════════════════════════════
// MIENTRAS BUSCA, EL TELÉFONO SIGUE VISIBLE
// ═══════════════════════════════════════════════════════════════════
//
// Este componente NO renderiza el teléfono: lo renderiza el drawer, justo encima, y se queda
// donde está. Aquí sólo aparece una línea de estado. Sustituir el número por un esqueleto
// mientras se busca un ADICIONAL sería esconder un dato que el operador ya tiene y ya pagó —
// y si la búsqueda falla, lo habría escondido para nada.
//
// ═══════════════════════════════════════════════════════════════════
// EL SONDEO NO GASTA
// ═══════════════════════════════════════════════════════════════════
//
// La server action de la compra es SÍNCRONA: devuelve el desenlace en la misma llamada. Así
// que no hay ningún sondeo de resultado — no existe un bucle esperando un webhook, porque no
// hay webhook.
//
// Lo que sí hay es un REFRESCO ACOTADO del preflight después de cada estado terminal, con la
// forma de #300 (un pestillo que impide solaparlos, y un techo de intentos), y su única
// llamada es `getSearchMorePhonesPreflightAction`, que sólo hace `SELECT`. Es lo que hace que
// «Ver más números» aparezca sin F5 cuando la colección creció.

import * as React from 'react';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getSearchMorePhonesPreflightAction,
  searchMoreCandidatePhonesAction,
} from '@/modules/contact-enrichment/search-more-phones-actions';
import type { SearchMorePreflightSummary } from '@/modules/contact-enrichment/search-more-phones-read';
import {
  getSearchMoreDisabledCopy,
  getSearchMoreMaxCreditsLine,
  getSearchMoreProviderLine,
  getSearchMoreSuccessCopy,
  SEARCH_MORE_CONFIRM_ACCEPT_LABEL,
  SEARCH_MORE_CONFIRM_BODY,
  SEARCH_MORE_CONFIRM_CANCEL_LABEL,
  SEARCH_MORE_CONFIRM_COST_WARNING,
  SEARCH_MORE_CONFIRM_TITLE,
  SEARCH_MORE_CTA_LABEL,
  SEARCH_MORE_NO_NEW_DISTINCT_PHONES_COPY,
  SEARCH_MORE_NO_NEW_PHONES_COPY,
  SEARCH_MORE_PRIVACY_BLOCKED_COPY,
  SEARCH_MORE_PROVIDER_ERROR_COPY,
  SEARCH_MORE_RUNNING_LABEL,
} from './search-more-phones-copy';

/**
 * Techo de refrescos del preflight tras una corrida terminal. Existe porque un bucle sin
 * techo es el defecto que #279 encontró en Producción: dos búsquedas de HubSpot eran los
 * únicos `fetch` sin límite, y el spinner no terminaba nunca.
 *
 * Uno basta en el camino normal —la acción ya devolvió el desenlace, así que la colección ya
 * está escrita— y el segundo cubre una réplica de lectura que aún no lo vea.
 */
const PREFLIGHT_REFRESH_MAX_ATTEMPTS = 2;

/** Espera entre refrescos. Corta: no se está esperando a un proveedor, sino a un `SELECT`. */
const PREFLIGHT_REFRESH_DELAY_MS = 900;

export interface CandidateSearchMorePhonesCtaProps {
  readonly candidateId: string;
  /**
   * El resumen que el servidor ya resolvió. Este componente NO calcula elegibilidad: la lee
   * del plan que viene dentro. Si es `null` el CTA no se pinta — no se adivina.
   */
  readonly summary: SearchMorePreflightSummary | null;
  /**
   * Se invoca cuando la colección PUDO cambiar, con el resumen recién leído. El drawer la usa
   * para recargar su propio conteo, que es lo que hace aparecer «Ver más números».
   */
  readonly onCollectionMayHaveChanged: (
    summary: SearchMorePreflightSummary | null,
  ) => void;
  /** true cuando el drawer está ocupado en otra operación. Deshabilita el CTA. */
  readonly disabled?: boolean;
}

type RunState =
  | { readonly kind: 'idle' }
  /** La compra está en vuelo. El teléfono de arriba SIGUE visible. */
  | { readonly kind: 'running' }
  /** Terminó, y esto es lo que se le dice al operador. */
  | { readonly kind: 'settled'; readonly message: string };

/**
 * Traduce el desenlace de la acción a la ÚNICA cadena que el operador debe leer.
 *
 * Cada rama afirma exactamente lo que ocurrió, y las tres distinciones que se conservan son
 * las que costaría perder:
 *
 *   * `no_new_phones` con `newDistinctPhoneCount === 0` cubre DOS hechos distintos y el copy
 *     los separa: Lusha no tenía nada (`no_phone_found`) frente a Lusha tenía y era el mismo
 *     (`no_new_distinct_phone`). El segundo NO puede decir «no encontramos números en Lusha»,
 *     porque Lusha sí tiene — es el que ya está guardado;
 *   * un fallo del proveedor se dice como fallo. Degradarlo a «no encontramos nada»
 *     convertiría un problema técnico en una afirmación sobre la persona;
 *   * un bloqueo de privacidad reutiliza el copy del reveal, sin decir cuál de los tres
 *     bloqueos fue: distinguirlos en pantalla filtraría si la persona ejerció una DSAR.
 */
function resolveSettledMessage(
  result: Awaited<ReturnType<typeof searchMoreCandidatePhonesAction>>,
): { readonly message: string; readonly tone: 'success' | 'neutral' | 'error' } {
  switch (result.outcome) {
    case 'new_phones_found':
      return {
        message: getSearchMoreSuccessCopy(result.newDistinctPhoneCount),
        tone: 'success',
      };
    case 'no_new_phones':
      // DOS hechos distintos llegan por esta rama, y el copy NO puede colapsarlos. Se
      // distinguen por `lushaOutcome`, que es el valor que el servidor escribió en el
      // ledger — no por el conteo, que es 0 en los dos casos:
      //
      //   * `no_new_distinct_phone` — Lusha contestó, se le COBRÓ, y todos sus números ya
      //     estaban. Decir «no encontramos números adicionales en Lusha» aquí sugeriría que
      //     Lusha no tiene nada, y sí tiene: es el número que el operador está viendo;
      //   * `no_phone_found` — Lusha contestó y no tiene teléfono para esa persona.
      return {
        message:
          result.lushaOutcome === 'no_new_distinct_phone'
            ? SEARCH_MORE_NO_NEW_DISTINCT_PHONES_COPY
            : SEARCH_MORE_NO_NEW_PHONES_COPY,
        tone: 'neutral',
      };
    case 'privacy_blocked':
      return { message: SEARCH_MORE_PRIVACY_BLOCKED_COPY, tone: 'error' };
    case 'already_attempted':
      return {
        message: 'Ya había una búsqueda en curso para este contacto.',
        tone: 'neutral',
      };
    case 'provider_error':
      return { message: SEARCH_MORE_PROVIDER_ERROR_COPY, tone: 'error' };
    case 'not_started':
    default: {
      // No se creó corrida: 0 llamadas y 0 créditos. El motivo puede ser de saldo, de
      // infraestructura o de elegibilidad, y ninguno se presenta como «no encontramos
      // números» — eso afirmaría un hecho sobre los datos que nadie consultó.
      const disabledCopy = result.reason
        ? getSearchMoreDisabledCopy(
            result.reason as Parameters<typeof getSearchMoreDisabledCopy>[0],
          )
        : null;
      return {
        message:
          disabledCopy ??
          'No pudimos iniciar la búsqueda. No se consumió ningún crédito.',
        tone: 'error',
      };
    }
  }
}

export function CandidateSearchMorePhonesCta({
  candidateId,
  summary,
  onCollectionMayHaveChanged,
  disabled = false,
}: CandidateSearchMorePhonesCtaProps) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [state, setState] = React.useState<RunState>({ kind: 'idle' });

  // PESTILLO de solicitud, con la forma de #300. `useRef` y no estado porque tiene que ser
  // legible SINCRÓNICAMENTE dentro del handler: un segundo clic llega antes de que React
  // haya re-renderizado con `running`, así que un booleano de estado no lo pararía.
  const inFlight = React.useRef(false);

  // Cambiar de candidato invalida todo. Se ajusta durante el render —el mismo patrón que el
  // drawer usa para adaptar estado a una prop— para que el resultado del candidato anterior
  // no se pinte ni un frame sobre el nuevo.
  //
  // El PESTILLO deliberadamente NO se toca aquí, y no es un olvido:
  //
  //   * un ref no puede mutarse durante el render (React no garantiza cuántas veces corre, y
  //     el linter lo prohíbe con razón);
  //   * pero además no hace falta. El `finally` de `handleConfirm` lo libera SIEMPRE, así que
  //     no existe el camino en que se quede trabado;
  //   * y dejarlo puesto es la dirección CONSERVADORA: si hay una compra en vuelo para el
  //     candidato A y el operador salta a B, el pestillo sigue cerrado hasta que A liquide, así
  //     que un clic apresurado en B no abre una segunda operación pagada. Limpiarlo aquí
  //     compraría un clic más rápido a cambio de una autorización de más.
  const [ownerId, setOwnerId] = React.useState(candidateId);
  if (ownerId !== candidateId) {
    setOwnerId(candidateId);
    setState({ kind: 'idle' });
    setConfirmOpen(false);
  }

  /**
   * Relee el preflight con un techo de intentos. SÓLO `SELECT`: 0 llamadas a proveedor, 0
   * corridas, 0 reservas, 0 créditos y 0 escrituras.
   *
   * Devuelve el resumen al drawer en CADA intento, no sólo en el último: el primero suele
   * traer ya la colección nueva, y esperar al techo retrasaría «Ver más números» sin motivo.
   */
  const refreshPreflight = React.useCallback(
    async (targetCandidateId: string) => {
      for (let attempt = 0; attempt < PREFLIGHT_REFRESH_MAX_ATTEMPTS; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, PREFLIGHT_REFRESH_DELAY_MS),
          );
        }
        // El operador pudo cambiar de candidato mientras esperábamos. Abandonar es correcto:
        // el resumen que llegara ahora describiría a otra persona.
        if (targetCandidateId !== candidateId) return;

        const next = await getSearchMorePhonesPreflightAction({
          candidateId: targetCandidateId,
        });
        if (next.status === 'ok') {
          onCollectionMayHaveChanged(next.summary);
          return;
        }
      }
      // Agotados los intentos sin una lectura buena: se avisa con `null` para que el drawer
      // recargue por su cuenta en vez de quedarse con un conteo que quizá ya no es cierto.
      onCollectionMayHaveChanged(null);
    },
    [candidateId, onCollectionMayHaveChanged],
  );

  /**
   * LA compra. Es la ÚNICA función de este archivo que puede gastar un crédito, y sólo la
   * invoca el botón de confirmación del modal.
   */
  const handleConfirm = React.useCallback(async () => {
    // Doble submit: el segundo sale aquí, ANTES de la acción. Junto con la clave de
    // idempotencia de la autorización, el índice único de corrida activa y el claim atómico
    // del servidor, son cuatro barreras y ninguna sola es la única.
    if (inFlight.current) return;
    inFlight.current = true;

    setConfirmOpen(false);
    setState({ kind: 'running' });

    try {
      const result = await searchMoreCandidatePhonesAction({ candidateId });
      const settled = resolveSettledMessage(result);
      setState({ kind: 'settled', message: settled.message });

      if (settled.tone === 'success') {
        toast.success(settled.message);
      } else if (settled.tone === 'error') {
        toast.error(settled.message);
      } else {
        toast.info(settled.message);
      }

      // Se refresca SIEMPRE, no sólo en éxito. Una corrida que terminó sin números nuevos
      // igualmente pudo añadir procedencia a un número existente, y una que falló pudo
      // hacerlo antes de fallar: el conteo del drawer tiene que describir la base, no el
      // desenlace que se le contó al operador.
      await refreshPreflight(candidateId);
    } catch (err) {
      // Un fallo de transporte NO se presenta como «no encontramos números»: no se sabe qué
      // pasó del otro lado, y el refresco de abajo es el que lo averigua.
      console.error(
        '[search-more-phones] action failed:',
        err instanceof Error ? err.message : 'unknown error',
      );
      setState({ kind: 'settled', message: SEARCH_MORE_PROVIDER_ERROR_COPY });
      toast.error(SEARCH_MORE_PROVIDER_ERROR_COPY);
      await refreshPreflight(candidateId);
    } finally {
      inFlight.current = false;
    }
  }, [candidateId, refreshPreflight]);

  // ── Qué se renderiza ─────────────────────────────────────────

  // Mientras la compra está en vuelo se muestra el estado, SIEMPRE, incluso si el resumen
  // recién leído ya dice que la operación se agotó. Ocultar el estado en el instante en que
  // el plan cambia dejaría al operador sin ver qué pasó con el crédito que autorizó.
  if (state.kind === 'running') {
    return (
      <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {SEARCH_MORE_RUNNING_LABEL}
      </p>
    );
  }

  if (state.kind === 'settled') {
    return (
      <p className="text-[11px] text-muted-foreground" role="status">
        {state.message}
      </p>
    );
  }

  // Sin resumen no se pinta nada. No se adivina la elegibilidad de una compra.
  if (!summary) return null;

  const { plan } = summary;

  if (!plan.eligible) {
    // `null` = NO RENDERIZAR, que es la lección de #287: «deshabilitado» no puede ser mostrar
    // una función que no existe. El copy sólo aparece para bloqueos que el operador puede
    // entender y que describen algo real sobre ESTE candidato.
    const blockedCopy = plan.reason ? getSearchMoreDisabledCopy(plan.reason) : null;
    if (!blockedCopy) return null;
    return <p className="text-[11px] text-muted-foreground">{blockedCopy}</p>;
  }

  const providerLine = getSearchMoreProviderLine(plan.providersToTry);
  const creditsLine = getSearchMoreMaxCreditsLine(plan.maxCreditRequirement);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => setConfirmOpen(true)}
        className="h-auto gap-1.5 px-0 text-[11px] font-medium text-su-brand hover:bg-transparent hover:underline"
      >
        <Search className="h-3 w-3" />
        {SEARCH_MORE_CTA_LABEL}
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{SEARCH_MORE_CONFIRM_TITLE}</DialogTitle>
            <DialogDescription>{SEARCH_MORE_CONFIRM_BODY}</DialogDescription>
          </DialogHeader>

          {/* El proveedor y el techo, cada uno en su línea y con su etiqueta. Van como
              datos y no dentro de un párrafo porque son lo que el operador ACEPTA: qué
              fuente se consulta y hasta cuánto puede costar. */}
          <dl className="space-y-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 text-xs">
            {providerLine && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">Proveedor</dt>
                <dd className="font-medium text-foreground">Lusha</dd>
              </div>
            )}
            {creditsLine && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">Costo máximo autorizado</dt>
                <dd className="font-medium text-foreground">
                  {plan.maxCreditRequirement} créditos
                </dd>
              </div>
            )}
          </dl>

          {/* La frase que separa «autorizar una búsqueda» de «comprar un resultado». El
              desenlace más probable de esta operación es que Lusha devuelva los números que
              ya están guardados, y en ese caso se cobra igual. */}
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {SEARCH_MORE_CONFIRM_COST_WARNING}
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              {SEARCH_MORE_CONFIRM_CANCEL_LABEL}
            </Button>
            <Button type="button" onClick={handleConfirm}>
              {SEARCH_MORE_CONFIRM_ACCEPT_LABEL}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
