# Agente 2A — Presupuesto y costos

> Fuente: `phone-reveal-credit-budget-core.ts`, `phone-reveal-credit-reservation-core.ts`,
> `src/modules/budgets/budget-resolution.ts`, migraciones 104 y 121.

---

## 1. El modelo real: POR PROVEEDOR, no un pozo compartido

```
budget_rules        → UNA regla por (provider_key × scope)
scope               → user → group (ancestro más cercano) → role → global
consumo             → agregado desde provider_usage_logs para ESE provider_key
                      dentro del período de la regla
remainingCredits    → max(0, limit_credits - consumed_credits)
```

Hoy `PHONE_REVEAL_CREDIT_BUDGET_MODEL = 'per_provider'`.

La semántica de pozo **compartido** también está modelada, explícitamente y con su propio tope
(13 / 8 / 5), para que la diferencia sea una decisión legible en el tipo y no una suposición: si
algún día el presupuesto pasa a ser compartido, se cambia `model` y **el compilador exige tratar
el caso**.

### 1.1 Las tres consecuencias que el código respeta

1. **No hay un saldo único que pueda cubrir 13.** Los 8 de Apollo salen sólo de la regla de
   Apollo y los 5 de Lusha sólo de la de Lusha. Un waterfall completo exige
   **Apollo ≥ 8 Y Lusha ≥ 5 por separado**, jamás «algún saldo ≥ 13».
2. **El helper del mínimo genérico se eliminó.** La versión anterior combinaba los saldos con un
   mínimo y lo comparaba contra 13. Era incorrecto en las dos direcciones: bloqueaba
   autorizaciones viables (Apollo 10 y Lusha 6 ⇒ min 6 < 13, cuando cada pata tenía de sobra) y
   su semántica no era declarable — «el mínimo» no responde a «¿alcanza para esta pata?».
3. **Sin regla de crédito no hay disponibilidad que reservar.** La versión 4D lo trataba como
   `unlimited` y **autorizaba**; desde 4E es `budget_not_configured` y **bloquea**. El waterfall
   no puede correr sobre un techo imaginario, y la reserva atómica no tendría contra qué
   descontar.

---

## 2. Modalidades y sus topes

| `PhoneRevealCreditBudgetMode` | Patas | Total |
|---|---|---|
| `full_waterfall` | Apollo ≤ 8 **y** Lusha ≤ 5 | 13 |
| `apollo_only` | Apollo ≤ 8 | 8 |
| `legacy_lusha_only` | Lusha ≤ 5 | 5 |
| `search_more_lusha` | Lusha ≤ 5 | 5 |

`apollo_only` **no** es un `run_mode`: es un `full_waterfall` cuyo candidato no tiene pata Lusha
alcanzable, así que su tope es 8 y no 13.

`search_more_lusha` comparte cifra con `legacy_lusha_only` porque es la MISMA pata de Lusha con
el MISMO tope, pero **no comparte modalidad**: la condición de entrada es la **opuesta**
(`legacy_lusha_only` exige que el candidato **no** tenga teléfono; `search_more` exige que **sí**
lo tenga). Colapsarlas volvería indistinguibles dos autorizaciones distintas en el ledger.

---

## 3. Los cuatro veredictos del preflight

| Veredicto | Significa |
|---|---|
| `authorized` | El pozo de cada proveedor exigido cubre su pata |
| `insufficient_credits` | Hay regla, pero no cubre los créditos de la pata |
| `budget_not_configured` | **No hay regla en créditos** para ese proveedor |
| `credit_balance_unavailable` | El presupuesto **no se pudo leer**. Fail-closed, sin afirmar cuál de los otros dos es |

Los tres rechazos **no se colapsan**. Deshabilitan igual, pero le dicen al operador cosas
distintas: al primero le falta saldo, al segundo le falta que un administrador configure la
regla, y del tercero **no se sabe nada** — afirmar cualquiera de los otros dos sería declarar un
hecho que nadie comprobó.

---

## 4. La reserva atómica (migración 104, endurecida en 4F)

### 4.1 Por qué comprobar el saldo no basta

El modelo presupuestario **no tiene columna de "reservado"**. Dos autorizaciones consecutivas
leen la MISMA disponibilidad y **las dos pasan**. Por eso el arranque **reserva la exposición
máxima** —Apollo 8 y/o Lusha 5, cada una contra su propio pozo, *all-or-nothing*— **antes** de
crear la corrida y **antes** de llamar a cualquier proveedor.

### 4.2 Lo que 4F añadió sobre 4E

