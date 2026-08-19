'use client';

// «Buscar más números» — el CTA PAGADO
// (AGENT2A-SEARCH-MORE-PHONES-1 · acción DIRECTA desde 1J)
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ ES UN COMPONENTE PROPIO Y NO CÓDIGO EN EL DRAWER
// ═══════════════════════════════════════════════════════════════════
//
// Dos razones, y la segunda es la que importa:
//
//   1. `contact-candidate-detail-sheet.tsx` pasa de 3 000 líneas. Añadirle una máquina de
//      estados y un refresco acotado lo haría ilegible justo en el archivo que ya cuesta
//      revisar;
//   2. este componente se puede probar SOLO. Las garantías que hay que demostrar —un clic
//      produce UNA compra, el teléfono actual sigue visible mientras se busca, el refresco no
//      gasta— son afirmaciones sobre ESTE árbol, y montarlo aislado las hace verificables sin
//      construir un candidato entero.
//
// ═══════════════════════════════════════════════════════════════════
// 1J — UN CLIC EJECUTA, Y POR ESO EL COSTO SE LEE ANTES
// ═══════════════════════════════════════════════════════════════════
//
// La versión anterior abría un modal y sólo su botón de confirmación gastaba. 1J RETIRA ese
// modal por decisión de producto: el drawer del candidato ya es una superficie inmersiva, y
// apilarle un diálogo encima rompía el flujo para pedir una autorización que el operador
// acababa de dar al pulsar.
//
// Retirar la confirmación NO relaja nada del servidor, y ésa es la frontera que este archivo
// respeta: el flag de producto, la autorización del actor, la elegibilidad, la identidad
// nativa de Lusha, el preflight y la RE-comprobación de privacidad, la reserva, el techo de
// 5 créditos, el claim atómico, la única llamada, el registro de uso y la liquidación siguen
// TODOS del otro lado. Este componente no decide nada de eso; sólo deja de preguntar dos
// veces.
//
// Lo que sí se traslada aquí es la DIVULGACIÓN. Lo que antes el operador aceptaba dentro del
// diálogo ahora tiene que estar leído antes del clic, así que la línea de costo vive debajo
// del botón de forma permanente y NO es opcional: si `getSearchMoreCostDisclosure` no puede
// afirmar la fuente y el techo, el botón NO SE RENDERIZA. Un botón que gasta sin divulgar el
// gasto sería estrictamente peor que el modal que 1J retira.
//
// El botón es el SECUNDARIO canónico del producto —`variant="outline" size="sm"` con
// `h-7 gap-1.5 text-xs`—, el mismo de «Revelar teléfono», «Revisar resultado ahora» y el
// fallback manual de Lusha, que viven a centímetros en este mismo panel. Antes era un
// `variant="ghost"` con `px-0` y `hover:underline`, es decir un enlace de texto pegado a los
// badges del teléfono: la operación más cara del bloque tenía el peso visual más bajo.
//
// ═══════════════════════════════════════════════════════════════════
// MIENTRAS BUSCA, EL TELÉFONO SIGUE VISIBLE
// ═══════════════════════════════════════════════════════════════════
//
// Este componente NO renderiza el teléfono: lo renderiza el drawer, justo encima, y se queda
// donde está. Aquí sólo cambia el propio botón, que pasa a spinner y queda deshabilitado.
// Sustituir el número por un esqueleto mientras se busca un ADICIONAL sería esconder un dato
// que el operador ya tiene y ya pagó — y si la búsqueda falla, lo habría escondido para nada.
//
// Tampoco hay overlay ni segunda hoja: el resto del drawer sigue legible durante la corrida.
//
// ═══════════════════════════════════════════════════════════════════
// EL REFRESCO NO GASTA
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
  getSearchMorePhonesPreflightAction,
  searchMoreCandidatePhonesAction,
} from '@/modules/contact-enrichment/search-more-phones-actions';
import type { SearchMorePreflightSummary } from '@/modules/contact-enrichment/search-more-phones-read';
import {
  getSearchMoreCostDisclosure,
  getSearchMoreDisabledCopy,
  getSearchMoreSuccessCopy,
  SEARCH_MORE_COST_HONESTY_COPY,
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
  | {
      readonly kind: 'settled';
      readonly message: string;
      readonly tone: SettledTone;
    };

type SettledTone = 'success' | 'neutral' | 'error';

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
): { readonly message: string; readonly tone: SettledTone } {
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
  const [state, setState] = React.useState<RunState>({ kind: 'idle' });

  // PESTILLO de solicitud, con la forma de #300. `useRef` y no estado porque tiene que ser
  // legible SINCRÓNICAMENTE dentro del handler: un segundo clic llega antes de que React
  // haya re-renderizado con `running`, así que un booleano de estado no lo pararía.
  //
  // Desde 1J es la PRIMERA barrera del cliente, no la segunda: sin modal, el botón es lo
  // único que hay entre dos clics rápidos y dos compras.
  const inFlight = React.useRef(false);

  // Cambiar de candidato invalida todo. Se ajusta durante el render —el mismo patrón que el
  // drawer usa para adaptar estado a una prop— para que el resultado del candidato anterior
  // no se pinte ni un frame sobre el nuevo.
  //
  // El PESTILLO deliberadamente NO se toca aquí, y no es un olvido:
  //
  //   * un ref no puede mutarse durante el render (React no garantiza cuántas veces corre, y
  //     el linter lo prohíbe con razón);
  //   * pero además no hace falta. El `finally` de `handleSearchMore` lo libera SIEMPRE, así
  //     que no existe el camino en que se quede trabado;
  //   * y dejarlo puesto es la dirección CONSERVADORA: si hay una compra en vuelo para el
  //     candidato A y el operador salta a B, el pestillo sigue cerrado hasta que A liquide, así
  //     que un clic apresurado en B no abre una segunda operación pagada. Limpiarlo aquí
  //     compraría un clic más rápido a cambio de una autorización de más.
  const [ownerId, setOwnerId] = React.useState(candidateId);
  if (ownerId !== candidateId) {
    setOwnerId(candidateId);
    setState({ kind: 'idle' });
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
   * LA compra. Es la ÚNICA función de este archivo que puede gastar un crédito, y desde 1J la
   * invoca el `onClick` del botón: un clic, una corrida.
   *
   * Que la haya UN solo sitio de llamada es lo que hace verificable la propiedad. No hay un
   * segundo camino —ni un efecto, ni un reintento automático— capaz de gastar.
   */
  const handleSearchMore = React.useCallback(async () => {
    // Doble clic: el segundo sale aquí, ANTES de la acción. Junto con la clave de
    // idempotencia de la autorización, el índice único de corrida activa y el claim atómico
    // del servidor, son cuatro barreras y ninguna sola es la única.
    if (inFlight.current) return;
    inFlight.current = true;

    setState({ kind: 'running' });

    try {
      const result = await searchMoreCandidatePhonesAction({ candidateId });
      const settled = resolveSettledMessage(result);
      setState({ kind: 'settled', message: settled.message, tone: settled.tone });

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
      setState({
        kind: 'settled',
        message: SEARCH_MORE_PROVIDER_ERROR_COPY,
        tone: 'error',
      });
      toast.error(SEARCH_MORE_PROVIDER_ERROR_COPY);
      await refreshPreflight(candidateId);
    } finally {
      inFlight.current = false;
    }
  }, [candidateId, refreshPreflight]);

  // ── Qué se renderiza ─────────────────────────────────────────

  // Mientras la compra está en vuelo se muestra el BOTÓN en estado de carga, no una línea de
  // texto que lo reemplace: el operador tiene que seguir viendo dónde estaba la acción que
  // acaba de disparar, y un botón deshabilitado con spinner dice a la vez «va en camino» y
  // «no lo pulses otra vez». Se muestra SIEMPRE, incluso si el resumen recién leído ya dice
  // que la operación se agotó: ocultarlo en el instante en que el plan cambia dejaría al
  // operador sin ver qué pasó con el crédito que autorizó.
  if (state.kind === 'running') {
    return (
      <div className="space-y-1.5 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {SEARCH_MORE_RUNNING_LABEL}
        </Button>
      </div>
    );
  }

  // Estado TERMINAL. El botón desaparece a propósito: una corrida `search_more` agota Lusha
  // para este candidato, así que un segundo clic sería una compra que el planificador ya no
  // autoriza. Retirarlo aquí no depende de que el refresco del preflight llegue a tiempo.
  if (state.kind === 'settled') {
    return (
      <p
        className={
          state.tone === 'error'
            ? 'pt-1 text-[11px] text-destructive'
            : 'pt-1 text-[11px] text-muted-foreground'
        }
        role="status"
      >
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
    return <p className="pt-1 text-[11px] text-muted-foreground">{blockedCopy}</p>;
  }

  const costDisclosure = getSearchMoreCostDisclosure(
    plan.providersToTry,
    plan.maxCreditRequirement,
  );

  // FAIL-CLOSED sobre la divulgación, y es la guarda que 1J añade. Sin modal el clic ejecuta,
  // así que un botón cuya línea de costo no se puede escribir sería un gasto sin advertencia.
  // Un plan elegible siempre trae proveedor y techo, de modo que este camino describe un
  // estado imposible — y precisamente por eso la respuesta correcta es no pintar el botón,
  // nunca pintarlo sin la línea.
  if (!costDisclosure) return null;

  return (
    // El bloque propio es lo que separa la ACCIÓN de los datos del teléfono. El número, su
    // tipo y su procedencia viven en su propia fila, arriba; aquí abajo empieza otra cosa, y
    // el `pt-1` lo dice sin una regla ni un separador.
    <div className="space-y-1.5 pt-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        disabled={disabled}
        // Un clic = una compra (1J). El pestillo síncrono de `handleSearchMore` es lo que
        // impide que dos clics en el mismo tick abran dos corridas.
        onClick={() => void handleSearchMore()}
      >
        <Search className="h-3.5 w-3.5" />
        {SEARCH_MORE_CTA_LABEL}
      </Button>
      {/* La divulgación de costo, en texto secundario y en una sola línea. NO es un bloque de
          advertencia: el aviso amarillo pertenecía al modal, y una alarma permanente junto a
          un botón se vuelve invisible a la tercera vez que se ve. Dice qué fuente se consulta,
          hasta cuánto puede costar, y que puede cobrarse sin encontrar nada nuevo — que es el
          desenlace más probable. */}
      <p className="text-[11px] text-muted-foreground">
        {costDisclosure}. {SEARCH_MORE_COST_HONESTY_COPY}
      </p>
    </div>
  );
}
