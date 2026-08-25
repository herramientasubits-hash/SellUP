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
2. Un rol autorizado para **revelar teléfono**: `admin` **o** `commercial_manager`
   (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1). El waterfall dejó de tener lista de roles
   propia: reutiliza `PHONE_REVEAL_AUTHORIZED_ROLE_KEYS`, y lo que enciende o apaga el flujo es
   el flag, no el rol. Un rol que **no** puede revelar (`seller`, `seller_bd`, `lead`, actor sin
   rol) **nunca** obtiene una fila de corrida, así que la pata de Lusha le es estructuralmente
   inalcanzable.
3. **Identidad de Lusha alcanzable**, por una de estas dos vías:
   * **nativa** — la fila del candidato declara `source = 'lusha'` **y** `source_contact_id`, o
     ya existe una identidad `lusha` persistida en `contact_provider_identities` (migración
     124). Aquí no se paga por saber quién es: el tope es **13**;
   * **comprada** — el candidato nació en Apollo y hay un identificador exacto con el que
     buscarlo (LinkedIn, email, o nombre + empresa/dominio). Entonces la autorización incluye
     **1 crédito** de Contact Search además de los 5 del teléfono, y el tope es **14**. El
     desglose que ve el operador nombra las dos operaciones por separado.

   Sin ninguna de las dos vías la pata no existe y el tope vuelve a ser **8**. El copy del botón
   y la reserva salen de la MISMA función pura
   (`buildPhoneRevealWaterfallAuthorizationPreview`), así que no pueden discrepar.

   **El tope que el operador vio es un límite superior DURO**
   (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1-R2). Compartir la función no basta: la vista
   previa se resuelve ANTES del clic y puede fallar —la UI cae entonces, bien, a su suelo
   conservador de 8— o quedarse vieja. Por eso el clic envía `expectedMaxCredits` y el arranque
   lo compara contra la modalidad real **después** de resolverla y **antes** del preflight de
   presupuesto y de `reserve_and_create_phone_reveal_run`:

   * `aceptado >= requerido` ⇒ sigue, y lo que se **reserva es lo REQUERIDO**, no lo aceptado
     (aceptar 14 sobre una modalidad de 13 registra 13);
   * `aceptado < requerido` ⇒ `authorization_ceiling_mismatch`: 0 consultas de pozo, 0 reservas,
     0 corridas, 0 Apollo, 0 Lusha, 0 usage-logs, 0 créditos. **No** se sube el tope en silencio,
     **no** se degrada a Apollo-only y **no** hay reintento automático. La UI recarga su vista
     previa, muestra «la autorización cambió» y el siguiente clic es de la persona;
   * `expectedMaxCredits` ausente o no finito ⇒ se asume el suelo de **8**, jamás la modalidad
     requerida: un cliente que no manda el tope no puede acabar autorizando el más caro.

   Reservar y liberar después **no** es equivalente: sigue siendo exposición que nadie autorizó.
4. Apollo terminó exactamente en `no_phone_found`.
5. La autorización no ha expirado (**TTL de 24 h**). Un webhook que llega dos días después
   todavía puede cerrar la pata de Apollo, pero **nunca** puede gastar la segunda pata sobre
   una autorización rancia.
6. El presupuesto de Lusha respalda 5 créditos **por separado** del de Apollo.
7. La re-comprobación de supresión/DNC inmediatamente anterior a la llamada da `clear`.

### 2.4 Topes reales vigentes

