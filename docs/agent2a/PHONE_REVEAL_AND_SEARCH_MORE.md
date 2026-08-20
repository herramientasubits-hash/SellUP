# Agente 2A — Phone Reveal, múltiples teléfonos y «Buscar más números»

> Los topes y vocabularios de este documento están **leídos del código**, no supuestos.
> Fuente: `phone-reveal-waterfall-core.ts`, `phone-reveal-credit-budget-core.ts`,
> `search-more-phones-planner.ts`, `search-more-phones-core.ts`,
> `search-more-phones-runtime.ts`, `phone-collection-core.ts`.

---

## 1. Las tres operaciones de teléfono, y por qué son tres

SellUp tiene exactamente **tres** operaciones de teléfono. Confundirlas es el error más caro
posible en este subsistema, porque dos cuestan dinero y una no.

| Operación | Nombre UX | Precondición | Proveedores | Créditos |
|---|---|---|---|---|
| Reveal inicial | «Revelar teléfono» | el candidato **NO** tiene teléfono | Apollo → Lusha | hasta **13** |
| Ver almacenados | «Ver más números» | hay números guardados | **ninguno** | **0** |
| Búsqueda adicional | «Buscar más números» | el candidato **SÍ** tiene teléfono | **sólo Lusha** | hasta **5** |

---

## 2. Reveal inicial — el waterfall Apollo → Lusha

### 2.1 Qué autoriza un clic

**UN** clic del operador en «Revelar teléfono» autoriza **hasta dos patas de proveedor**:
Apollo primero y, sólo si Apollo terminó como `no_phone_found`, Lusha automáticamente por
debajo — sin segundo clic y sin segundo modal. Toda la autorización vive en **una** fila de
`phone_reveal_waterfall_runs`, para que ambas patas queden atribuibles y costeadas por separado.

### 2.2 Cuándo corre Apollo

Siempre que la modalidad sea `full_waterfall` y el preflight de presupuesto autorice la pata de
Apollo. En la modalidad `legacy_lusha_only` Apollo **no corre**: 0 llamadas, 0 usage logs de
Apollo, 0 timestamps inventados. `apollo_attempted_at` queda `null`, y la modalidad es
precisamente lo que explica por qué.

### 2.3 Cuándo puede correr Lusha

La pata de Lusha exige **todo** lo siguiente, y cualquier fallo la deja fuera:

1. `ENABLE_PHONE_REVEAL_WATERFALL` = `"true"` **y** `ENABLE_LUSHA_PHONE_REVEAL_FALLBACK` = `"true"`.
   Los dos. Con el flag del fallback apagado la pata es `feature_disabled` diga lo que diga el
   otro.
2. Rol `admin`. `commercial_manager` conserva el flujo Apollo-only y **nunca** obtiene una fila
   de corrida, así que la pata de Lusha le es estructuralmente inalcanzable.
3. **Identidad nativa de Lusha:** la fila del candidato declara `source = 'lusha'` **y**
   `source_contact_id`. No se busca por nombre, email, empresa ni LinkedIn.
4. Apollo terminó exactamente en `no_phone_found`.
5. La autorización no ha expirado (**TTL de 24 h**). Un webhook que llega dos días después
   todavía puede cerrar la pata de Apollo, pero **nunca** puede gastar la segunda pata sobre
   una autorización rancia.
6. El presupuesto de Lusha respalda 5 créditos **por separado** del de Apollo.
7. La re-comprobación de supresión/DNC inmediatamente anterior a la llamada da `clear`.

### 2.4 Topes reales vigentes

```ts
// phone-reveal-waterfall-core.ts
PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS      = 8
PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS       = 5
PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA  = 13   // 8 + 5
PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS      = 5    // = LUSHA_MAX
// search-more-phones-planner.ts
SEARCH_MORE_MAX_CREDITS                        = 5    // = LEGACY_REQUIRED_CREDITS
```

`13` **nunca** significa «algún saldo ≥ 13». El presupuesto es por proveedor: un waterfall
completo exige **Apollo ≥ 8 Y Lusha ≥ 5 por separado**. La versión anterior combinaba los
saldos con un mínimo genérico y lo comparaba contra 13; eso era incorrecto en las dos
direcciones y ese helper se **eliminó**.

### 2.5 Modalidades

| `run_mode` | Cuándo | Tope | Apollo |
|---|---|---|---|
| `full_waterfall` | flujo normal | 13 (u 8 si no hay pata Lusha alcanzable) | corre |
| `legacy_lusha_only` | el intento Apollo ya ocurrió y terminó `no_phone_found` **antes** de que existiera la tabla | 5 | **no** corre |
| `search_more` | «Buscar más números» | 5 | **no** corre |

