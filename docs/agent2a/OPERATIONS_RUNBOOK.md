# Agente 2A — Runbook operativo

> Para un administrador o mantenedor. **Todo lo de este documento es READ-ONLY.**
> Ninguna consulta de aquí modifica datos, gasta créditos ni llama a proveedores.
>
> **Regla de PII:** ninguna consulta de este runbook devuelve teléfonos, emails ni ids de
> contacto de proveedor. Si necesitas identificar un caso concreto, usa el `candidate_id`
> (uuid opaco), nunca el nombre o el número.

---

## 0. La herramienta que resuelve el 80 % de los diagnósticos

```
GET /api/debug/agent2a-phone-waterfall-config     (admin-only)
```

Devuelve, **por separado**, presencia y valor resuelto de los tres flags de teléfono:

| Campo | Pregunta que responde |
|---|---|
| `phone_reveal_waterfall_flag_configured` | ¿La variable **existe** en este runtime? |
| `phone_reveal_waterfall_enabled_resolved` | ¿El runtime la resuelve como **activa**? |
| `lusha_phone_reveal_fallback_flag_configured` / `…_enabled_resolved` | Idem para el fallback manual de Lusha |
| `search_more_phones_flag_configured` / `…_enabled_resolved` | Idem para «Buscar más números» |

**Por qué son dos campos y no uno.** En Vercel estos flags son `type: sensitive`: su valor es
ilegible para siempre (ni la API con `?decrypt=true` lo devuelve), así que `vercel env ls` sólo
prueba **presencia**. Los dos juntos distinguen los **tres** casos:

| `configured` | `resolved` | Significa |
|---|---|---|
| `false` | `false` | La variable **no existe** en este runtime |
| `true` | `false` | Existe **pero su valor no es exactamente `"true"`** |
| `true` | `true` | Presente y **activa** |

El endpoint llama a las **mismas** funciones que gobiernan producción — no duplica el parseo,
porque una segunda implementación podría discrepar y entonces el diagnóstico mentiría con toda
confianza. Es de sólo lectura, no toca proveedores, no consume créditos y no expone PII ni
secretos.

---

## A. El enriquecimiento no arranca

1. **¿Existe la cuenta y está activa?** Una cuenta archivada (`archived_at IS NOT NULL` o
   `pipeline_status = 'archived'`) bloquea la creación de contactos
   (`checkAccountActiveForContact`).
2. **¿Se queda en «Buscando en SellUp y HubSpot…»?** Es el síntoma del incidente #279. Hoy la
   petición lleva `AbortSignal.timeout` y los tres pasos del wizard capturan el rechazo, así que
   el estado de carga **siempre** se cierra. Si lo ves otra vez, es una regresión de ese arreglo.
3. **¿Dice «la empresa no existe en HubSpot»?** Distingue: `null` significa «HubSpot no se pudo
   consultar»; un array vacío significa «HubSpot contestó que no hay coincidencias». Antes de
   #279 los dos se veían igual.
4. **Estado de la corrida:**

```sql
SELECT id, status, providers_used, intended_provider, routing_mode,
       provider_attempt_role, fallback_reason, created_at, updated_at
FROM public.contact_enrichment_runs
WHERE account_id = '<uuid>'
ORDER BY created_at DESC LIMIT 5;
```

5. **¿Lusha desactivado?** `ENABLE_LUSHA_CONTACT_ENRICHMENT` gobierna el proveedor secundario.
   Con él apagado el runner devuelve
   `Lusha contact enrichment is disabled (ENABLE_LUSHA_CONTACT_ENRICHMENT=false).` **antes** de
   cualquier llamada de red. `src/server/services/lusha-credential-diagnostics.ts` distingue
   además un problema de credencial de un problema de flag.

---

## B. El reveal de teléfono no arranca

Recorre las condiciones **en este orden**, que es el orden en que el servidor las evalúa:

| # | Condición | Cómo comprobarla |
|---|---|---|
| 1 | Permiso de producto | `phone_reveal_waterfall_enabled_resolved` en el endpoint de debug |
| 2 | Rol | Sólo `admin`. `commercial_manager` conserva el flujo Apollo-only y **nunca** obtiene fila de corrida |
| 3 | Candidato editable | `status` ∉ {`approved`, `rejected`, `discarded`, `archived`} |
| 4 | **Identidad de supresión evaluable** | Ver § D. Es la causa más frecuente |
| 5 | Presupuesto | Ver § E |
| 6 | Privacidad | Ver § D |
| 7 | Sin corrida activa | Ver § F |

```sql
-- ¿Hay una corrida activa que esté bloqueando el botón?
SELECT id, run_mode, status, authorized_at, apollo_attempted_at, lusha_attempted_at,
       max_credits_authorized, credit_reservation_group_id
FROM public.phone_reveal_waterfall_runs
WHERE candidate_id = '<uuid>'
ORDER BY created_at DESC LIMIT 5;
```

**No terminales:** `authorized`, `apollo_in_flight`, `lusha_pending`, `lusha_running`.
**Terminales:** `completed_apollo`, `completed_lusha`, `exhausted`, `error`, `aborted`.

---

## C. «Buscar más números» no aparece

**Importante:** un permiso de producto apagado se resuelve **no renderizando**. El copy de
`feature_disabled` es `null` a propósito. Por tanto «no hay CTA y no hay explicación» es
**indistinguible a ojo** de un preflight roto. Distinguirlos exige leer el flag en el runtime que
estás mirando.

1. `search_more_phones_enabled_resolved` en el endpoint de debug. Si es `false`, **ésa es la
   respuesta**.
2. Si es `true`, el planificador devolvió una fase. Deriva cuál con esta consulta:

```sql
SELECT c.id,
       c.status,
       c.source,
       (c.source_contact_id IS NOT NULL)                   AS has_lusha_identity,
       (SELECT count(*) FROM public.contact_enrichment_candidate_phones p
         WHERE p.candidate_id = c.id AND p.suppressed_at IS NULL)        AS live_phones,
       (SELECT string_agg(DISTINCT s.provider, '+')
          FROM public.contact_enrichment_candidate_phone_sources s
          JOIN public.contact_enrichment_candidate_phones p2 ON p2.id = s.candidate_phone_id
         WHERE p2.candidate_id = c.id)                                   AS providers_stored,
       (SELECT count(*) FROM public.phone_reveal_waterfall_runs r
         WHERE r.candidate_id = c.id
           AND r.status NOT IN ('completed_apollo','completed_lusha','exhausted','error','aborted'))
                                                                          AS active_runs,
       (SELECT count(*) FROM public.phone_reveal_waterfall_runs r
         WHERE r.candidate_id = c.id AND r.run_mode = 'search_more')      AS search_more_runs
FROM public.contact_enrichment_candidates c
WHERE c.id = '<uuid>';
```

Lectura del resultado:

| Observación | Fase / motivo |
|---|---|
| `live_phones = 0` | `no_phone_yet` — corresponde «Revelar teléfono», no éste |
| `source <> 'lusha'` o `has_lusha_identity = false` | `missing_person_identity` |
| `providers_stored` contiene `lusha` | `no_additional_provider` — Lusha ya contestó |
| `search_more_runs > 0` (y terminal) | `providers_exhausted` — **incluido si terminó en error** |
| `active_runs > 0` | `active_run_exists` |
| Todo lo anterior OK pero no hay CTA | Sospecha **presupuesto**: ver § E |

---

## D. Distinguir las cinco causas de bloqueo

Ésta es la pregunta operativa más importante del subsistema, porque cinco cosas muy distintas
producen «el botón no está disponible».