* **`reserve_and_create_phone_reveal_run`** — reserva **y** corrida en **una** transacción. 4E
  las hacía en dos round trips, y la ventana entre ambos producía **exposición huérfana** ante
  muerte del proceso, respuesta perdida o timeout del driver.
* **`authorization_key`** + índice único — clave de idempotencia estable generada **antes** de la
  operación, así que un reintento devuelve la misma corrida en vez de autorizar una segunda.
* **`REVOKE`/`GRANT` en cada función.** PostgreSQL concede `EXECUTE` a `PUBLIC` por defecto; en
  funciones `SECURITY DEFINER` que saltan RLS, ese default era un agujero real.
* **`SET search_path = pg_catalog, pg_temp`** (`pg_catalog` primero, para que ningún objeto
  temporal pueda secuestrar una resolución de nombre).

### 4.3 Garantías

* Sin regla de crédito para un proveedor exigido ⇒ `budget_not_configured` y **no se arranca**.
* Si la corrida no se puede crear (excepción o `23505` del índice único parcial) la reserva se
  **libera** — un conflicto benigno no deja créditos bloqueados.
* La corrida nace con `credit_reservation_group_id`, así que run y exposición quedan asociadas
  **atómicamente**: **no existe** una corrida cuya reserva no se pueda encontrar para liquidarla.
* Mientras la corrida siga viva la exposición se mantiene **entera**; al terminalizar se
  reconcilia contra el costo real **de cada pata por separado**.

### 4.4 Endurecimiento a nivel de tabla (migraciones 106 y 107)

Las migraciones 102 y 104 habilitaron RLS y dieron **una** política, para `service_role`. Ése es
el control que todo el mundo lee al auditar, y es genuinamente relevante — pero **no es la única
capa**: RLS decide qué **filas** puede tocar un rol, y el `GRANT` de tabla decide si el rol puede
tocar la tabla **en absoluto**. Son dos puertas distintas y 102/104 sólo cerraron una.

* **106** cierra la de `phone_reveal_credit_reservations` y `phone_reveal_waterfall_runs`.
* **107** cierra la de `phone_reveal_cache` y `phone_reveal_suppression_audit`.

---

## 5. Costo: `unknown` nunca es 0

```ts
// search-more-phones-core.ts
function costSourceOf(credits: number | null): 'reported' | 'unknown' {
  return typeof credits === 'number' && Number.isFinite(credits) ? 'reported' : 'unknown';
}
```

* Un número **finito, incluido el 0 explícito**, es `reported`.
* La **ausencia** de dato es `unknown`, **nunca 0** — no reportar no es lo mismo que no cobrar.
* Los costos de Apollo y Lusha viven en columnas separadas y **jamás se suman en una**.
* `phone_reveal_credit_reservations.cost_truth` propaga esa distinción a la liquidación.

**Un `0` reportado es un 0 real** — sólo cuando el proveedor lo reporta. Las dos corridas
`search_more` de Producción tienen `lusha_cost_credits = 0` con `lusha_cost_source = 'reported'`:
Lusha efectivamente reportó coste cero, no es una ausencia disfrazada.

---

## 6. Sobregasto (migración 121)

La migración 064 construyó las guardas de presupuesto sobre una suposición que **no es cierta de
un proveedor externo**: que el gasto real nunca puede exceder lo reservado. Lo codificó dos
veces, incluida la constraint `wizard_budget_reservations_consumed_le_reserved`.

La 121 introduce la liquidación **veraz y terminal** cuando el proveedor gasta **más** de lo que
la corrida reservó. Es de Agente 1 (`AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1`), pero define el
principio que 2A comparte: **el ledger dice lo que pasó, no lo que se esperaba que pasara.**

---

## 7. Paridad de preflight en Search More (PR #309)

**Síntoma en Producción:** un candidato impecable mostraba el CTA pagado con su línea de costo,
el operador pulsaba **una** vez, y la respuesta era «No pudimos iniciar la búsqueda. No se
consumió ningún crédito.» — 0 corridas, 0 reservas, 0 llamadas, 0 créditos. **El servidor hizo lo
correcto; la pantalla afirmaba algo falso antes del clic.**

**Causa raíz:** el preflight y el runtime decidían la misma compra con **dos conjuntos de hechos
distintos**. `readSearchMorePreflight` resolvía candidato, colección, procedencia, corridas y
privacidad, y **nada sobre el dinero**, mientras el runtime sí resolvía el pozo de Lusha antes de
reservar.

**Arreglo:**

* el preflight resuelve el pozo de Lusha con la cadena **canónica**
  (`resolvePhoneRevealCreditBudgetProviders` → `readPhoneRevealCreditPools` →
  `evaluatePhoneRevealCreditBudget`), que es el **mismo** resolver que usa el gate de la reserva
  ⇒ la disponibilidad incluye la **exposición ya reservada** y no sólo el consumo liquidado. **No
  hay una segunda implementación del presupuesto**;
