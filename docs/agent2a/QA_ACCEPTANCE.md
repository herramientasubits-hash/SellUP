# Agente 2A — QA de aceptación en Producción

> **Minimización de PII.** Se usan **sólo nombres de pila**, porque son necesarios para
> identificar internamente los casos de QA. **No** se reproducen apellidos, emails, teléfonos
> completos, ids de contacto de proveedor ni ningún otro dato sensible. Los teléfonos se citan
> únicamente como «un número», nunca enmascarados parcialmente ni completos.
>
> Todo lo de este documento fue **verificado con `SELECT` de sólo lectura contra Producción** el
> 2026-08-19, no reconstruido de memoria ni de descripciones de PR.

---

## 1. Universo de corridas de teléfono en Producción

| `run_mode` | `status` | Nº |
|---|---|---|
| `full_waterfall` | `completed_apollo` | 1 |
| `legacy_lusha_only` | `completed_lusha` | 1 |
| `search_more` | `exhausted` | 1 |
| `search_more` | `completed_lusha` | 1 |

**Total: 4 corridas, las 4 terminales. 0 corridas vivas.**

Las dos corridas `search_more` **son** los dos casos de aceptación de «Buscar más números».

---

## 2. Caso IVETTE — Search More sin número adicional

| Hecho | Valor verificado |
|---|---|
| `source` del candidato | `lusha` |
| Teléfono inicial: proveedor | `apollo`, `acquisition_mode = reveal`, tipo `mobile` |
| Corrida | `run_mode = search_more`, `max_credits_authorized = 5` |
| Apollo en esta corrida | `apollo_attempted_at = NULL`, `apollo_outcome = NULL` — **cero llamadas** |
| Lusha | `lusha_eligible = true`, `lusha_attempted_at` sellado, **una** llamada |
| Desenlace de Lusha | `no_phone_found` |
| Estado terminal | **`exhausted`** |
| `final_provider` | `none` |
| Costo de Lusha | `0` créditos, `lusha_cost_source = 'reported'` |
| Colección tras la operación | **1 teléfono vivo**, procedencia `apollo` |

**Lo que este caso demuestra:**

1. Search More consultó a Lusha —el proveedor que faltaba— y **no** a Apollo.
2. Lusha contestó que no tiene número adicional. Eso se registró como `no_phone_found`, **no**
   como error: es un hecho sobre la persona, no un fallo técnico.
3. **El teléfono de Apollo que ya existía se preservó intacto.** Una operación que no encuentra
   nada no destruye lo que ya se pagó.
4. El costo fue **0 reportado**, no `unknown`. Lusha efectivamente reportó cero.
5. Estado terminal `exhausted`: Lusha queda **agotada** para este candidato. Un segundo clic ya
   no ofrecería la compra, porque la regla «Lusha no se llama dos veces» aplica a **cualquier**
   desenlace terminal, incluido éste.
6. **Cero llamadas duplicadas al proveedor.**

---

## 3. Caso KATIA — el caso de aceptación principal end-to-end

Éste es **el** caso que cierra la funcionalidad.

| Hecho | Valor verificado |
|---|---|
| `source` del candidato | `lusha` (identidad nativa de Lusha presente) |
| Corrida | `run_mode = search_more`, `max_credits_authorized = 5`, rol `admin` |
| Apollo en esta corrida | `apollo_attempted_at = NULL` — **cero llamadas** |
| Lusha | **una** llamada, `lusha_outcome = revealed` |
| Estado terminal | **`completed_lusha`** |
| `final_provider` | `lusha` |
| Costo de Lusha | `0` créditos, `reported` |
| Colección tras la operación | **2 teléfonos vivos y distintos** |

### 3.1 La colección resultante, número a número

| | Principal | Secundario |
|---|---|---|
| `is_primary` | **`true`** | `false` |
| `phone_type` | `mobile` | `mobile` |
| Procedencia · `provider` | **`apollo`** | **`lusha`** |
| Procedencia · `acquisition_mode` | `reveal` | `reveal` |
| `raw_provider_type` crudo | `mobile` | `mobile` |
| `waterfall_run_id` | — | **presente** |
| `reservation_id` | — | **presente** |
| `provider_usage_log_id` | — | **presente** |

### 3.2 La cadena completa que este caso prueba

```
teléfono inicial de Apollo
   → «Buscar más números» vía Lusha
      → un segundo número DISTINTO
         → «Ver más números» lo muestra
            → procedencia de DOS proveedores preservada
```

Punto por punto, verificado en datos:

1. **El primario siguió siendo el resultado de Apollo.** La operación es **append-only**: no
   reordena, no reemplaza, no degrada lo que ya estaba. Los dos números son `mobile`, así que el
   empate de tipo se resolvió por especificidad de procedencia — y ahí `apollo:reveal` gana a
   `lusha:reveal`, que es exactamente lo que el ranking declara.
2. **El secundario lleva procedencia de Lusha**, distinta y explícita.
3. **La procedencia del número de Lusha lleva la cadena de dinero completa**: corrida que lo
   autorizó, reserva que lo respaldó y fila del ledger de gasto que lo pagó. Es auditable de
   punta a punta.
4. **«Ver más números» expone el secundario almacenado** sin llamar a nadie — la operación de
   lectura no importa ningún cliente de proveedor, y un test estático lo impone.
