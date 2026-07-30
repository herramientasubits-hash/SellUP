# Apollo Phone Reveal — Recovery L2 programado

**Hito:** APOLLO-PHONE-RECOVERY-CRON-1
**Estado:** implementado, **flag OFF en todos los entornos**

---

## 1. Problema que resuelve

Los candidatos se quedaban pegados en **"Revelación en proceso"** para siempre.

Diagnóstico:

1. **El webhook de Apollo no está aterrizando.** En Producción hay candidatos con
   `phone_reveal_status` en vuelo (`requested` / `pending`) y
   `phone_reveal_webhook_received_at` **NULL**.
2. **No existía recovery automático (L2).** El recovery L1 (1 GET a
   `webhook_result`) ya estaba implementado y funciona, pero solo lo disparaba un
   admin a mano. Los únicos casos resueltos lo fueron por recovery manual.
3. **La UI no se actualiza sola.** El spinner sugería que el resultado llegaría a
   esa pantalla si el usuario esperaba. No es así.

Este hito arregla (2) y (3), y documenta (1).

---

## 2. Diagnóstico del webhook

**Ruta:** `POST /api/integrations/apollo/phone-reveal/webhook`
(archivo: `src/app/api/integrations/apollo/phone-reveal/webhook/route.ts`)

También responde `GET` / `HEAD` / `OPTIONS` y un `POST` "ping" con 2xx — pero
**solo con token válido** — porque Apollo prevalida la `webhook_url` y un no-2xx
haría que rechazara el reveal con HTTP 422.

### Variables de entorno

| Variable | Quién la usa | Para qué |
|---|---|---|
| `APOLLO_PHONE_REVEAL_WEBHOOK_URL` | START (`phone-reveal-actions.ts`) | URL pública que se envía a Apollo como `webhook_url`. Sin ella el START devuelve `provider_not_configured` y no llama a Apollo. |
| `APOLLO_PHONE_REVEAL_WEBHOOK_TOKEN` | Webhook route | Secreto que autoriza el callback. Ausente ⇒ el webhook devuelve **401 a todo** (fail-closed). |

### Cómo se construye la `webhook_url`

```
APOLLO_PHONE_REVEAL_WEBHOOK_URL  (tal cual, desde env)
  → appendOpaqueWebhookRef(...)  añade ?ref=<uuid opaco>, preservando el resto
  → se manda a Apollo como webhook_url
```

`appendOpaqueWebhookRef` **preserva** los query params existentes (incluido
`token`). El callback valida el token desde el query param `token` o el header
`x-apollo-webhook-token`.

### Causa raíz — CONFIRMADA

**El proxy de sesión intercepta el webhook y lo redirige a `/login` (307) antes de
que corra el handler.** Apollo nunca llega ni al chequeo del token, así que
`phone_reveal_webhook_received_at` no se escribe jamás.

`src/proxy.ts` es el middleware de Next 16 (el archivo se llama `proxy.ts`, no
`middleware.ts` — de ahí que una búsqueda de `middleware.ts` no lo encuentre).
Protege por sesión **todo** lo que no esté en una allowlist explícita, y el webhook
de Apollo **no estaba en ella**:

```
'/((?!_next/static|_next/image|favicon.ico|api/health
   |api/integrations/slack/oauth/callback|api/integrations/samu/webhook
   |api/cron/enrich|…).*)'
```

Apollo hace un POST de máquina, sin cookie de Supabase ⇒ `isAuthenticated=false` ⇒
`NextResponse.redirect('/login')`.

#### Evidencia (Producción, black-box, sin secretos)

| Petición | Resultado |
|---|---|
| `GET /api/health` | `200` (excluida del proxy) |
| `GET /api/cron/enrich` | `401` (excluida; su propio gate de secreto responde) |
| `GET\|POST\|HEAD\|OPTIONS /api/integrations/apollo/phone-reveal/webhook` | **`307 → /login`** |
| `GET /api/ruta-inexistente` | `307 → /login` (idéntico) |

El build log del deployment de Producción confirma que la ruta **sí** está
desplegada (`ƒ /api/integrations/apollo/phone-reveal/webhook`) y que hay un
`ƒ Proxy (Middleware)` activo: el endpoint existe, pero el proxy lo intercepta.

#### Arreglo incluido en este hito

`src/proxy.ts` añade a la allowlist:

- `api/integrations/apollo/phone-reveal/webhook` → **arregla la causa raíz**.
- `api/cron/phone-reveal-recovery` → sin esto el cron nuevo también recibiría
  `307 → /login`, porque Vercel Cron tampoco manda cookie de sesión.

Ambos endpoints se autentican por su cuenta y son fail-closed (token compartido /
`CRON_SECRET`), así que salir de la protección de sesión no debilita nada. Además
las exclusiones ahora terminan en `(?:$|/)`, de modo que abren exactamente su
endpoint y no vecinos por prefijo.

