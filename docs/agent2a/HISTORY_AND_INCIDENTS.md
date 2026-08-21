# Agente 2A — Historia, migraciones e incidentes

> Estados de PR y SHAs de merge verificados con `gh pr list` el 2026-08-19.
> Estado de aplicación de migraciones leído de `supabase_migrations.schema_migrations`
> en Producción, **no** de las cabeceras de los ficheros.

---

## 1. Migraciones

### 1.1 Advertencia importante sobre las cabeceras

Muchas migraciones de este rango llevan en su cabecera un marcador del tipo
`⚠️ NOT APPLIED` o `APPLIED IN PRODUCTION: NO`. **Esos marcadores están congelados en el momento
en que se escribió el fichero y hoy son incorrectos para casi todas.** La columna «Aplicada» de
la tabla siguiente viene de la base de datos.

Esto se documenta, no se corrige: cambiar las cabeceras sería un cambio de runtime fuera del
alcance de esta auditoría.

### 1.2 Tabla cronológica

| # | Nombre | Propósito | Aplicada en Prod | Versión remota | Capacidad que introduce | Objetos críticos |
|---|---|---|---|---|---|---|
| 100 | `provider_usage_logs_spend_correlation` | Columnas de correlación de gasto (Agente 1, pero 2A las consume) | ✅ | `20260731135101` | Correlacionar reserva ↔ usage log | `reservation_id`, `client_request_id`, `idempotency_key` |
| 101 | `lusha_phone_reveal_scaffold` | Amplía el vocabulario de `phone_reveal_provider` para admitir Lusha | ✅ | `20260803151644` | Lusha como proveedor de reveal | CHECK de `phone_reveal_provider` |
| **102** | `phone_reveal_waterfall_runs` | Una fila por clic autorizado, dos patas atribuibles | ✅ | `20260803231953` | **Waterfall Apollo→Lusha** | `phone_reveal_waterfall_runs`, índice único parcial de corrida activa |
| 103 | `phone_reveal_waterfall_legacy_mode` | `run_mode` para distinguir modalidades sin inferir | ✅ | `20260803232125` | Modalidad `legacy_lusha_only` | `run_mode` + CHECK |
| **104** | `phone_reveal_credit_reservations` | Reserva atómica de créditos + run en una transacción | ✅ | `20260805010026` | **Reserva antes de pagar** | `phone_reveal_credit_reservations`, `reserve_and_create_phone_reveal_run`, `authorization_key` |
| 105 | `repair_prospect_candidates_identity_key` | Reparación forward-only de la 092 nunca registrada | ✅ | `20260805143327` | Integridad de historia de migraciones | `identity_key` |
| 106 | `phone_reveal_reservation_table_grants` | Endurecimiento de privilegios a nivel de TABLA | ✅ | `20260805150546` | Cierra el hueco GRANT vs RLS | `REVOKE`/`GRANT` sobre 102 y 104 |
| 107 | `phone_reveal_cache_and_suppression_grants` | Lo mismo para las tablas de caché | ✅ | `20260805172437` | Idem sobre 099 | `REVOKE`/`GRANT` sobre caché y audit |
| 108 | `add_prospect_candidates_linkedin_url` | LinkedIn corporativo en candidatos (Agente 1) | ✅ | `20260805235439` | — | `linkedin_url` |
| **109** | `contact_enrichment_candidate_phones` | **Modelo canónico MULTI-TELÉFONO del candidato** | ✅ | `20260806000754` | Deja de perderse el 2º número ya pagado | `contact_enrichment_candidate_phones`, `…_phone_sources` |
| **110** | `persist_candidate_apollo_phone_reveal_result` | Persistencia **transaccional** de un `revealed` de Apollo | ✅ | `20260806154459` | Atomicidad de la escritura + recheck por número | RPC de persistencia Apollo |
| **111** | `persist_candidate_lusha_phone_reveal_result` | Lo mismo para Lusha; deja de reducir `phones[]` a `phones[0]` | ✅ | `20260806172357` | Se guardan **todos** los números de Lusha | RPC de persistencia Lusha |
| **112** | `suppress_candidate_phone_collection` | Propaga la DSAR a la colección + re-elige el principal | ✅ | `20260810163800` | La DSAR alcanza el 5º sitio | RPC de supresión + re-elección atómica de `is_primary` |
| **113** | `phone_reveal_person_suppression_recheck` | Recheck de supresión **por PERSONA** dentro de la transacción | ✅ | `20260810201935` | Cierra la carrera de la DSAR en vuelo | Recheck dentro del lock |
| **114** | `official_contact_phones` | **Modelo MULTI-TELÉFONO del contacto OFICIAL** | ✅ | `20260811224536` | Colección durable, identidad correcta | `contact_phones`, `contact_phone_sources` |
| **115** | `official_contact_phone_privacy` | Borrado **por proveedor** del modelo oficial | ✅ | `20260812120902` | Retirar una procedencia sin matar el número | RPC de borrado por procedencia |
| **116** | `approve_candidate_with_official_phones` | **Aprobación ATÓMICA** candidato → contacto multi-teléfono | ✅ | `20260812180514` | 5 escrituras independientes → 1 transacción | `approve_contact_candidate_with_phones` |
| **117** | `merge_candidate_into_existing_contact` | Merge aditivo **confirmado por humano** de un duplicado | ✅ | `20260812233905` | El duplicado deja de ser un callejón sin salida | `merge_candidate_into_existing_contact` |
| 118 | `macro_industry_catalog_v2_draft` | Catálogo Macro v2 (Agente 1) | ✅ | `20260813012013` | — | — |
| 119 | `publish_macro_industry_catalog_v2_cutover` | Cutover del catálogo (Agente 1) | ✅ | `20260813153253` | — | — |
| **120** | `provider_native_phone_suppression` | **Supresión NATIVA del proveedor, independiente de la cuenta** | ✅ | `20260818211334` | Privacidad Fase 1 | `provider_suppressions`, `provider_suppression_audit` |
| 121 | `wizard_budget_overage_reconciliation` | Liquidación veraz del sobregasto (Agente 1) | ✅ | `20260818223942` | El ledger admite que el proveedor gastó de más | Reemplazo de `…consumed_le_reserved` |
| **122** | `phone_reveal_search_more` | **«Buscar más números»** | ✅ | `20260819180119` | `run_mode = search_more` + append-only | `append_candidate_search_more_phones` |

