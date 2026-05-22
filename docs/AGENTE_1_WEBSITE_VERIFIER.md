# Agente 1 — Website Verifier (Hito 3B)

**Versión:** 1.0  
**Fecha:** 2026-05-22  
**Archivo:** `src/server/agents/prospecting-toolkit/website-verifier.ts`

---

## Objetivo

Verificar si un sitio web existe y corresponde razonablemente a una empresa candidata, sin usar IA ni llamar a APIs de terceros (Apollo, Lusha, HubSpot).

---

## Por qué existe

En el Prompt Lab V2 se detectó que algunas URLs inferidas por el LLM fallaban o redirigían a otro dominio (empresa local vs. matriz global, dominios plausibles pero incorrectos). El Website Verifier reduce ese riesgo antes de presentar una empresa como candidata fuerte.

**Regla clave:** el LLM no es fuente de verdad para websites. Esta tool verifica la realidad.

---

## Input

```typescript
type WebsiteVerificationInput = {
  candidateName: string;          // Nombre de la empresa candidata
  websiteOrDomain?: string | null; // URL o dominio (con o sin protocolo)
  country?: string | null;         // País (contexto, no usado en v1)
  countryCode?: string | null;     // Código de país (contexto, no usado en v1)
  expectedDomain?: string | null;  // Dominio esperado (contexto, no usado en v1)
  timeoutMs?: number;              // Timeout HTTP (default: 8000ms)
}
```

**Formatos aceptados para `websiteOrDomain`:**
- `https://www.siigo.com`
- `siigo.com`
- `www.siigo.com/co`
- `rappi.com`

---

## Output

```typescript
type WebsiteVerificationOutput = {
  status: WebsiteVerificationStatus; // Estado principal
  website: string | null;            // URL normalizada con protocolo
  domain: string | null;             // Dominio del input (sin www, sin path)
  finalUrl: string | null;           // URL final tras redirects
  finalDomain: string | null;        // Dominio final tras redirects
  httpStatus: number | null;         // HTTP status code
  redirected: boolean;               // Si hubo algún redirect
  redirectChain: string[];           // Cadena de URLs intermedias
  title?: string | null;             // <title> de la página
  metaDescription?: string | null;   // Meta description
  evidence: string[];                // Señales usadas para clasificar
  confidence: number;                // 0–100
  skipped: boolean;                  // Si fue skipped por falta de input o bloqueo
  skipReason?: string | null;        // Razón del skip
  error?: string | null;             // Detalle del error si aplica
  metadata?: Record<string, unknown>; // nameScore, inputDomain, finalDomain
}
```

---

## Estados

| Estado | Condición | Confianza |
|--------|-----------|-----------|
| `verified` | HTTP 2xx–3xx, dominio compatible, title/meta confirman nombre | 80–95 |
| `inferred` | Sitio responde pero title/meta confirman parcialmente, o hubo redirect no problemático | 55–79 |
| `mismatch` | Dominio final corresponde a otra empresa, o title/meta contradicen el nombre | 20–50 |
| `not_found` | Sin input, dominio inválido, DNS/HTTP no resuelve, 404/410 | 0–20 |
| `error` | Timeout, error de red, bloqueo de seguridad (SSRF) | 0–10 |

---

## Seguridad — Protección Anti-SSRF

El verifier bloquea toda URL que pueda apuntar a recursos internos o privados:

### Protocolos bloqueados
- `file:`, `javascript:`, `data:`, `ftp:`, `blob:`
- Solo se permiten `https:` (preferido) y `http:`

### Hosts bloqueados
- `localhost`, `localhost.localdomain`, `*.local`, `*.internal`, `*.localhost`
- IPv4 loopback: `127.x.x.x`
- IPv4 privadas: `10.x.x.x`, `172.16–31.x.x`, `192.168.x.x`
- IPv4 link-local: `169.254.x.x`
- Carrier-grade NAT: `100.64–127.x.x`
- IPs reservadas: `0.x.x.x`, `240.x.x.x`
- IPv6 loopback: `::1`
- IPv6 link-local: `fe80::`