> ⚠️ **Deuda detectada, fuera de alcance:** `api/cron/post-approval-nit-enrich`
> tampoco está en la allowlist, así que ese cron también recibiría `307 → /login`.
> No se toca aquí (no es phone reveal y activarlo tiene implicaciones de gasto).

#### Envs verificadas por NOMBRE en Producción (valores nunca leídos)

| Variable | Presencia |
|---|---|
| `APOLLO_PHONE_REVEAL_WEBHOOK_URL` | ✅ presente |
| `APOLLO_PHONE_REVEAL_WEBHOOK_TOKEN` | ✅ presente |
| `CRON_SECRET` | ✅ presente (Production + Preview) |
| `ENABLE_APOLLO_PHONE_REVEAL_RECOVERY_CRON` | ❌ ausente (el flag nuevo, OFF) |

Las dos envs del webhook estaban configuradas: el problema **no** era falta de
configuración, era el proxy.

#### Causas secundarias que quedan por descartar tras el fix

Con el proxy arreglado, si el webhook sigue sin aterrizar, verificar (en este
orden):

1. Que `APOLLO_PHONE_REVEAL_WEBHOOK_URL` traiga `?token=<secreto>` incrustado:
   Apollo hace un POST plano y **no** puede enviar el header
   `x-apollo-webhook-token`, así que sin token en la URL el handler responde 401.
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$APOLLO_PHONE_REVEAL_WEBHOOK_URL"
   ```
   `200` ⇒ el token viaja bien. `401` ⇒ falta el token en la URL.
2. Que la URL apunte al dominio de **Producción** y no a un alias de preview.

Apollo **no** expone logs de entrega de webhooks: los logs de la función en Vercel
son el único lado observable. El recovery L2 existe justo para que un webhook
perdido deje de ser terminal aunque algo de esto vuelva a romperse.

**Este hito no cambia ninguna env ni redeploya nada.**

---

## 3. Recovery L2 programado

**Endpoint:** `GET|POST /api/cron/phone-reveal-recovery`
(sigue el patrón `/api/cron/<nombre>` que ya usa el repo)

**Agenda:** `vercel.json` → `0 13 * * *` (**una vez al día**, solo Producción).

> ### ⚠️ El plan de Vercel limita la frecuencia
>
> La primera versión de este hito agendaba `*/15 * * * *` (cada 15 min) y **Vercel
> rechazó el deployment** antes de construir (duración 0), enlazando a la
> documentación de *Cron Jobs — usage and pricing*: el plan del proyecto solo
> permite **un disparo diario** (y máximo 2 crons por proyecto).
>
> Por eso la agenda comprometida es diaria. Dos formas de recuperar cadencia real:
>
> 1. **Upgrade de plan** → cambiar el `schedule` a `*/15 * * * *` en `vercel.json`
>    (una línea).
> 2. **Scheduler externo** (recomendado hoy): el endpoint es un HTTP normal con
>    secreto, así que n8n / GitHub Actions / cualquier scheduler puede llamarlo con
>    la cadencia que se quiera:
>    ```bash
>    curl -X POST "https://<prod-host>/api/cron/phone-reveal-recovery" \
>      -H "Authorization: Bearer $CRON_SECRET"
>    ```
>    Cada corrida sigue respetando los mismos topes (5 candidatos, 1 GET cada uno,
>    0 créditos): llamarlo más seguido no relaja ninguna garantía.
>
> Con la agenda diaria, un candidato cuyo webhook se pierda se desatasca en ≤24 h
> en vez de nunca. Es una mejora real, pero **no** sustituye el arreglo del proxy
> (sección 2), que es lo que hace que el webhook vuelva a aterrizar en minutos.

### Doble candado para activarlo

| Candado | Efecto si falta |
|---|---|
| `CRON_SECRET` (header `Authorization: Bearer …`) | **401**, cero trabajo. Sin la env configurada, **nadie** entra (fail-closed). |
| `ENABLE_APOLLO_PHONE_REVEAL_RECOVERY_CRON=true` | **200 `disabled`**, cero trabajo: no selecciona candidatos, no consulta Apollo, no escribe. |

Vercel Cron manda el header `Authorization: Bearer $CRON_SECRET` automáticamente
cuando la env existe. Con el flag apagado —el default— **mergear y deployar este
hito no arranca ningún poll**.

### Selección de candidatos

Un candidato entra en la corrida solo si cumple **todo**:

- `phone_reveal_provider = 'apollo'`
- `phone_reveal_status ∈ ('requested', 'pending')` → nunca terminales
- `phone_reveal_request_id IS NOT NULL` → hay algo que correlacionar
- `phone IS NULL` → no se re-consulta un teléfono que ya tenemos
- `phone_reveal_requested_at <= now - minAgeMinutes` → **nunca recientes**

Orden **FIFO** (los más antiguos primero), `LIMIT` = tope de la corrida.

| Parámetro | Default | Límite |
|---|---|---|
| `maxCandidates` | 5 | hard cap **10** |
| `minAgeMinutes` | 15 | suelo **10** (ventana que se le concede al webhook) |

### Garantías por corrida

- **Exactamente 1 GET** a `webhook_result/{apollo_http_request_id}` por candidato.
- **Sin retry** dentro de la corrida: lo que siga en vuelo se resuelve en la
  siguiente.
- **Reutiliza el recovery id ya persistido** (del START log,
  `metadata.apollo_trace.apollo_http_request_id`). **No inicia reveals nuevos**: no
  llama `/people/match`, no manda `reveal_phone_number`.
- **0 créditos nuevos**: solo lee un resultado que un reveal ya autorizado produjo.
- **Supresión respetada siempre**: el tombstone se comprueba dentro del recovery
  core con la caché encendida o apagada, y bloquea la persistencia del teléfono. Si
  la comprobación no se puede evaluar, tampoco se persiste (fail-closed) y el caso
  cuenta como `failed`.
- Escribe `phone_reveal_last_checked_at` en cada poll.
- **No** crea contactos oficiales, **no** aprueba candidatos, **no** escribe
  HubSpot, **no** toca Lusha.

### Observabilidad

- `console.info('[phone-reveal-recovery-cron]', {…})` con **solo conteos**:
  `checked / recovered / still_pending / no_phone_found / failed / skipped`,
  `dry_run`, `max_candidates`, `min_age_minutes`.
- Un rechazo registra el motivo mecánico (`cron_secret_not_configured` /
  `_missing` / `_mismatch`) **solo en el log**: la respuesta HTTP no distingue los
  casos.
- Cada poll deja una fila en `provider_usage_logs` con
  `reveal_phase = 'recovery_poll'`, PII-free.
- Ningún log ni respuesta lleva teléfono, email, LinkedIn, nombre, empresa, ids de
  candidato, API key, token ni el payload crudo de Apollo.

### Dry run

`?dryRun=1` (o `dryRun=true`) selecciona y **cuenta** sin consultar Apollo y sin
escribir. Es la primera pasada recomendada tras activar el flag.

---

## 4. UI

Mientras el reveal está en vuelo (`requested` / `pending`) el detalle del candidato
ahora dice:

> **Revelación en proceso** — Apollo puede tardar. SellUp revisará automáticamente
> el resultado.
> Última revisión: 30 de julio de 2026, 14:07
> Vuelve a abrir el candidato más tarde para ver el resultado.

- "Última revisión" solo aparece si `phone_reveal_last_checked_at` tiene valor
  (candidatos legacy y reveals sin comprobar no muestran la línea).
- **No se añadió polling**: sería un `setInterval` por candidato abierto para un
  evento que tarda minutos. La honestidad del copy resuelve el problema real.
- El botón "Revelar teléfono" **sigue oculto** mientras el reveal está en vuelo:
  mostrar la última revisión no reactiva nada ni permite gastar créditos de nuevo.

---

## 5. Activación (pendiente de autorización)

1. **Verificar** que `CRON_SECRET` existe en Producción (por nombre).
2. **Merge + deploy** → el cron queda agendado pero responde `disabled`.
3. **Smoke con el flag apagado**: esperar un tick y confirmar `status: "disabled"`
   en los logs. 0 llamadas a Apollo, 0 escrituras.
4. **Activar el flag**:
   ```bash
   vercel env add ENABLE_APOLLO_PHONE_REVEAL_RECOVERY_CRON production   # true
   ```
   y redeployar.
5. **Primera pasada en dry run** (manual, con el secreto) para ver cuántos
   candidatos selecciona sin tocar Apollo.
6. **Dejar correr** y revisar `recovered` / `no_phone_found` / `still_pending`.

**Rollback:** `vercel env rm ENABLE_APOLLO_PHONE_REVEAL_RECOVERY_CRON production` +
redeploy. El endpoint vuelve a `disabled` de inmediato; quitar el cron de
`vercel.json` es opcional.

---

## 6. Tests

| Suite | Qué cubre |
|---|---|
| `npm run test:agent2a:phone-reveal-recovery-cron` | Autorización fail-closed, gate de flag, caps, selección (solo viejos en vuelo con recovery id), 1 GET por candidato, supresión, logs sin PII, candados estáticos. |
| `npm run test:agent2a:phone-reveal-recovery-cron-route` | El endpoint rechaza sin secreto / con secreto incorrecto / sin `CRON_SECRET`, acepta con secreto, `disabled` con flag off, `dryRun`, respuesta sin ids ni secretos. |
| `npm run test:proxy-machine-callbacks` | El webhook de Apollo y el cron del recovery quedan fuera de la protección de sesión (causa raíz), sin debilitar el resto de rutas. |
| `npm run test:agent2a:phone-reveal-stale-ui` | Copy honesto, última revisión mostrada/omitida, el botón no se reactiva en vuelo. |

Todo offline: 0 llamadas a Apollo, 0 a Lusha, 0 créditos, 0 escrituras en Supabase.