**Verificado:** las 23 migraciones del rango 100–122 están aplicadas en Producción. La 122 se
aplicó el mismo 2026-08-19.

---

## 2. Pull requests

Todos los PRs listados en el alcance están **MERGED** salvo **#288**, que sigue **OPEN**.

| PR | Estado | Merge SHA | Capacidad / razón | Decisión importante |
|---|---|---|---|---|
| #232 | MERGED | `654f908a` | Las reservas confirmadas del reveal cuentan en el presupuesto sin duplicar el costo de Lusha | El consumo se cuenta una vez, no por reserva **y** por log |
| #236 | MERGED | `3252205b` | Modelo multi-teléfono del candidato (mig 109) | Sólo la **forma**: 4O-B no cablea nada a propósito |
| #237 | MERGED | `1e05dc37` | Persistir **todos** los teléfonos que Apollo devuelve | Apollo devuelve la colección completa en hasta 3 ubicaciones |
| #240 | MERGED | `640e17ff` | Persistir **todos** los teléfonos de Lusha | Se deja de reducir `phones[]` a `phones[0]` |
| #242 | MERGED | `40f03e4f` | Terminalizar los reveals suprimidos | Una supresión cierra la corrida, no la deja viva |
| #244 | MERGED | `afe106f5` | Propagar la supresión a la colección del candidato (mig 112) | La DSAR alcanza el 5º sitio |
| #247 | MERGED | `45c79eb9` | Cerrar carreras de privacidad + gates del Lusha manual (mig 113) | La puerta de privacidad se **extrae** para que los dos caminos usen la misma función |
| #248 | MERGED | `964aa8ec` | Borrado seguro de teléfonos oficiales revelados por Lusha | — |
| #250 | MERGED | `79e31426` | Preservar móviles **sin procedencia** durante el borrado por proveedor | Sin evidencia de que ese proveedor lo trajo, no se destruye |
| #253 | MERGED | `423c3631` | Persistir todos los teléfonos del reveal **manual** de Lusha | Paridad del camino manual con el automático |
| #258 | MERGED | `b1e4d3c9` | **«Ver más números»** del candidato | READ-ONLY garantizado por test estático de importaciones |
| #259 | MERGED | `8bc21c28` | Marcar la procedencia de un teléfono creado a mano | `acquisition_mode = manual` |
| #261 | MERGED | `1ef65560` | Esquema oficial multi-teléfono **inerte** (mig 114) | Se envía la forma sin cablear la escritura |
| #269 | MERGED | `5e6e0594` | Borrado por proveedor del modelo oficial (mig 115) | **Borrar Apollo deja de matar el número que Lusha sostiene** |
| #273 | MERGED | `52baca33` | Aprobación atómica → contacto oficial multi-teléfono (mig 116) | 5 escrituras independientes pasan a ser 1 transacción |
| #277 | MERGED | `09f01df4` | Merge humano-confirmado en contacto existente (mig 117) | El duplicado deja de ser un callejón sin salida |
| #278 | MERGED | `7bb8e9e2` | «Ver más números» del contacto **OFICIAL** | Mismo contrato READ-ONLY |
| #279 | MERGED | `1363c600` | Incidente Prod: búsqueda de empresa colgada + detalle ciego | Ver § 3.1 |
| #284 | MERGED | `eefb1f60` | Incidente Prod P0-R2: drawer girando para siempre + cola mal anunciada | Ver § 3.2 |
| #285 | MERGED | `8f90522a` | Incidente Prod P0-R4: `'use server'` tumbando `/contacts` con 500 | Ver § 3.3 |
| #289 | MERGED | `a6c283ef` | **P0: la supresión deja de fail-open cuando no se puede evaluar** | Ver § 3.4 |
| #291 | MERGED | `60214792` | El botón deja de prometer lo que la supresión no puede autorizar | Ver § 3.5 |
| #295 | MERGED | `00b848c0` | Privacidad deja de depender de la cuenta y del proveedor equivocado (Fase 1, mig 120) | Ver § 3.6 |
| #300 | MERGED | `da8b4eda` | La espera del reveal asíncrono deja de depender de una lectura afortunada | Ver § 3.7 |
| #303 | MERGED | `24638bdb` | **«Buscar más números»**: modalidad, writer append-only, planificador, runtime y UI (mig 122) | Lusha-only por contrato, no por prudencia |
| #308 | MERGED | `4ee0f4d2` | «Buscar más números» deja de abrir un modal: botón secundario, un clic | Menos fricción sin perder la autorización explícita |
| #309 | MERGED | `98dbd0ca` | **Paridad de preflight de presupuesto** en Search More | Ver § 3.8 |
| #288 | **OPEN** | — | Badge «Nuevo» para candidatos recién descubiertos | Trabajo congelado. Ver [FUTURE_WORK.md](FUTURE_WORK.md) |