* el planificador recibe el veredicto como un hecho más, con el **tipo canónico** del core de
  crédito, y falla cerrado: sólo `authorized` continúa;
* los tres rechazos usan **exactamente** los códigos que el gate del runtime ya devolvía, así que
  **una sola traducción de copy** sirve para los dos caminos;
* `SEARCH_MORE_BUDGET_MODE` pasa a ser una constante **exportada**, de modo que el pozo que el
  plan evalúa y el que la transacción ocupa **no puedan separarse**.

**El runtime NO se debilita.** Sigue recomputando el presupuesto y reservando dentro de la
transacción, porque el preflight puede quedar obsoleto entre el render y el clic.

> **El plan es una promesa honesta de la UI; la reserva atómica es la única autoridad.**

---

## 8. Cómo se administra el presupuesto

Desde la configuración de la plataforma (módulo `budgets`), creando o editando filas de
`budget_rules`:

| Campo | Qué decide |
|---|---|
| `provider_key` | A qué proveedor aplica (`apollo`, `lusha`, `tavily`, …) |
| `scope_type` / `scope_id` | `user` \| `group` \| `role` \| `global`. Resuelve del más específico al más general |
| `period_type` | Ventana de agregación del consumo |
| `limit_credits` | **El techo en CRÉDITOS.** Es el único que el reveal de teléfono sabe leer |
| `limit_usd` | Techo en dólares. **No sustituye** a `limit_credits` para este subsistema |
| `on_exceed` | `alert` \| `block` |
| `is_active` | Una regla inactiva **no cuenta**: para el preflight equivale a no existir |

> **`is_active = false` produce `budget_not_configured`, no «sin límite».** Ésa es la
> consecuencia directa de la decisión 4E.

### 8.1 Política operativa final (autorizada por la dueña, 2026-08-20)

Agente 2A está **habilitado en Producción**. El presupuesto **ya no es un interruptor de QA**: la
disponibilidad operativa de las acciones pagadas la gobiernan estas dos reglas más los gates
*fail-closed* del runtime.

| Proveedor | `scope_type` | `scope_id` | Período | Techo | `on_exceed` | Estado |
|---|---|---|---|---|---|---|
| `apollo` | `global` | — | mensual | 500 créditos | `alert` | **activa** |
| `lusha` | `role` | `admin` | mensual | 500 créditos | `block` | **activa** |

**Reglas históricas más estrechas — inactivas, conservadas como historial:**

| Proveedor | `scope_type` | Techo | Estado |
|---|---|---|---|
| `apollo` | `group` | 500 | **inactiva** |
| `apollo` | `role` (`admin`) | 100 | **inactiva** |
| `apollo` | `user` (QA) | 45 | **inactiva** |
| `lusha` | `user` (QA) | 21 | **inactiva** |

> **La regla de Lusha por usuario de la QA está INACTIVA y no es política.** Fue una
> configuración puntual para validar el flujo con dinero real. Ninguna regla de QA debe leerse
> como techo permanente del producto, ni como la autoridad operativa vigente.

**La prioridad de resolución NO cambia:** `user` → `group` (ancestro más cercano) → `role` →
`global`. De ahí la consecuencia que hay que tener presente al administrar: **reactivar** una
regla de scope más específico *gana* sobre la operativa vigente — un techo por usuario de 21
créditos volvería a acotar a ese usuario muy por debajo del techo global. Ésa es exactamente la
razón por la que las reglas de QA se dejan **inactivas** en lugar de borrarse.

### 8.2 Snapshot fechado de consumo (2026-08-20, READ-ONLY)

Cifras **de un instante**, no reglas de producto ni compromisos:

| Proveedor | Techo de la regla vigente | Consumido en el período | Reservado activo | Disponible |
|---|---|---|---|---|
| `apollo` | 500 (`global`) | 298 | 0 | 202 |
| `lusha` | 500 (`role` `admin`) | 16 | 0 | 484 |

**Consecuencia operativa:** el reveal normal (`full_waterfall` y su variante `apollo_only`) y
«Buscar más números» tienen los dos presupuesto **resoluble** bajo la política vigente. Ya **no**
es cierto que un `full_waterfall` resuelva `budget_not_configured` por falta de regla activa.

`budget_not_configured` sigue siendo el veredicto correcto —y sigue **bloqueando**— si alguien
desactiva una regla, si la regla del proveedor exigido desaparece, o si sólo tiene `limit_usd`. Su
diagnóstico está en [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) § E.