| Causa | Señal decisiva | Dónde se ve |
|---|---|---|
| **Privacidad — suprimido** | Tombstone confirmado | `provider_suppressions` tiene fila para `(provider, provider_person_id)`; o `phone_reveal_cache.suppressed_at IS NOT NULL` |
| **Privacidad — no evaluable** | **No se pudo comprobar** | `lusha_skipped_reason = 'suppression_check_unavailable'`; o el candidato no tiene `apollo_person_id` resoluble |
| **Sin presupuesto** | `budget_not_configured` / `insufficient_credits` / `credit_balance_unavailable` | § E |
| **Proveedor agotado** | Ya hubo una corrida `search_more` terminal, o la procedencia de Lusha ya está en la colección | § C |
| **Falta identidad nativa** | `source <> 'lusha'` o `source_contact_id IS NULL` | § C |
| **Error del proveedor** | `status = 'error'`, `lusha_outcome = 'error'`, `error_code` poblado | Tabla de corridas |

### La distinción que más se confunde

```
suppressed                      →  "esta persona está suprimida"          (hecho comprobado)
do_not_contact                  →  "esta persona pidió no ser contactada" (hecho comprobado)
suppression_check_unavailable   →  "NO SE SABE"                           (ningún hecho)
```

Las tres bloquean igual, con 0 créditos. **Nunca las trates como equivalentes en un informe.**
Registrar la tercera como la primera es afirmar un hecho que nadie comprobó.

```sql
-- ¿Qué motivo registró exactamente la corrida?
SELECT id, run_mode, status, lusha_eligible, lusha_skipped_reason,
       lusha_outcome, error_code, completed_at
FROM public.phone_reveal_waterfall_runs
WHERE candidate_id = '<uuid>'
ORDER BY created_at DESC;
```

---

## E. Verificar créditos y presupuesto

```sql
-- Configuración vigente (NO expone consumo de ningún usuario concreto)
SELECT provider_key, scope_type, period_type, is_active,
       (limit_credits IS NOT NULL) AS has_credit_limit,
       (limit_usd     IS NOT NULL) AS has_usd_limit,
       on_exceed
FROM public.budget_rules
WHERE provider_key IN ('apollo','lusha')
ORDER BY provider_key, scope_type;
```

**Las tres trampas, en orden de frecuencia:**

1. **`is_active = false` no significa «sin límite»: significa `budget_not_configured`, y
   bloquea.** Desde 4E, sin regla activa no hay disponibilidad que reservar y el reveal **no
   arranca**.
2. **`limit_usd` no sustituye a `limit_credits`.** Este subsistema sólo sabe leer techos en
   **créditos**.
3. **El presupuesto es por proveedor.** Un waterfall completo exige **Apollo ≥ 8 Y Lusha ≥ 5 por
   separado**. Saldo de sobra en uno no compensa la falta en el otro.

**Estado en Producción a 2026-08-19:** Apollo tiene 4 reglas y **ninguna activa**; Lusha tiene 1
regla **activa** (scope `user`, mensual, en créditos, `on_exceed = block`).

> **Consecuencia inmediata:** hoy un `full_waterfall` o un `apollo_only` resuelve
> `budget_not_configured` y **no arranca**. «Buscar más números» y `legacy_lusha_only`, que sólo
> exigen el pozo de Lusha, **sí** pueden arrancar. Si alguien reporta «el reveal no funciona pero
> buscar más sí», **ésta es la explicación** y no un defecto.

**Disponibilidad real** = `limit_credits − consumido − reservado activo`. El consumo se agrega de
`provider_usage_logs` para ese `provider_key` dentro del período de la regla.

---

## F. Verificar reservas

```sql
SELECT id, reservation_group_id, run_id, provider_key, credits_reserved,
       credits_confirmed, cost_truth, status, release_reason,
       created_at, confirmed_at, released_at
FROM public.phone_reveal_credit_reservations
WHERE candidate_id = '<uuid>'
ORDER BY created_at DESC;
```