La ruta legacy **no** es un atajo para saltarse Apollo: exige evidencia **persistida** del
desenlace histórico, leída de columnas canónicas del candidato — nunca de un texto de UI ni de
un contador de intentos — y se cierra en cuanto el candidato pertenece al flujo completo.

### 2.6 Secuencia de una pata

Para cada pata, el orden es siempre el mismo y es barato→caro:

```
identidad requerida  →  presupuesto del proveedor  →  reserva atómica
  →  privacidad (fail-closed)  →  claim atómico  →  llamada al proveedor
  →  usage log  →  persistencia transaccional  →  estado terminal
```

**Nada que cueste dinero ocurre antes de que exista una reserva.** Si la corrida no se puede
crear —excepción, o `23505` del índice único parcial— la reserva se **libera**, así que un
conflicto benigno no deja créditos bloqueados.

---

## 3. Múltiples teléfonos

### 3.1 El problema que resolvió la migración 109

La auditoría 4O-A estableció cuatro hechos: Apollo puede devolver **varios** teléfonos para una
persona; Lusha también; SellUp reducía esos N números a exactamente 1 antes de persistir; y las
entradas adicionales se descartaban en el normalizador y nunca llegaban a la base. Un segundo
número **que el operador ya había pagado** se perdía en el momento de escribir, y recuperarlo
significaba pagar el mismo reveal otra vez.

### 3.2 Normalización, dedupe y principal

* **Normalización:** `normalized_phone` (forma canónica para comparar) + `display_phone` (lo que
  ve el operador).
* **Dedupe:** `dedupe_key`, único por candidato. Dos observaciones del mismo número no crean dos
  filas: crean una fila y **dos procedencias**.
* **Elección del principal** (`phone-collection-core.ts`), en este orden:
  1. **Ranking de tipo** — `CANDIDATE_PHONE_TYPE_RANKING`:
     `personal_mobile` → `mobile` → `direct_dial` → `work` → `hq` → `other` → `unknown`
  2. **Estado** del teléfono.
  3. **Desempate por especificidad de procedencia** — `SOURCE_SPECIFICITY_RANKING`:
     `apollo:reveal` → `lusha:reveal` → `apollo_cache:cache` → `apollo:search`.
     Un reveal pagado es la observación más específica; una lectura de caché es un reveal viejo
     reutilizado; el tipo que viene gratis en el search es el más débil.

### 3.3 Procedencia por teléfono

Cada fila de `*_phone_sources` responde, para **un** número:

| Campo | Responde |
|---|---|
| `provider` | quién lo trajo (`apollo` \| `lusha` \| `apollo_cache` \| …) |
| `acquisition_mode` | cómo (`reveal` \| `cache` \| `search` \| `manual`) |
| `raw_provider_type` / `raw_provider_status` | qué dijo el proveedor, **crudo** |
| `waterfall_run_id` | bajo qué autorización |
| `reservation_id` | contra qué reserva |
| `provider_usage_log_id` | qué fila del ledger de gasto lo pagó |
| `source_event_key` | qué observación concreta fue (p. ej. `start` vs `webhook` de Apollo) |

### 3.4 «Ver más números» — READ-ONLY, sin excepción

Un clic produce, de forma **verificable**:

```
0 llamadas a Apollo · 0 llamadas a Lusha · 0 corridas de reveal
0 reservas de crédito · 0 usage logs · 0 créditos
0 escrituras en el candidato · 0 escrituras en el contacto
```

Esto no es una promesa del comentario. `candidate-stored-phones-actions.ts` **no importa** el
cliente de Apollo, ni el de Lusha, ni el motor del waterfall, ni el reservador de créditos, ni
el logger de uso — y un **test estático falla** si alguna de esas importaciones aparece. La
cadena entera (acción → lectura → núcleo) sólo hace `SELECT`.

Dos decisiones que conviene entender:

* **No consulta los flags de proveedor a propósito.** Un número que la operación ya pagó y ya
  guardó no puede volverse invisible porque el proveedor que lo trajo esté hoy apagado. La
  disponibilidad operativa de un proveedor y la visibilidad de un dato almacenado son cosas
  distintas; atarlas escondería datos por los que ya se pagó.
* **Los números viajan sólo cuando se piden.** El resumen devuelve **un entero** y ningún
  número; la lista completa sólo se construye cuando el operador abre el disclosure.

Existe la operación equivalente para el contacto **oficial** (PR #278,
`official-contact-stored-phones-actions.ts`) con el mismo contrato.

---

## 4. «Buscar más números» — Search More

**Nombre UX:** «Buscar más números». **`run_mode`:** `search_more`. **Migración:** 122.
**Flag:** `ENABLE_SEARCH_MORE_PHONES`.

### 4.1 Por qué es LUSHA-ONLY, y por qué eso NO es un recorte de alcance