```ts
// phone-reveal-waterfall-core.ts
PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS               = 8
PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS                = 5
PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS = 1   // Contact Search
PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA           = 13  // 8 + 5
PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH = 14  // 13 + 1
PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS               = 5   // = LUSHA_MAX
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

---

## 5. Revelar teléfono desde el CONTACTO OFICIAL (post-aprobación)

**Hito:** `AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1`
**Migración:** 128 · `project_approved_candidate_phones_onto_contact`

### 5.1 El hueco, dicho como un hecho del esquema

La promoción de teléfonos del candidato al contacto existía en **dos** sitios, y los dos son
eventos de un veredicto de revisión:

* **116** `approve_contact_candidate_with_phones` — corre DENTRO de la aprobación y devuelve
  `already_approved` con **cero escrituras** para un candidato que ya está `approved`;
* **117** `merge_contact_candidate_into_existing_contact` — rechaza todo candidato que no sea
  `duplicate`, y todo `p_contact_id` que no sea el `matched_contacts_id` que el servidor grabó.

Y las funciones que persisten un reveal —**110**, **111**, **122**— no nombran `contacts` ni la
colección oficial en absoluto: escriben la colección del **candidato** y ahí se detienen.

Consecuencia: un teléfono conseguido **después** de aprobar no tenía **ninguna sentencia en la
base** que lo llevara a la ficha. Y el botón para pedirlo tampoco existía, porque todo el pipeline
es alcanzable sólo desde la revisión del candidato, que ya terminó.

Ése es el caso Priscilla Domínguez: candidato `approved`, contacto creado a partir de él,
`contacts.phone` NULL, `contact_phones` vacía, `hubspot_contact_id` NULL. Ficha sin teléfono y sin
forma de pedirlo.

### 5.2 Lo que el hito NO construye

**No hay un segundo waterfall.** La ficha del contacto oficial resuelve el candidato fuente y
**delega**:

| Necesidad | A quién se le pide |
|---|---|
| Tope de créditos antes del clic | `getPhoneRevealWaterfallAuthorizationPreviewAction(candidateId)` |
| El arranque de un clic | `revealCandidatePhoneAction({ candidateId, … })` |

Con eso vienen —sin una segunda implementación que pueda divergir— la identidad de proveedor, la
supresión y el DNC, el presupuesto y las reservas, el techo de autorización, el waterfall
Apollo → Lusha, el «no pagar dos veces», la colección del candidato con su procedencia, el ranking
y los usage logs. El tope que se muestra sale de la **misma** función que reserva, así que la ficha
no puede prometer 8 donde el servidor va a reservar 14.

### 5.3 El vínculo es durable, y su ausencia es fail-closed

El candidato fuente se resuelve **sólo** desde `contacts.metadata.source_candidate_id` —la clave
que la aprobación ya escribe y que el camino DSAR ya usa—. Sin ella no se ofrece nada y no se
gasta nada.

No se busca un candidato «parecido» por email, nombre o teléfono, y eso no es pedantería: el
candidato fuente es lo que determina la **autorización económica** (qué proveedores quedan, si la
identidad Lusha ya está comprada, cuánto se reserva). Un candidato parecido puede tener otro
origen, otro historial de reveal y otra identidad persistida: autorizar un gasto contra él sería
cobrarle al operador un tope calculado sobre **otra persona**.

### 5.4 Las respuestas de la ficha

| Estado | Qué se ofrece | Coste |
|---|---|---|
| `eligible` | «Revelar teléfono», con el tope del servidor | hasta 8 / 13 / 14 créditos |
| `reuse_from_candidate` | «Usar teléfono ya obtenido» | **0** — se proyecta lo ya pagado |
| `phone_already_present` | nada; se explica y se apunta a la revisión del candidato | 0 |
| `missing_source_candidate` · `contact_archived` · `contact_unavailable` | nada | 0 |
| `projection_capability_unavailable` | nada; la RPC de la 128 no está disponible todavía | 0 |

`reuse_from_candidate` sólo se ofrece cuando el contacto no tiene **ni** escalar **ni** colección
viva: con colección viva no se puede afirmar desde la UI que falte algo —habría que comparar
`dedupe_key` uno a uno, y esa comparación es de la RPC, bajo el lock, con
`ON CONFLICT DO NOTHING`—.

### 5.5 La proyección (migración 128)

Additive e idempotente. Sin tablas, columnas, índices, triggers ni policies nuevas; la 128
únicamente crea o reemplaza una función y sus permisos —`CREATE OR REPLACE FUNCTION` sí es un
cambio de esquema, así que no se describe como «sin DDL»—. Lo que **hace**: bloquea el candidato,
revalida que sigue `approved` y que sigue apuntando a **este** contacto, re-comprueba la
supresión **por persona** bajo ese lock (clave y helpers de la 113), bloquea el contacto, promueve
la colección viva con toda su procedencia (`v1:promoted:` — el mismo namespace de la 116, por lo
que re-proyectar colapsa sobre las mismas filas), elige principal **sólo si el contacto no
tenía**, y proyecta el escalar heredado **sólo si estaba en NULL y el principal es una fila que
esta transacción insertó**.

Lo que **no hace**: no crea contactos (no hay `INSERT INTO public.contacts` en el archivo), no
re-terminaliza candidatos, no borra nada, no toca `mobile_phone` ni `phone_confidence`, no llama a
ningún proveedor, no reserva ni consume créditos, no escribe usage log ni corrida, y no llega a
HubSpot.

El escalar es **más estricto** que en la 117 a propósito: un contacto con escalar NULL y filas
canónicas vivas es, entre otras cosas, lo que deja una erasura de la 115 al retirar el principal;
elegir un hermano superviviente y escribirlo en el escalar sería devolver por una puerta lateral
un número que un borrado quitó.

Y hay un estado que **rechaza en seco**, con cero escrituras: `contacts.phone` no nulo con la
colección oficial **vacía** (`scalar_incumbent_unprojectable`). Es la forma legada que la 117
resuelve con un *bootstrap* del incumbente, y hacerlo aquí exigiría **invertir su procedencia** —
que para `provider_payload`, `unknown` y NULL no invierte sin ambigüedad
(`HISTORICAL_MANUAL_NULL_PROVENANCE_PENDING`). Responder esa pregunta dos veces en dos funciones es
cómo las dos acaban en desacuerdo.

### 5.5.1 El capability gate — desplegar antes de aplicar la migración es seguro

El código de esta sección puede llegar a Producción **antes** de que la 128 se aplique. Sin una
comprobación real de eso, un clic de compra podía reservar créditos y llamar a un proveedor y
**sólo después**, al proyectar, descubrir que no había ninguna RPC donde escribir el resultado —
el gasto ya habría ocurrido.

`checkProjectApprovedCandidatePhonesCapability()`
(`post-approval-reveal-capability.ts`) cierra ese hueco con una sonda REAL: la MISMA RPC de la
128, con los parámetros que su propio `Step 0` declara inofensivos (`p_candidate_id IS NULL`,
el primer `IF` de su cuerpo, antes de tocar una fila o abrir un lock). Si la función no existe,
PostgREST responde `PGRST202` (o `42883` desde el motor); si existe, devuelve
`{status: 'invalid_input', ...}` sin escribir nada. No es un número de migración, no es un flag y
no asume que la RPC existe.

`post-approval-reveal-runtime.ts` la consulta dentro de `resolveOffer`, la MISMA función que
**tanto** la vista previa **como** el clic recalculan fresca en cada invocación — nunca desde una
respuesta cacheada. Eso la convierte, con el mismo código, en dos cosas a la vez:

* el gate de la oferta: sin capacidad, `actionable = false` y el estado es
  `projection_capability_unavailable` — ni `startCandidateReveal` ni `project` se llegan a
  invocar, ni siquiera en `reuse_from_candidate` (lo ya pagado tampoco tiene dónde proyectarse);
* el RE-CHECK de la carrera: si la RPC existía cuando la ficha cargó la oferta y desapareció
  antes del clic, el clic vuelve a resolver la oferta —y por tanto a consultar la capacidad—
  ANTES de poder delegar. Un error de lectura de la propia comprobación también cierra: no hay
  rama que devuelva «se puede gastar» por omisión.

Con esto el rollout queda así: mergear y desplegar el código, con la 128 todavía sin aplicar, dejar
el CTA cerrado automáticamente, aplicar la 128 con autorización separada, y el CTA se habilita solo
en la siguiente carga de la ficha — sin ningún flag que lo gobierne.

### 5.6 Límite conocido y declarado de este corte

La proyección **no** se dispara desde el webhook de Apollo, ni desde el cron de recovery, ni desde
la continuación a Lusha. Se dispara desde
`reconcileOfficialContactPhoneFromCandidateAction`, que la ficha llama al abrirse y mientras espera
un reveal en vuelo (refresco acotado, el del subsistema).

Un teléfono que llegue por webhook aparece en el contacto **la próxima vez que su ficha
reconcilie**, no en el instante en que el proveedor contesta. Enganchar los tres caminos de
persistencia es una superficie **viva en Producción** y se deja para un corte propio en vez de
tocarla de paso en éste.

### 5.7 HubSpot

**Fuera de alcance.** 0 escrituras y 0 importaciones; `Approval → HubSpot` es un contrato aparte.