```sql
-- Salud global: ¿hay exposición retenida por corridas que ya terminaron?
SELECT res.status, count(*) AS n
FROM public.phone_reveal_credit_reservations res
LEFT JOIN public.phone_reveal_waterfall_runs r ON r.id = res.run_id
WHERE res.status = 'active'
  AND (r.id IS NULL
       OR r.status IN ('completed_apollo','completed_lusha','exhausted','error','aborted'))
GROUP BY res.status;
```

**Debe devolver 0 filas.** Si no, hay exposición sin liquidar. A 2026-08-19 devuelve 0.

`cost_truth` distingue `reported` de `unknown`. **Un `unknown` nunca se liquida como 0.**

---

## G. Verificar el usage log

```sql
SELECT id, provider_key, operation_key, credits_used, status, error_code,
       reservation_id, billing_state, created_at
FROM public.provider_usage_logs
WHERE reservation_id IN (
  SELECT id FROM public.phone_reveal_credit_reservations WHERE candidate_id = '<uuid>'
)
ORDER BY created_at;
```

**Apollo escribe DOS filas por reveal** (`start` = llamada real, `webhook` = recepción). Ver dos
filas de Apollo **no** significa que se haya cobrado dos veces.

El usage log de Search More se escribe **siempre que Lusha se llamó**, **antes** de intentar
persistir y **fuera** de la transacción de la 122 — precisamente para sobrevivir a un fallo de
ésta. Por eso puede existir un usage log **sin** número guardado: significa que se pagó y la
privacidad o la escritura bloquearon después. **Eso es correcto**, no una inconsistencia.

---

## H. Verificar la procedencia de un número

```sql
SELECT p.id AS phone_id, p.is_primary, p.phone_type, p.phone_status,
       p.suppressed_at IS NOT NULL AS suppressed,
       s.provider, s.acquisition_mode, s.raw_provider_type, s.raw_provider_status,
       s.waterfall_run_id, s.reservation_id, s.provider_usage_log_id,
       s.source_event_key, s.observed_at
FROM public.contact_enrichment_candidate_phones p
LEFT JOIN public.contact_enrichment_candidate_phone_sources s
       ON s.candidate_phone_id = p.id
WHERE p.candidate_id = '<uuid>'
ORDER BY p.is_primary DESC, s.observed_at;
```

**No selecciona `normalized_phone` ni `display_phone` a propósito.** Para diagnosticar
procedencia no hace falta ver el número.

Para el contacto **oficial**, la misma consulta sobre `contact_phones` / `contact_phone_sources`
filtrando por `contact_id`. Recuerda que ahí `suppressed_at` vive en la fila de **procedencia**.

---

## I. Verificar múltiples teléfonos

```sql
SELECT candidate_id,
       count(*)                                        AS total,
       count(*) FILTER (WHERE suppressed_at IS NULL)    AS live,
       count(*) FILTER (WHERE is_primary)               AS primaries
FROM public.contact_enrichment_candidate_phones
GROUP BY candidate_id
HAVING count(*) FILTER (WHERE is_primary) <> 1
    OR count(*) > 1;
```

**Invariante:** exactamente **un** `is_primary` vivo por candidato. Si la consulta devuelve una
fila con `primaries <> 1`, la re-elección atómica de la migración 112 no se ejecutó —
investígalo antes de tocar nada.

---

## J. Revisar una corrida sin exponer PII

Plantilla segura, apta para pegar en un ticket:

```sql
SELECT r.id, r.run_mode, r.status, r.authorized_by_role, r.max_credits_authorized,
       r.apollo_attempted_at IS NOT NULL AS apollo_tried,
       r.apollo_outcome, r.apollo_cost_credits, r.apollo_cost_source,
       r.lusha_eligible, r.lusha_skipped_reason,
       r.lusha_attempted_at IS NOT NULL  AS lusha_tried,
       r.lusha_outcome, r.lusha_cost_credits, r.lusha_cost_source,
       r.final_provider, r.error_code, r.completed_at,
       (SELECT count(*) FROM public.contact_enrichment_candidate_phones p
         WHERE p.candidate_id = r.candidate_id AND p.suppressed_at IS NULL) AS live_phones
FROM public.phone_reveal_waterfall_runs r
WHERE r.id = '<run-uuid>';
```

