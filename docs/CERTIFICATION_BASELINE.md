# Línea base de certificación de proveedores

**A1-CERTIFICATION-BASELINE § CUT-C.3** · 2026-09-11
**PROVIDER_CALLS = 0 · PROD_WRITES = 0 · MIGRACIONES = 0 · BUDGET_CHANGES = 0**

Objetivo: conservar una corrida de Apollo y una de Lusha de forma que un
proveedor nuevo pueda compararse contra ellas **sin volver a pagar a los dos
anteriores**.

---

## 1. Auditoría: qué se puede persistir HOY

Verificado contra Producción (`lrdruowtadwbdulndlph`) el 2026-09-11, sólo lectura.

### 1.1 Lo que YA existe y sirve

`provider_usage_logs` es la espina dorsal y ya lleva, en columnas de primera clase:

| necesidad | columna | estado |
|---|---|---|
| provider | `provider_key` | ✅ |
| wizard_run_id | `wizard_run_id` | ✅ (migración 100) |
| batch_id | `batch_id` | ✅ |
| request fingerprint | `request_fingerprint` | ✅ |
| credits | `credits_used` | ✅ |
| response metadata | `metadata` (JSONB) | ✅ |
| latency | `duration_ms` | ⚠️ ver 1.3 |
| timestamps | `created_at` | ✅ (sólo inicio) |
| desenlace de corrida | `status`, `error_code` | ✅ |

**La correlación entre piernas ya funciona.** Una corrida real del waterfall
(`wizard_run_id = 294298cdd4fa9c37baf9a33543cb1355`, 2026-09-08) tiene 2 filas de
Apollo y 1 de Lusha bajo el mismo id y el mismo lote. Unir Apollo con Lusha **no
requiere tabla nueva**.

`country`, `macro_industry`, `pages`, `companies seen/rejected`, `dedupe` y las
disposiciones también existen — dentro de `metadata`, o en
`prospect_discarded_dispositions` y `prospect_candidates`.

### 1.2 🔴 El hallazgo central: los dos proveedores no son comparables hoy

Apollo y Lusha publican **dos vocabularios distintos para las mismas preguntas**:

- Apollo → `apollo_benchmark_funnel`, `apollo_pagination`, `apollo_paid_volume`, `country`, `industry`, `round_number`…
- Lusha → `lusha_run_observability` (con su propio `run.branches`)

Y sobre todo:

> **`apollo_benchmark_funnel.accepted_for_target` es `null` en 16 de 16 filas de
> Producción.** Lusha sí publica `accepted_for_target_total`.

Sin ese numerador, **el rendimiento útil y el coste por empresa útil de Apollo no
son calculables** desde su fila de gasto. El propio bloque de Apollo ya declara la
costura:
`target_satisfaction_decided_by_candidate_writer_across_all_queries_not_correlated_back_to_search_usage_row`.

Esto **no se arregla con una migración**: es una costura de correlación entre el
writer de candidatos y la fila de búsqueda. Es el trabajo más caro pendiente y el
que de verdad bloquea una certificación honesta.

### 1.3 Lo que falta, nombrado

| campo | estado | costura |
|---|---|---|
| `certification_run_id` | ❌ **no existe** (0 tablas, 0 columnas) | agrupar varias corridas en una campaña no está escrito en ningún sitio |
| `provider_order` | ⚠️ **derivable** ordenando por `created_at` | frágil: dos filas del mismo instante lo invierten sin avisar |
| `companies_accepted` (Apollo) | ❌ `null` en 16/16 | ver 1.2 |
| `latency_ms` | ⚠️ parcial | 93/93 en `organizations_search`, 8/8 en `company_prospecting_v3`, **0/82 en `organization_enrichment`** |
| `finished_at` | ❌ | sólo se guarda `created_at` |
| `employee_count_known`, `identity_resolved` | ⚠️ | viven en `prospect_candidates`, no en la fila de gasto |
| disposiciones de una corrida sin lote | ❌ | ver 1.4 |

### 1.4 🔴 Las disposiciones de Lusha: 0 filas en Producción