---

## 3. Incidentes

### 3.1 Búsqueda de empresa colgada + detalle de candidato ciego (#279)

* **Síntoma:** «Buscando en SellUp y HubSpot…» para siempre. Y, por separado, «Candidato no
  disponible» sin poder distinguir la causa.
* **Causa raíz (B):** las dos búsquedas de empresas en HubSpot eran los **únicos `fetch` del
  flujo sin techo de espera**. Cuando HubSpot no respondía, el server action no volvía nunca y la
  plataforma acababa cortando la invocación. Además el wizard hacía `await` del action **sin
  `catch`**: los actions devuelven `{success:false, error}` cuando fallan por dentro y el reducer
  sabe salir con eso, pero **no** estaba cubierto que la llamada misma **rechazara** (invocación
  cortada, red caída, función matada por la plataforma). Sin nada que despachar, el paso
  `resolving` se quedaba puesto indefinidamente.
* **Causa raíz (A):** el cargador tenía **un solo estado** (`notFound`) para dos hechos distintos
  —el candidato salió de `pending_review` (esperado) y la lectura falló (fallo real)— y un
  `catch {}` **vacío** que descartaba el error.
* **Impacto:** flujo de enriquecimiento inutilizable ante lentitud de HubSpot; diagnóstico
  imposible.
* **Arreglo:** `AbortSignal.timeout` en su propio módulo (verificable sin Supabase ni red); los
  tres pasos del wizard capturan el rechazo; y `null` pasa a marcar el no-resultado, de modo que
  «HubSpot no se pudo consultar» deja de confundirse con «HubSpot contestó que no hay
  coincidencias» (la rama de `skippedHubSpot` era **inalcanzable**).