Ésta es la decisión arquitectónica central de la operación, y no es prudencia: es que **la
operación simétrica no existe**.

* **Apollo devuelve su colección completa.** El payload terminal de Apollo trae *todos* los
  teléfonos que Apollo tiene —en hasta tres ubicaciones— y desde 4O-C
  `apollo-phone-collection-capture.ts` los persiste **todos**. Apollo no expone ninguna
  operación de «más teléfonos» ni pagina su respuesta. **Repetir Apollo cobraría otra vez por
  el payload que ya está guardado.**
* **Lusha también devuelve la suya completa.** `/v3/contacts/enrich` con `reveal: ['phones']`
  devuelve `results[0].phones[]` entero, y desde 4O-D se lee el array completo.

Lo que esta operación compra, entonces, **no es «pedir más al mismo proveedor»**: es consultar
al **otro** proveedor cuya identidad nativa el candidato ya lleva. En la práctica el candidato
que llega aquí fue revelado por Apollo (Apollo es la primera pata del waterfall), así que el
proveedor que falta es **siempre** Lusha.

Un conjunto de proveedores de dos elementos describiría una pata de Apollo que **ninguna rama
puede ejecutar**, y un techo de crédito para Apollo autorizaría un gasto que nadie puede cobrar.
Por eso `SEARCH_MORE_PROVIDERS` es un conjunto cerrado de un elemento y el mapa de topes es
exhaustivo sobre ese tipo: añadir `apollo` **rompe la compilación** en vez de autorizarse solo.

### 4.2 Las cuatro reglas que no se negocian

1. **Lusha no se llama dos veces.** Si su procedencia ya está en la colección, ya contestó y su
   respuesta completa está guardada. Si ya se le consultó por adicionales en una corrida
   `search_more` **terminal**, está agotada — y lo está para **cualquier** desenlace, incluido el
   error. **No hay reintento pagado automático.**
2. **Sólo la identidad nativa que el candidato ya lleva.** `source = 'lusha'` +
   `source_contact_id`, la MISMA condición que `resolveLushaContactId`. No se busca por nombre +
   empresa, ni por email, ni por LinkedIn; **no hay enlace difuso**; no se cruzan identidades
   entre proveedores; y **no existe ninguna ruta a la búsqueda general de personas de Lusha**.
3. **Fail-closed.** Cualquier duda devuelve NO elegible. Un dato ausente, un estado ilegible,
   una supresión no evaluable: todos bloquean.