5. **Search More no llamó a Apollo.** `apollo_attempted_at` sigue `NULL`, y no existe ningún
   usage log de Apollo atribuido a esta corrida.
6. **Provenance de dos proveedores conservada en una sola colección canónica.** Ése es el
   objetivo entero del modelo multi-teléfono de la migración 109.

---

## 4. Observación registrada durante la verificación

Las filas de procedencia de origen **Apollo** presentes hoy en Producción (las de Ivette y la
principal de Katia) tienen `waterfall_run_id`, `reservation_id` y `provider_usage_log_id` en
`NULL`, mientras que la fila de origen **Lusha** escrita por Search More los lleva **los tres**.

Se registra como **hecho observado**, sin afirmar causa. Explicaciones plausibles —no
verificadas en esta auditoría— incluyen que esos números se escribieran por un camino anterior al
cableado de correlación (4O-C persiste la colección; el enlace run/reserva/usage-log se afinó
después), o que provengan de una corrida previa a la existencia de
`phone_reveal_waterfall_runs`.

**No se investigó más porque hacerlo excede el alcance READ-ONLY de este hito.** Queda anotado en
[FUTURE_WORK.md](FUTURE_WORK.md) como pregunta abierta, no como defecto.

---

## 5. Lo que NO tiene evidencia de Producción

Honestidad sobre el alcance de la QA real. Estas capacidades están **implementadas y cubiertas
por pruebas** (incluidas suites contra PostgreSQL real), pero **no** han sido ejercitadas en
Producción:

| Capacidad | Evidencia en Prod |
|---|---|
| Supresión / DSAR (mig 112, 113, 115, 120) | **Ninguna.** `provider_suppressions` y ambas tablas de auditoría de supresión están **vacías** |
| Aprobación atómica a contacto oficial (mig 116) | **Mínima.** 1 fila en `contact_phones`, 1 en `contact_phone_sources` |
| Merge en contacto existente (mig 117) | **Ninguna verificada** en esta auditoría |
| Un reveal de Apollo que devuelva **2 o más** teléfonos | **Ninguna.** Todos los candidatos con colección tienen 1 número de Apollo |
| Waterfall que caiga realmente a la pata de Lusha | **Ninguna.** La única corrida `full_waterfall` terminó en `completed_apollo` con `lusha_attempted_at = NULL` |
| Sobregasto de proveedor (mig 121) | **Ninguna** en el camino de 2A |

> La ausencia de evidencia de producción **no** es evidencia de defecto. Es una afirmación sobre
> qué se ha visto funcionar con dinero real y qué sólo se ha visto funcionar en pruebas.

**Ninguna de estas QAs pendientes está bloqueada por presupuesto.** Desde 2026-08-20 la política
operativa vigente tiene regla **activa** para Apollo (`global`, mensual) y para Lusha (`role` =
`admin`, mensual), así que el reveal normal y «Buscar más números» tienen los dos presupuesto
**resoluble** — ver [BUDGET_AND_BILLING.md](BUDGET_AND_BILLING.md) § 8.1. Lo que sigue faltando es
**ejecutar** las corridas, y cada una exige autorización explícita de gasto.

---

## 6. Corridas de teléfono no terminales

**0.** No hay ninguna corrida atascada, ni ninguna reserva de crédito activa (4 `confirmed`,
1 `released`). El subsistema está en reposo limpio.

---

## 7. Casos de aceptación de los cambios de octubre 2026

> **Estado:** casos definidos, **sin evidencia de Producción registrada** al 2026-10-06. Cada fila
> se marca como verificada sólo con la fecha y la consulta o captura que la prueba. Detalle y
> orden de trabajo en [BACKLOG.md](BACKLOG.md).

| Caso | PR | Pasos | Esperado | Estado |
|---|---|---|---|---|
| Company ID existente (BANCO ACTINVER) | #587 | Escribir el ID de la empresa en Enriquecer contactos | Trae nombre, dominio y owner de HubSpot; no crea empresa manual | Pendiente |
| Company ID inexistente | #587 | Escribir `999999999999` | Mensaje «no encontramos este ID»; no crea empresa ni gasta créditos | Pendiente (hoy cae en el mensaje genérico, BACKLOG A2) |
| Búsqueda sin candidatos | #608 | Enriquecer una empresa sin resultados | Mensaje «No se encontraron contactos», no «candidatos listos» | Pendiente |
| Candidato sin cuenta (Pizza Pizza) | #602 | Reasignar empresa en Trazabilidad y aprobar | Aprueba contra la cuenta reasignada sin volver a cobrar | Pendiente |
| Empresa creada en HubSpot después de la búsqueda (Tostadas Charras) | #602 | Reasignar a la empresa ya creada y aprobar | Aprueba y sincroniza con la empresa correcta | Pendiente |
| Contacto que ya existía en HubSpot | #612 | Aprobar un candidato cuyo email ya está en HubSpot | `linked_existing` y sólo se llenan las propiedades vacías | Pendiente |
| Lote de Company IDs | #616 | Pegar 3 IDs (uno inexistente) en el panel del agente | Reporte con 2 empresas procesadas y 1 en «Empresas no encontradas en HubSpot» | Pendiente |
| Contactos enviados a revisión que no aparecen (2026-10-01) | — | Revisar el run en Supabase | Explicado por #587 o #608; si no, abrir fix | Pendiente (BACKLOG A4) |