* **Protección:** suite dedicada + el módulo del timeout es testeable offline.

> **Lección honesta registrada en el propio commit:** la causa raíz de (A) **no se puede sacar de
> Producción**, porque el `catch {}` vacío no dejó rastro. El commit **no la afirma**. Lo que
> arregla es la ceguera.

### 3.2 P0-R2 · Cross-flow: drawer girando para siempre y cola mal anunciada (#284)

* **Síntoma (QA de la dueña, 2026-08-13 ~08:31 America/Bogotá):** el drawer del contacto se
  quedaba en «Cargando contacto…».
* **Causa raíz:** **no era la lectura.** El drawer sólo sabía representar **un** estado («no hay
  contacto») y lo usaba para **tres** hechos: lectura en curso (correcto), contacto inexistente
  (terminal, mentira) y lectura fallida (terminal, mentira). `loadData` no tenía `catch` y el
  render era `loading || !contact ? spinner`. Como el `finally` sí bajaba `loading`, un fallo
  dejaba `contact` en `null`, la condición `!contact` reponía el spinner y **ya no quedaba nada
  que lo quitara**.
* **Segundo defecto:** con la pill «Duplicados» seleccionada, la tabla seguía titulándose
  «Candidatos por revisar». La **consulta nunca fue el problema** (los `edge_logs` de Producción
  muestran `status=eq.duplicate` devolviendo 200); título, descripción y estado vacío estaban
  **hardcodeados** dentro del componente de tabla, que no recibía la cola.
* **Arreglo:** tres salidas estables tras la carga (contacto / «no disponible» / «no se pudo
  cargar» con reintento) — el mismo contrato que 4O-H3-B-R1 dio al drawer de candidato.
  `NEXT_REDIRECT` se re-lanza intacto para que una sesión caducada siga llevando al login.
* **Protección:** suite `test:agent2a:p0-r2-crossflow` en CI.

### 3.3 P0-R4 · `'use server'` cross-flow — 500 en Producción (#285)

Éste es el incidente más instructivo del subsistema.

* **Síntoma:** Producción devolvía **500** en cuatro `POST /contacts` durante la QA de la dueña
  del 2026-08-13 (14:46:31–39 UTC), con el error de runtime:
  `A "use server" file can only export async functions, found object.`
* **Causa raíz:** `candidate-stored-phones-actions.ts` lleva la directiva `'use server'` y
  exportaba `CANDIDATE_STORED_PHONES_AUTHORIZED_ROLE_KEYS`, **un array**. Next envuelve **toda**
  exportación de un módulo con esa directiva como Server Action y valida al evaluarlo que cada una
  sea una función (`ensureServerEntryExports`); `typeof []` es `'object'`, así que **el módulo
  entero se negaba a evaluar**. No caía la constante: **caían todas las acciones de la pantalla
  que la arrastra.** Introducido por 4O-G.
* **Por qué nadie lo vio:** esa validación **no la hace `tsc`, ni `eslint`, ni `next build`**. El
  commit compiló, tipó, linteó, construyó y desplegó sin una sola advertencia. El único sitio
  donde el fallo existe es **el servidor en ejecución**.
* **Arreglo:** la constante se muda a `candidate-stored-phones-authorized-roles.ts`, un módulo
  vecino **sin** la directiva. Mismo valor, mismos roles, misma semántica.
* **Protección (la parte importante):** la clase ya había ocurrido antes
  (`REVIEWABLE_CONTACT_CANDIDATE_STATUSES` en 4O-H3-B R1) y **ninguna de las dos veces la atrapó
  una comprobación automática**. Por eso el ratchet **no vigila un símbolo**: recorre con el AST
  de TypeScript **los 52 módulos `'use server'` del repositorio** y falla ante cualquier
  exportación que no sea una función async — incluidas reexportaciones (que resuelve) y
  `export * from` (que **rechaza** por no verificable). Además ejecuta el **validador real de
  Next** sobre los tres módulos de acciones de los flujos que cayeron.

### 3.4 P0 · Privacidad fail-open cuando no se puede evaluar (#289)

* **Síntoma:** un candidato **sin clave de supresión** pasaba como `clear` y el reveal se
  ejecutaba, pagando el crédito.