`prospect_discarded_dispositions` tiene 61 filas, **todas de Apollo**. Ninguna de
Lusha, pese a que la trazabilidad se mergeó el 2026-09-08.

Causa (ver CUT-C.2 § G): `batch_id` es `NOT NULL REFERENCES prospect_batches(id)`,
y una corrida **standalone** que rechaza todo no crea lote ⇒ `batchId: null` ⇒ no
se escribe nada. Es el peor caso — **página pagada, nada admitido, cero rastro** —
y es justo el que la certificación más necesita ver.

---

## 2. Diseño

### 2.1 Sin tabla nueva

La línea base es una **proyección**, no un almacén. `src/modules/provider-certification/`
traduce lo que ya existe a un vocabulario único:

- `certification-baseline.ts` — el catálogo de campos y métricas, y la regla
  `observed` / `derived` / `missing` con costuras nombradas (idéntica a la que
  `apollo-benchmark-funnel.ts` ya estableció).
- `usage-log-adapters.ts` — un adaptador por proveedor.

**Añadir un proveedor nuevo = escribir su adaptador.** No hay que volver a correr
—ni pagar— Apollo ni Lusha: sus filas conservadas bastan.

### 2.2 Regla innegociable

Un campo que la corrida no puede producir con verdad se publica `null` y se nombra
en `fields_missing` + `missing_correlation_seams`. **Jamás como 0.**

Un `0` dice «lo medimos y salió cero». Un `null` dice «no lo medimos». Colapsar el
segundo en el primero es lo que hace que una certificación elija el proveedor
equivocado con total confianza.

### 2.3 Métricas

`useful_yield`, `precision` y `cost_per_useful` se calculan cuando sus insumos
existen y devuelven `null` cuando no. `coverage` y `overlap` son propiedades del
**conjunto** de identidades de dos corridas, no de una fila: se declaran en el
catálogo y se calculan fuera, cruzando `prospect_candidates.identity_key`.

---

## 3. Migración mínima propuesta — **NO EJECUTADA**

**MIGRACIONES = 0 en este corte.** Requiere autorización explícita separada.

### 3.1 Alcance mínimo (aditivo, sin reescribir nada)

```sql
-- (a) agrupar corridas en una campaña de certificación
ALTER TABLE provider_usage_logs
  ADD COLUMN IF NOT EXISTS certification_run_id text NULL,
  ADD COLUMN IF NOT EXISTS provider_order       smallint NULL,
  ADD COLUMN IF NOT EXISTS finished_at          timestamptz NULL;

CREATE INDEX IF NOT EXISTS provider_usage_logs_certification_run_idx
  ON provider_usage_logs (certification_run_id, provider_order)
  WHERE certification_run_id IS NOT NULL;

-- (b) que una corrida sin lote no pierda sus descartes (CUT-C.2 § G)
ALTER TABLE prospect_discarded_dispositions
  ALTER COLUMN batch_id DROP NOT NULL;
```

### 3.2 Impacto

| aspecto | impacto |
|---|---|
| Escrituras existentes | **ninguna**: las 3 columnas son nullable y nadie las lee hoy |
| Presupuesto / créditos | **ninguno**: no toca tablas de budget |
| RLS | **sin cambios** |
| Reversibilidad | (a) trivial; (b) **no trivial** — volver a `NOT NULL` exige purgar las filas huérfanas |
| Riesgo real | (b) **rompe la clave de idempotencia**: `UNIQUE (batch_id, source_key)` no distingue filas con `batch_id IS NULL`, así que hay que sustituirla por `UNIQUE (COALESCE(batch_id::text, certification_run_id), source_key)` **en la misma migración**, o una segunda corrida duplicará filas |

### 3.3 Lo que la migración NO arregla

`companies_accepted` de Apollo (§ 1.2). Ninguna columna lo resuelve: hay que
correlacionar la admisión del writer de candidatos con la fila de búsqueda. **Es
el trabajo que de verdad falta para que la certificación sea honesta**, y es
mayor que esta migración.

---

## 4. Recomendación