4. **El presupuesto es un hecho más** (desde 1K / PR #309). El veredicto del pozo de Lusha entra
   en el planificador con el **tipo canónico** del core de crédito y bloquea igual que los demás.

### 4.3 Vocabulario del planificador

**Fases** (`SearchMorePhase`) — lo que la UI necesita para pintar el CTA correcto:

`no_phone_yet` · `has_phone_provider_available` · `has_phone_no_provider_available` ·
`search_more_already_running` · `providers_exhausted` · `privacy_blocked` · `budget_blocked`

> `budget_blocked` es una fase **propia** y no `has_phone_no_provider_available`, porque no dice
> nada del candidato: la fuente sigue ahí y la identidad también; lo que falta es saldo,
> configuración, o la lectura misma del presupuesto. Colapsarlas le diría al operador que el
> contacto está agotado cuando lo que ocurre es que la plataforma no puede pagar.

**Motivos de inelegibilidad** (`SearchMoreIneligibleReason`):

`feature_disabled` · `role_not_allowed` · `invalid_candidate` · `candidate_not_editable` ·
`no_stored_phone` · `no_additional_provider` · `providers_exhausted` · `active_run_exists` ·
`blocked_suppressed` · `do_not_contact` · `suppression_check_unavailable` ·
`missing_person_identity` · `insufficient_credits` · `budget_not_configured` ·
`credit_balance_unavailable`

Los tres últimos son **exactamente** los códigos que el gate de reserva del runtime ya devolvía.
No se inventó un vocabulario paralelo: cuando el runtime bloquea, su motivo viaja como
`not_started(reason)` y la UI lo traduce con el **mismo** mapa de copy. Códigos distintos a cada
lado obligarían a mantener dos traducciones del mismo bloqueo, y la que se olvidara caería en el
genérico «No pudimos iniciar la búsqueda» — que es exactamente el síntoma que #309 eliminó.

### 4.4 La secuencia del runtime, y las tres barreras de idempotencia

Fuente normativa: cabecera de `search-more-phones-runtime.ts`.

1. **PLAN sobre estado RECARGADO** (`readSearchMorePreflight`). El plan que el navegador mostró
   **no se acepta**: se vuelve a derivar de los hechos de la base.
2. **PRESUPUESTO + RESERVA + CORRIDA en UNA transacción**
   (`reserve_and_create_phone_reveal_run`, mig 104). Sin exposición reservada no hay corrida, y
   sin corrida no hay llamada, ni usage log, ni créditos.
3. **PRIVACIDAD, otra vez** (`checkPhoneRevealPrivacyGate`). Ya se resolvió en el paso 1; se
   vuelve a resolver **después** de crear la corrida porque entre el preflight y este instante
   pueden haber pasado minutos y **una DSAR registrada en ese hueco tiene que ganar**. Si
   bloquea: 0 llamadas, y la corrida se cierra terminal con el motivo exacto en
   `lusha_skipped_reason`.
4. **CREDENCIAL del proveedor — y antes del claim, a propósito.** Leerla no es una llamada y no
   cuesta un crédito. Resolverla *después* del claim sellaba `lusha_attempted_at` con **cero**
   llamadas, y la liquidación —que no puede saber desde la fila que la llamada no salió—
   confirmaba el **tope**. Resuelta antes, la ausencia cierra con la pata no intentada y la
   reserva se libera sola.
5. **CLAIM ATÓMICO** (`claimLushaAttempt`): un `UPDATE` condicional sobre
   `lusha_attempted_at IS NULL`.
6. **UNA llamada a Lusha**, por id nativo. **Sin retry.**
7. **USAGE LOG.** Se escribe **siempre** que Lusha se llamó, **antes** de intentar persistir, y
   **fuera** de la transacción de la 122 — precisamente para sobrevivir a un fallo de ésta.
   Devuelve su id, que es lo que correlaciona el ledger con la procedencia de lo que se compró.
8. **APPEND** (`append_candidate_search_more_phones`, mig 122). Re-comprueba la supresión por
   **persona** bajo el lock: si bloquea ahí, el número se retiene y **el costo se conserva
   entero**.
9. **CIERRE** con el patch del clasificador puro, que dispara la liquidación de la reserva por el
   mismo camino que el resto del subsistema.

**Las tres barreras de idempotencia** (y no se añade un cuarto sistema):

| Barrera | Qué impide |
|---|---|
| `authorization_key` | Una respuesta perdida tras el COMMIT devuelve `already_created`, no una segunda autorización |
| Índice único parcial de corrida activa (mig 102) | Vive **dentro** de la transacción, así que la segunda invocación se rechaza **antes** de pagar. Se traduce a `active_run_exists`, y esa rama **no libera nada**: la exposición que encontró pertenece a la corrida que ganó |
| Claim atómico sobre `lusha_attempted_at` | El segundo actualiza 0 filas y sale sin llamar a nadie |

### 4.5 Desenlaces

**Lo que contestó el proveedor** (`SearchMoreProviderCallOutcome`):
`revealed` (devolvió ≥ 1 número) · `no_phone_found` · `error`.

**Lo que dijo la escritura** (`SearchMorePersistStatus`, de la RPC 122):
`persisted` · `no_incoming_phones` · `suppressed` · `candidate_not_eligible` · `invalid_input` ·
`unavailable`.

**Lo que se le dice al operador** (`SearchMoreOutcome.result`):
`new_phones_found` · `no_new_phones` · `privacy_blocked` · `provider_error`.

Dos distinciones que el clasificador protege deliberadamente:

* **`no_phone_found` ≠ `no_new_distinct_phone`.** La primera afirma que el proveedor no tiene
  teléfono para esa persona; la segunda, que lo tiene y ya lo teníamos. No es formato: es lo que
  se afirma en el ledger.
* **`error` ≠ `no_phone_found`.** Un fallo de red no es evidencia de que el proveedor no tenga
  teléfono. Registrarlo como tal cerraría la puerta a un reintento legítimo y mentiría sobre lo
  que se sabe de esa persona.

**La corrida se cierra siempre.** Una corrida `search_more` que quedara viva bloquearía la
siguiente por el índice único parcial, así que dejarla abierta ante un desenlace inesperado
convertiría un fallo transitorio en una **inhabilitación permanente del botón**.

### 4.6 Lo que Search More NO hace, nunca

* No llama a Apollo, ni escribe un usage log de Apollo, ni inventa `apollo_attempted_at`.
* No usa la búsqueda **general** de personas de Lusha.
* No reescribe `phone_reveal_provider` / `…_requested_at` / `…_completed_at` /
  `…_cost_credits` / `…_cost_source` ni el historial del reveal: esas columnas describen la
  autorización **inicial**, y la 122 no las toca en ninguna rama.
* No aprueba el candidato, no escribe en el contacto oficial, no escribe en HubSpot.
* No actúa en lote: la entrada es escalar, así que no hay forma de pedir un batch.
* No reintenta la llamada al proveedor.