* **Causa raíz:** `not_evaluable` (sin `apollo_person_id` resoluble o sin cuenta) se traducía a
  `clear`. Y el candidato típico sin clave es precisamente **el de origen Lusha** — exactamente
  el que un tombstone real no podía alcanzar.
* **Arreglo:** fail-closed en las **cuatro** fases: START, webhook, recovery y la puerta previa a
  Lusha.
* **Coste del arreglo:** rompió **38 pruebas en 4 archivos** cuyos fixtures asumían el contrato
  viejo. Se reconciliaron **por intención de cada prueba**, no por patrón único: re-fixture
  cuando la prueba verificaba otro invariante, re-specify cuando el contrato de verdad cambió.
* **Protección:** `test:agent2a:phone-reveal-action` —que ya existía pero **nunca estaba en ningún
  workflow**— pasa a ser paso obligatorio, junto con la suite huérfana que el propio P0 creó.

### 3.5 Falsa promesa: el botón ofrecía lo que la privacidad no podía autorizar (#291)

* **Síntoma:** tras #289 la UI **no se enteró**: seguía ofreciendo «Revelar teléfono»
  **habilitado** a candidatos cuya clave no existe. El operador gastaba un clic para recibir un
  error rojo por algo que se sabía imposible **antes** del clic. **En Producción eran 18 de 31
  candidatos en revisión.**
* **Arreglo:** `phone-reveal-identity-eligibility.ts`, un core **puro** que responde «¿existe la
  clave con la que la supresión podría consultarse?». **No reescribe la regla**: reutiliza
  `resolvePhoneCachePersonId`, exactamente la función que usan los resolutores del servidor. Sin
  segunda expresión regular, sin segunda condición de proveedor.
* **Detalle de copy:** el mensaje **no nombra proveedor ni promete reintento**, porque la carencia
  puede ser **permanente** (un candidato Lusha sin `apollo_person_id` no adquiere uno esperando).
  Con el botón bloqueado tampoco se muestra el copy de autorización: prometer «hasta N créditos»
  describiría un gasto que no puede ocurrir.
* **Protección:** paridad comprobada contra `resolvePhoneCachePersonId` sobre la **matriz
  completa** (9 formas de id × 9 × 6 orígenes × 4 cuentas = 1944 combinaciones), para que un
  cambio en el resolutor mueva las dos decisiones a la vez.

### 3.6 Privacidad atada a la cuenta y al proveedor equivocado (#295, Fase 1)

Ver [PRIVACY_AND_SUPPRESSION.md](PRIVACY_AND_SUPPRESSION.md) § 3. Resumen: la clave de la
**caché** se estaba usando como clave de **privacidad**, con tres consecuencias equivocadas. La
migración 120 introduce `provider_suppressions`, con identidad nativa del proveedor e
independiente de la cuenta.

### 3.7 UI asíncrona congelada tras un reveal exitoso (#300)

* **Síntoma (QA de Producción, 2026-08-18 21:43:40 → 21:43:59 UTC):** el backend cerró el reveal
  en ~20 s y persistió todo bien —`revealed`, proveedor `apollo`, 1 teléfono, 1 fila de origen—
  **pero la UI no se movió**: tras el clic el drawer siguió idéntico, sin estado de espera, y el
  teléfono **sólo apareció al recargar el navegador (F5)**.
* **Causa raíz:** **todo** el estado de espera se derivaba **exclusivamente** del
  `phone_reveal_status` **leído del servidor**. El cliente no registraba en ninguna parte «acabo
  de solicitar un reveal», así que entre el `finally` del handler (que apaga su propio spinner) y
  la llegada del refetch —lanzado con `void`, sin esperar— el drawer volvía a pintarse **IDLE**.
  Y el hueco **no se cerraba solo**: el sondeo automático dependía del mismo estado leído que
  faltaba, de modo que un refetch lento, caído o servido antes de que el START confirmara dejaba
  la UI idle **indefinidamente**. Nadie volvía a mirar, porque el único disparador del sondeo era
  justamente el dato que no había llegado.
* **Arreglo:** un **pestillo de solicitud** (`phone-reveal-submission-latch-core.ts`) que se
  enciende en el **mismo tick** en que el server action **acepta** el envío
  (`requested` / `already_pending`), **antes** de cualquier refetch. Mientras dura:
  * el CTA deja de estar idle y dice «Buscando teléfono…», deshabilitado — que es además **el
    guard de doble envío que faltaba** (el ref sólo cubre el mismo tick y `revealingPhone` se
    apaga en su `finally`);
  * el refresco acotado arranca **por haber solicitado**, no por haberlo leído, así que un primer
    refetch fallido ya no congela la pantalla;
  * se ofrece «Actualizar desde SellUp» por si el presupuesto de tiempo del refresco se agota.