1. **Antes de gastar un crédito**, cerrar la costura de `accepted_for_target` de
   Apollo. Sin ella, la certificación no puede responder «¿cuál rinde más por
   crédito?» — que es la única pregunta que justifica pagarla.
2. La migración de § 3 puede esperar: `wizard_run_id` ya correlaciona las piernas
   y `provider_order` es derivable. `certification_run_id` sólo hace falta cuando
   haya **varias** campañas que distinguir.
3. El hueco de § 1.4 sí conviene cerrarlo antes de la corrida de certificación: si
   no, la corrida que más enseña —la que no admite nada— no dejará rastro.

---

# 5. CUT-E — de proyección a capacidad

**A1-CERTIFICATION-READINESS § CUT-E** · 2026-09-11
**PROVIDER_CALLS = 0 · PROD_WRITES = 0 · MIGRACIONES = 0 · BUDGET_CHANGES = 0 · FLAGS = 0**

El pre-flight de certificación sobre `3d5b0666` salió **BLOCKED**. Cuatro de sus
seis P0 eran defectos de código, y los cuatro compartían **una sola causa de
forma**: `usage-log-adapters.ts` proyectaba **una fila**, y la unidad real de una
certificación es **la corrida**.

## 5.1 Qué cambió

| corte | defecto | dónde va el fix |
|---|---|---|
| **E.1** | la aceptación de Apollo no llegaba a la línea base | **lado lector**: sale del replay por candidato de CUT-D.1 y la fila declara su procedencia |
| **E.2** | el módulo y el replay no tenían consumidor | `scripts/agent1/certification-baseline-replay.ts` |
| **E.3** | el coste omitía `organization_enrichment` | suma por corrida sobre las operaciones cobradas |
| **E.4** | el adaptador de Lusha leía camelCase | las claves reales de Producción |

## 5.2 🔴 Lo que deliberadamente NO cambió

`apollo_benchmark_funnel.accepted_for_target` **sigue siendo `null`**, y no es
una deuda: es el contrato correcto. La aceptación es un hecho de la **corrida**;
esa fila es de **una consulta**, y Producción tiene dos filas de búsqueda por
corrida. Estampar allí el total duplicaría la cifra — el lote `483f3584`
reportaría 10 en vez de 5. Una guarda estática exige que las dos construcciones
del embudo sigan publicando `null`.

`resolveAcceptedForTarget` (CUT-7) sigue siendo la única autoridad de aceptación.

## 5.3 🔴 El lote NO es el proveedor

`prospect_batches.metadata.accepted_for_target.accepted_paid_for_target` es la
aceptación de pago **del lote**, y en el waterfall Apollo y Lusha **comparten
lote**. Medido en Producción: el lote `483f3584` publica `accepted_paid_for_target: 5`
y sus 5 candidatos son de **Lusha**, con **0** de Apollo.

Usar esa cifra para contrastar la traza de Apollo declararía rota una correlación
intacta. Con dos proveedores en el lote el contraste **no se hace**: se declara
no comparable. No medir no es discrepar.

## 5.4 Coste completo de Apollo

Una corrida de Apollo paga **dos** operaciones bajo el mismo `wizard_run_id`.
Corrida `294298cd…`:

| operación | filas | créditos |
|---|---|---|
| `organizations_search` | 2 | 5 + 1 = **6** |
| `organization_enrichment` | 5 | 1 × 5 = **5** |
| **total** | 7 | **11** |

Sumar sólo la búsqueda subestima ~45% e **invierte** la comparación de coste por
empresa útil contra Lusha, que trae su gasto entero en su única fila.

El conjunto de operaciones cobradas se deriva de `ApolloUsageOperationKey`; la
exhaustividad la comprueba el **compilador** en las dos direcciones. Una fila
cobrada sin `credits_used` deja el **total en `null`**, nunca en un parcial que
parezca completo.

La **latencia de la corrida** sale `null` a propósito: `organization_enrichment`
no registra `duration_ms` en ninguna de sus 82 filas de Producción, y sumar sólo
las búsquedas publicaría como latencia de la corrida una cifra que deja fuera la
mitad de sus llamadas.

## 5.5 🔴 Asimetría declarada, nunca oculta