Cuando se bloquea una URL: `status: "error"`, `skipped: true`, `skipReason: "blocked_private_or_local_host"`.

### Otras protecciones
- Máximo 3 redirects
- Timeout configurable (default 8 segundos)
- Solo se leen los primeros 50 KB de HTML (no se guarda HTML completo)
- No se imprime ningún header de respuesta
- No se hace crawling profundo

---

## Reglas de matching de empresa

El score se calcula sin IA, mediante matching léxico de tokens:

1. **Normalizar** el nombre candidato: minúsculas, sin tildes, sin sufijos legales (SAS, Ltda, Inc…), sin stopwords.
2. **Tokenizar** en palabras significativas (> 1 carácter, no stopword).
3. **Comparar tokens** contra domain (peso 40%), title (peso 40%), metaDescription (peso 20%).
4. **Score 0–100**: proporción de tokens encontrados × peso del campo.

**Ejemplos:**

| candidateName | domain | title | score | status |
|---------------|--------|-------|-------|--------|
| `Siigo` | `siigo.com` | `Siigo \| Software Contable` | 100 | `verified` |
| `Rappi` | `rappi.com.co` | `Pide comida - Rappi Colombia` | 100 | `verified` |
| `Sophos Solutions` | `sophos.com` | `Sophos Cybersecurity` | ~30 | `inferred` |
| `Empresa ABC` | `otramarca.com` | `Otra Marca \| Inicio` | 0 | `mismatch` |

---

## Casos de prueba validados (2026-05-22)

| Caso | Input | Resultado esperado | Resultado obtenido |
|------|-------|-------------------|-------------------|
| 1 — Website válido | `Siigo` / `https://www.siigo.com` | `verified` o `inferred` | ✅ `verified`, conf 95, HTTP 200 |
| 2 — Sin protocolo | `Rappi` / `rappi.com` | `verified` o `inferred` | ✅ `verified`, conf 95, HTTP 200, redirect |
| 3 — Falta website | `Empresa Sin Web` / `null` | `not_found`, skipped | ✅ `not_found`, skipped true |
| 4 — Dominio QA inválido | `Empresa QA` / `dedup-qa-2026.example.com` | `not_found` o `error` | ✅ `error`, conf 5 |
| 5 — localhost bloqueado | `Localhost` / `http://localhost:3000` | `error` o `not_found`, skipped | ✅ `error`, skipped true |
| 6 — IP privada bloqueada | `IntraNet` / `http://192.168.1.1` | `error` o `not_found`, skipped | ✅ `error`, skipped true |
| 7 — Protocolo javascript: | `XSS` / `javascript:alert(1)` | `error` o `not_found`, skipped | ✅ `not_found`, skipped true |

---

## Límites conocidos

- No valida certificados SSL expirados (el fetch puede fallar con `error`).
- No distingue entre empresa local y matriz global (ej. `rappi.com` vs `rappi.com.co`); en ese caso retorna `verified` si el nombre aparece.
- No sigue más de 3 redirects; cadenas más largas terminan en el último estado disponible.
- El matching es léxico, no semántico: marcas con nombres muy cortos (1 token) pueden tener falsos positivos bajos.
- No verifica HTTPS válido forzado; si `https://` falla por certificado, no intenta `http://` como fallback.
- Sitios con protección anti-bot (Cloudflare, etc.) pueden retornar 403/429 → `not_found`.

---

## Próximos pasos

1. **Integrar con Web Search Tool** (Hito 3A): usar el verifier para filtrar resultados de búsqueda antes de pasarlos al agente.
2. **Integrar con Candidate Scorer**: `confidence` y `status` del verifier alimentan el score final de una empresa candidata.
3. **Mejorar matching**: detectar dominios con sufijo de país (`rappi.com.co` ↔ `rappi.com`) como `verified` en lugar de `inferred`.
4. **Fallback http**: si `https://` falla con error de certificado, intentar `http://` como fallback controlado.