**Qué NO poner nunca en un ticket, informe o mensaje:**

* teléfonos, ni completos ni parcialmente enmascarados;
* emails, nombres completos, URLs de LinkedIn;
* `source_contact_id`, `provider_person_id` u otros ids de proveedor (son identificadores de
  persona en el espacio del proveedor);
* valores crudos de variables de entorno, API keys, la service-role key.

**Qué sí es seguro:** `candidate_id`, `run_id`, `reservation_id`, códigos mecánicos
(`lusha_skipped_reason`, `error_code`, `apollo_outcome`), conteos y timestamps.

---

## K. Salud global del subsistema

```sql
SELECT 'phone_runs_nonterminal' AS metric, count(*)::text AS value
  FROM public.phone_reveal_waterfall_runs
 WHERE status NOT IN ('completed_apollo','completed_lusha','exhausted','error','aborted')
UNION ALL SELECT 'reservations_active', count(*)::text
  FROM public.phone_reveal_credit_reservations WHERE status = 'active'
UNION ALL SELECT 'candidate_phones_live', count(*)::text
  FROM public.contact_enrichment_candidate_phones WHERE suppressed_at IS NULL
UNION ALL SELECT 'contact_phones', count(*)::text FROM public.contact_phones
UNION ALL SELECT 'search_more_terminal', count(*)::text
  FROM public.phone_reveal_waterfall_runs
 WHERE run_mode = 'search_more'
   AND status IN ('completed_apollo','completed_lusha','exhausted','error','aborted')
UNION ALL SELECT 'search_more_nonterminal', count(*)::text
  FROM public.phone_reveal_waterfall_runs
 WHERE run_mode = 'search_more'
   AND status NOT IN ('completed_apollo','completed_lusha','exhausted','error','aborted');
```

**Valores sanos:** `phone_runs_nonterminal = 0` en reposo (un valor > 0 sostenido durante más de
unos minutos indica una corrida atascada), `reservations_active = 0` en reposo.

---

## Apéndice · Auditoría de feature flags del Agente 2A

Todos se definen en [`src/lib/feature-flags.server.ts`](../../src/lib/feature-flags.server.ts).
Todos son **fail-closed**, por defecto `false`, y sólo el valor **exactamente `"true"`**
(insensible a mayúsculas, ignorando espacios) los enciende. **Ninguno es `NEXT_PUBLIC_*`**: se
resuelven en el servidor y viajan al cliente sólo como booleano.