### Filtro PROVIDER-SIDE vs filtro LOCAL

| | Apollo | Lusha |
|---|---|---|
| país | provider-side (`organization_locations`) | provider-side |
| industria | provider-side (keyword packs) | provider-side (`mainIndustryId` [+ `subIndustryId`] por rama) |
| **tamaño ≥200** | **provider-side** (`organization_num_employees_ranges`, 7 buckets, techo implícito en 1.000.000) **+ local** | **sólo local** — CUT-C.1 retiró la banda para igualar standalone y waterfall |
| aceptación ICP | local (writer) | local (intake gate) |

### Procedencia de `companies_accepted`

| proveedor | autoridad | valor de `companies_accepted_source` |
|---|---|---|
| Apollo | veredictos **por candidato** del writer (CUT-D.1) | `per_candidate_writer_trace` |
| Lusha | total de corrida que el proveedor publica | `provider_run_total` |

Las dos responden la misma pregunta desde sitios distintos. La fila lo **dice**,
para que nadie lo descubra comparando.

## 5.6 P0-5 — aislamiento Apollo/Lusha: mecanismo OPERATIVO

**Este corte no lo implementa y no toca el waterfall.**

Con `ENABLE_AGENT1_APOLLO_LUSHA_WATERFALL` encendida, una corrida destinada a
medir Apollo puede terminar llamando a Lusha: la pierna dispara cuando
`waterfallEnabled && lushaAvailable && apolloTerminal && usefulAccumulated < target`.
Ninguno de los seis `LushaWaterfallSkipReason` es controlable sin tocar una
bandera, y `target_reached` no es garantía — si Apollo acepta 0, la pierna corre.

Mecanismo acordado, a aplicar **sólo dentro de la ventana de certificación y con
autorización explícita**:

```
ENABLE_AGENT1_APOLLO_LUSHA_WATERFALL=false
```

Una variable de entorno, cero código, el camino de Producción **exacto**, y el
skip pasa a rotularse `waterfall_flag_disabled` diciendo **la verdad**. Se
descartó inyectar dependencias en `executeProspectWizardGeneration` porque
mediría un camino distinto del que corre Producción, y se descartó una bandera
nueva por ser una segunda puerta sobre la misma política.

## 5.7 P0-6 — presupuesto: qué cabe realmente

**No se toca. Sigue siendo la restricción que manda.**

- **Apollo** — ~11 créditos por corrida, sobre su **cuota propia** (desacoplada
  de `wizard_monthly_budget_periods` desde #386). Las 12 macro ≈ 132 créditos.
  **No está bloqueado.**
- **Lusha** — septiembre 2026: `53 − 51 − 0` = **2 créditos**. Medido:
  1 rama = 1-2 créditos; 3 ramas (`health_pharma`) = 6.

| grupo | macro | ramas | coste estimado | ¿cabe en 2? |
|---|---|---|---|---|
| 1 rama | `technology`, `government`, `transport_logistics`, `insurance_financial_services`, `retail`, `industry_manufacturing_chemicals_automotive` | 1 | 1-2 | ✅ **una sola** |
| 2 ramas | `property_construction`, `consumer_goods`, `agroindustry` | 2 | 2-4 | ❌ |
| 3 ramas | `health_pharma`, `energy_mining_environment`, `services_company` | 3 | ~6 | ❌ |

Las 21 ramas completas piden **21-42 créditos**. **11 de las 12 macro son
imposibles** para Lusha hoy.

**Unidad certificable acordada: `Colombia × technology × {Apollo, Lusha}`** —
1 rama, precedente medido de 1 crédito, y con corridas previas que publican
`accepted_for_target_total` para contrastar.

## 5.8 Uso

```bash
npm run cert:baseline -- --wizard-run-id=<id>
```

Lee `provider_usage_logs`, `prospect_candidates`, `prospect_batches` y
`prospect_discarded_dispositions`; escribe en la salida estándar. **No llama a
ningún proveedor, no consume créditos y no escribe nada** — las tres cosas las
vigila una guarda estática sobre el propio fichero, no un comentario.