* **Qué NO se relajó:** presupuesto de tiempo, teléfono presente, estado terminal, cierre del
  drawer y cambio de candidato apagan el pestillo igual. **El servidor sigue mandando**: en cuanto
  dice algo —en vuelo o terminal— el pestillo se apaga.
* **Alcance:** 0 migraciones, 0 llamadas a proveedor desde el sondeo, 0 créditos, 0 escrituras.
* **Protección:** suite `test:agent2a:phone-async-ui-refresh` (11 casos) en el check obligatorio,
  con los casos 2, 3 y 4 **verificados en rojo** contra `main` sin el arreglo.

### 3.8 Divergencia de preflight de presupuesto en Search More (#309)

Ver [BUDGET_AND_BILLING.md](BUDGET_AND_BILLING.md) § 7.

### 3.9 Candidato en cuenta archivada

* **Síntoma:** se podía intentar crear un contacto oficial sobre una cuenta archivada.
* **Arreglo:** `checkAccountActiveForContact` (`src/modules/contacts/account-active-guard.ts`)
  bloquea si `archived_at IS NOT NULL` **o** `pipeline_status = 'archived'`, y distingue además
  «cuenta no encontrada».
* **Nota:** este guard fue también **víctima colateral** del incidente P0-R4: era una función
  **síncrona** reexportada desde un módulo `'use server'`. No reventaba la validación
  (`typeof` es `'function'`) pero se habría publicado como Server Action devolviendo algo que no
  es una promesa. Salió del apuro en el mismo PR #285.

### 3.10 Preview comparte backend con Producción

* **Hecho verificado:** la organización Supabase de SellUp tiene **exactamente un proyecto**
  (`lrdruowtadwbdulndlph`). No existe un proyecto separado de preview/staging.
* **Consecuencia:** **todo deployment de Preview de Vercel apunta a la base de datos de
  Producción.** Un flujo pagado ejercitado desde una URL de Preview consume créditos **reales**,
  crea corridas **reales** y escribe filas **reales**.
* **Estado:** **no mitigado.** No es un defecto de código; es una propiedad de la topología de
  infraestructura. Ver [FUTURE_WORK.md](FUTURE_WORK.md).
* **Mitigación operativa vigente:** los flags de proveedor son `type: sensitive` y se configuran
  por entorno, así que un Preview sin el flag encendido no puede gastar. Eso es una mitigación
  **por configuración**, no por aislamiento.

### 3.11 Duplicados — hallazgos acumulados

* La detección de duplicados **terminaliza** el candidato como `duplicate` y devuelve `ok:false`.
  Por eso la migración 116 dice explícitamente «**por qué no hay merge en contacto existente**»:
  en el momento en que 116 corre no existe un destino humano-confirmado.
* La migración 117 (#277) añade una operación **separada** que empieza justo donde termina el
  veredicto de duplicado, y exige confirmación humana del destino.
* El PR #284 documentó dos síntomas que **no eran defectos** para que nadie los «arregle» en el
  futuro.

---

## 4. Patrón transversal de estos incidentes

Cinco de los ocho incidentes son **la misma clase de error**: *un estado de la UI usado para
representar más de un hecho.*

| Incidente | Estados colapsados |
|---|---|
| #279 (A) | «no está en revisión» vs «la lectura falló» |
| #279 (B) | «HubSpot dijo que no hay» vs «HubSpot no contestó» |
| #284 | «cargando» vs «no existe» vs «falló» |
| #291 | «puedo revelar» vs «la privacidad ni siquiera es evaluable» |
| #300 | «no he pedido nada» vs «pedí y aún no me contestan» |
| #309 | «elegible» vs «elegible pero impagable» |

Y la respuesta ha sido siempre la misma: **separar el vocabulario**, no añadir un caso especial.
Es la razón por la que este subsistema tiene vocabularios cerrados tan grandes —15 motivos de
inelegibilidad en Search More, 7 fases, 3 estados de supresión— en vez de booleanos.