| Flag | Qué controla | Lo consume | Depende de | Fail-closed |
|---|---|---|---|---|
| `ENABLE_LUSHA_CONTACT_ENRICHMENT` | Lusha como proveedor de **enriquecimiento** (no de teléfono) | `lusha-enrichment-runner.ts`, `contact-enrichment/actions.ts` | — | Devuelve *disabled* **antes** de cualquier llamada de red |
| `ENABLE_APOLLO_PHONE_REVEAL` | Autoriza **crear** un reveal de Apollo | `phone-reveal-actions.ts:363`, `contact-candidates-panel.tsx` | — | Sin él no hay reveal de Apollo |
| `ENABLE_PHONE_REVEAL_WATERFALL` | El waterfall Apollo→Lusha de **un** clic | server actions del waterfall, drawer, tabla | Necesita **también** el flag del fallback para la pata Lusha | Con él OFF **no se crea fila de corrida**, los hooks de continuación no se cablean y la UI renderiza los controles pre-waterfall |
| `ENABLE_LUSHA_PHONE_REVEAL_FALLBACK` | Autoriza **cualquier** reveal de Lusha | `lusha-phone-fallback-actions.ts`, drawer, 2ª pata del waterfall | — | Con él OFF la pata Lusha es `feature_disabled` **diga lo que diga** el flag del waterfall |
| `ENABLE_SEARCH_MORE_PHONES` | **Exclusivamente** «Buscar más números» | `search-more-phones-runtime.ts`, preflight, CTA | **Ninguno.** Independiente por diseño | Con él OFF el planificador devuelve `feature_disabled` |
| `ENABLE_APOLLO_PHONE_CACHE` | Reutilizar un reveal de Apollo ya pagado (90 días, mismo `account` + país, 0 créditos) | webhook, `phone-reveal-recovery-deps.ts`, `phone-reveal-actions.ts` | — | La **supresión funciona con el flag en cualquier estado**: una DSAR nunca queda bloqueada por un flag apagado |
| `ENABLE_APOLLO_PHONE_REVEAL_RECOVERY_CRON` | El **disparo programado** del recovery L2 | `/api/cron/phone-reveal-recovery` | — | Con él OFF el endpoint autentica y devuelve `200 disabled` **sin** seleccionar candidatos, sin el GET a Apollo y sin escritura |

### La dependencia y la independencia que hay que tener claras

**Dependencia (pata Lusha del waterfall):** exige `ENABLE_PHONE_REVEAL_WATERFALL` **Y**
`ENABLE_LUSHA_PHONE_REVEAL_FALLBACK`. **Los dos.**

**Independencia (Search More):** hasta 1G, «Buscar más números» reutilizaba
`ENABLE_LUSHA_PHONE_REVEAL_FALLBACK`. Eso acoplaba dos rollouts que el producto quiere
independientes: encender Search More para QA encendía **también** el fallback manual, el
`legacy_lusha_only` y la pata Lusha del waterfall — **tres caminos pagados preexistentes que
nadie pidió activar**. Desde 1H:

* `ENABLE_SEARCH_MORE_PHONES` gobierna **exclusivamente** «Buscar más números»;
* `ENABLE_LUSHA_PHONE_REVEAL_FALLBACK` gobierna exactamente lo que gobernaba antes, y
  **no se lee en ningún punto de «Buscar más números»**.

Ninguno activa al otro, en ninguna dirección. Hay un test estático de independencia
(`search-more-phones-flag-independence-static.test.ts`) que lo impone.

### Por qué el valor no se puede leer desde fuera

En Vercel estos flags son `type: sensitive`: su valor es **ilegible para siempre** — ni la API
con `?decrypt=true` lo devuelve, ni existe `env get`. `vercel env ls` sólo prueba **presencia**.

Por eso el código expone dos helpers por flag: `is…Enabled()` (valor resuelto) e
`is…FlagConfigured()` (**presencia**, nunca el valor — sólo la longitud tras `trim()`, reducida a
un booleano). El endpoint de debug publica ambos por separado. Ver § 0.

### Discrepancias de comentario detectadas

| Comentario | Realidad |
|---|---|
| `ENABLE_APOLLO_PHONE_REVEAL`: «As of PHONE-3D.1 it gates nothing at runtime: no route, server action, runner or UI reads it» | **Sí se lee**: `phone-reveal-actions.ts:363` y `contact-candidates-panel.tsx:65` |
| `lusha-phone-fallback-copy.ts`: el fallback está «OFF in every environment today» | El propio `feature-flags.server.ts` documenta que el flag **sí** está registrado en Vercel y que el fallback manual es una ruta **viva** en Producción cuando resuelve a `"true"` |

Se registran, **no se corrigen**: modificar comentarios de código está fuera del alcance de esta
auditoría.

> **No cambies ningún flag sin autorización explícita.** Encender uno de éstos habilita caminos
> que **gastan dinero real** contra la base de **Producción** — incluidos los deployments de
> Preview, que apuntan a la misma base.
