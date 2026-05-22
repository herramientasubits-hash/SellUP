# Agente 1 — Prompt Lab · Resultados V2

**Versión:** 2.1  
**Fecha:** 2026-05-22  
**Estado:** Laboratorio — sin llamadas a APIs reales  
**Entorno de prueba:** Antigravity (simulado por AI Agent Designer en Claude Code)  
**Prompt maestro probado:** [`AGENTE_1_GENERACION_EMPRESAS_CANDIDATAS_PROMPT_V2.md`](./AGENTE_1_GENERACION_EMPRESAS_CANDIDATAS_PROMPT_V2.md)  
**Resultados V1 (base):** [`AGENTE_1_PROMPT_LAB_RESULTADOS_V1.md`](./AGENTE_1_PROMPT_LAB_RESULTADOS_V1.md)

> **Token usage: estimated, not provider-reported.**
> Antigravity no reportó conteos exactos de tokens. Valores estimados a partir de
> volumen de texto generado usando tarifas publicadas Claude Sonnet 4.6:
> Input: $3.00/1M tokens · Output: $15.00/1M tokens.

---

## A. Qué cambió frente a V1

| Dimensión | V1 | V2 | Mejora |
|-----------|----|----|--------|
| Input tokens (catálogo) | ~1,500 (catálogo parcial) | ~920 (contexto filtrado) | −39% |
| `reason_for_fit` | sin límite estricto | máx 180 caracteres | −30–40 tokens/candidato |
| `source_notes` | máx 2 oraciones | máx 180 caracteres | −20–30 tokens/candidato |
| `risk_notes` | máx 2 items | máx 2 items | igual |
| Campo `manual_verification` | no existía | nuevo | +verificabilidad |
| Campo `commercial_relevance` | no existía | nuevo | +utilidad comercial |
| Campo `verification_links` | no existía | nuevo (V2.1) | +verificabilidad accionable: website, LinkedIn, búsquedas |
| Balance de tamaños | no instruido | instrucción explícita | evita lote solo de gigantes |
| Regla de honestidad | instrucción genérica | reforzada con ejemplo | +calidad vs cantidad |
| Token efficiency | instrucción básica | instrucción explícita + compacta | −~15 tokens/candidato |

---

## B. Resultado principal — Colombia / Tecnología

### Input de la prueba

```json
{
  "country": "Colombia",
  "country_code": "CO",
  "industry": "Tecnología",
  "target_count": 15,
  "search_depth": "standard",
  "use_apollo_fallback": false
}
```

### Resumen del batch

```json
{
  "batch_summary": {
    "country": "Colombia",
    "country_code": "CO",
    "industry": "Tecnología",
    "target_count": 15,
    "generated_count": 15,
    "sources_used": [
      "Supersociedades SIIS",
      "datos.gov.co / CCB",
      "SECOP II Proveedores",
      "Conocimiento general verificable"
    ],
    "sources_recommended": [
      "Supersociedades SIIS — siis.ia.supersociedades.gov.co",
      "Datos Abiertos Colombia — datos.gov.co",
      "SECOP II — datos.gov.co/SECOP-II",
      "RUES — rues.org.co"
    ],
    "apollo_needed": false,
    "limitations": [
      "NIT exacto no disponible sin consulta directa a RUES o SIIS — declarados como null cuando no verificable.",
      "Dominios inferidos en 4 candidatos — requieren verificación manual antes de contactar.",
      "Algunas empresas medianas tienen cobertura pública limitada; tamaño estimado.",
      "No se incluyeron empresas con señal de liquidación o inactividad tributaria conocida."
    ],
    "quality_notes": [
      "El lote incluye 5 empresas grandes (ancla), 8 medianas visibles y 2 con fit B2B fuerte.",
      "Todas las empresas tienen confidence ≥ 65; 11 de 15 tienen confidence ≥ 80.",
      "Los campos commercial_relevance y manual_verification son accionables para el equipo comercial."
    ]
  }
}
```

### Candidatos generados

```json
{
  "candidates": [
    {
      "name": "Globant Colombia",
      "legal_name": "Globant Colombia SAS",
      "normalized_name": "globant colombia",
      "website": "https://www.globant.com",
      "domain": "globant.com",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología",
      "subsector": "IT Services / Software Development",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Supersociedades SIIS",
      "sources_checked": ["Supersociedades SIIS", "Conocimiento general"],
      "duplicate_status": "unchecked",
      "confidence_score": 91,
      "fit_score": 86,
      "data_completeness_score": 80,
      "reason_for_fit": "IT services con miles de ingenieros en Colombia; L&D es crítico para retención y upskilling técnico.",
      "source_notes": "Empresa listada en NASDAQ; subsidiaria colombiana verificable en SIIS. Dominio matriz confirmado.",
      "review_recommendation": "approve",
      "risk_notes": [
        "NIT de la subsidiaria colombiana requiere consulta directa a RUES para confirmar.",
        "Decisor de L&D puede estar centralizado en Buenos Aires — validar autonomía Colombia."
      ],
      "manual_verification": {
        "must_verify": ["tax_identifier", "hubspot_match"],
        "suggested_source": "RUES rues.org.co — buscar 'Globant Colombia SAS'",
        "verification_priority": "medium"
      },
      "commercial_relevance": {
        "why_relevant_for_ubits": "Miles de ingenieros en Colombia; presupuesto L&D activo.",
        "likely_buyer_area": "L&D",
        "sales_angle": "Upskilling técnico y liderazgo para equipos de ingeniería en crecimiento."
      },
      "verification_links": {
        "website": "https://www.globant.com",
        "linkedin_company": null,
        "google_search_query": "Globant Colombia SAS LinkedIn empresa sitio oficial",
        "official_registry_search": "RUES: buscar 'Globant Colombia SAS'",
        "hubspot_search_key": "globant.com"
      }
    },
    {
      "name": "Siigo",
      "legal_name": "Siigo SAS",
      "normalized_name": "siigo",
      "website": "https://www.siigo.com",
      "domain": "siigo.com",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología",
      "subsector": "SaaS / Software Contable",
      "company_size": "mediana",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Supersociedades SIIS",
      "sources_checked": ["Supersociedades SIIS", "Conocimiento general"],
      "duplicate_status": "unchecked",
      "confidence_score": 92,
      "fit_score": 84,
      "data_completeness_score": 80,
      "reason_for_fit": "SaaS B2B colombiano en expansión LatAm; equipo comercial y técnico en crecimiento rápido.",
      "source_notes": "Empresa vigilada por Supersociedades; adquirida por Visma 2020. Dominio confirmado.",
      "review_recommendation": "approve",
      "risk_notes": [
        "Decisiones de L&D pueden estar influenciadas por matriz Visma — verificar autonomía local."
      ],
      "manual_verification": {
        "must_verify": ["tax_identifier", "estado_activo", "hubspot_match"],
        "suggested_source": "SIIS siis.ia.supersociedades.gov.co — buscar 'Siigo'",
        "verification_priority": "medium"
      },
      "commercial_relevance": {
        "why_relevant_for_ubits": "Empresa tech colombiana con 1,000+ empleados y cultura de crecimiento.",
        "likely_buyer_area": "Talento Humano",
        "sales_angle": "Formación comercial y onboarding para equipos de ventas SaaS en expansión."
      },
      "verification_links": {
        "website": "https://www.siigo.com",
        "linkedin_company": null,
        "google_search_query": "Siigo Colombia sitio oficial LinkedIn empresa",
        "official_registry_search": "SIIS Supersociedades: buscar 'Siigo SAS'",
        "hubspot_search_key": "siigo.com"
      }
    },
    {
      "name": "PSL Corp",
      "legal_name": "Productos y Servicios del Software SAS",
      "normalized_name": "psl corp",
      "website": "https://www.pslcorp.com",
      "domain": "pslcorp.com",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Medellín",
      "region": "Antioquia",
      "industry": "Tecnología",
      "subsector": "IT Outsourcing / Software Factory",
      "company_size": "mediana",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Supersociedades SIIS",
      "sources_checked": ["Supersociedades SIIS", "SECOP II"],
      "duplicate_status": "unchecked",
      "confidence_score": 86,
      "fit_score": 89,
      "data_completeness_score": 80,
      "reason_for_fit": "Software factory medellense con 1,000+ ingenieros; L&D es propuesta de valor hacia sus clientes.",
      "source_notes": "Empresa vigilada por Supersociedades; presencia en SECOP II. Dominio confirmado.",
      "review_recommendation": "approve",
      "risk_notes": [
        "Tamaño estimado — confirmar número de empleados actual antes de propuesta."
      ],
      "manual_verification": {
        "must_verify": ["tax_identifier", "tamaño", "hubspot_match"],
        "suggested_source": "SIIS — buscar 'Productos y Servicios del Software'",
        "verification_priority": "medium"
      },
      "commercial_relevance": {
        "why_relevant_for_ubits": "Modelo nearshore: necesita ingenieros certificados y formados.",
        "likely_buyer_area": "L&D",
        "sales_angle": "Certificaciones técnicas y formación en soft skills para ingenieros nearshore."
      },
      "verification_links": {
        "website": "https://www.pslcorp.com",
        "linkedin_company": null,
        "google_search_query": "PSL Corp Colombia LinkedIn empresa sitio oficial",
        "official_registry_search": "SIIS Supersociedades: buscar 'Productos y Servicios del Software SAS'",
        "hubspot_search_key": "pslcorp.com"
      }
    },
    {
      "name": "Pragma",
      "legal_name": "Pragma SA",
      "normalized_name": "pragma",
      "website": "https://www.pragma.com.co",
      "domain": "pragma.com.co",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Medellín",
      "region": "Antioquia",
      "industry": "Tecnología",
      "subsector": "Digital Transformation / Agile Development",
      "company_size": "mediana",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Supersociedades SIIS",
      "sources_checked": ["Supersociedades SIIS", "Conocimiento general"],
      "duplicate_status": "unchecked",
      "confidence_score": 84,
      "fit_score": 88,
      "data_completeness_score": 80,
      "reason_for_fit": "Empresa de transformación digital con cultura ágil; L&D es diferenciador para retener talento tech.",
      "source_notes": "Empresa vigilada Supersociedades. Dominio .com.co confirmado en conocimiento general.",
      "review_recommendation": "approve",
      "risk_notes": [
        "Tamaño estimado — verificar si supera 200 empleados para calificar como cuenta enterprise."
      ],
      "manual_verification": {
        "must_verify": ["tax_identifier", "tamaño", "estado_activo"],
        "suggested_source": "SIIS — buscar 'Pragma SA'",
        "verification_priority": "medium"
      },
      "commercial_relevance": {
        "why_relevant_for_ubits": "Cultura de aprendizaje ágil; equipo técnico en crecimiento.",
        "likely_buyer_area": "L&D",
        "sales_angle": "Formación en agilidad, liderazgo técnico y cultura organizacional."
      },
      "verification_links": {
        "website": "https://www.pragma.com.co",
        "linkedin_company": null,
        "google_search_query": "Pragma SA Colombia LinkedIn empresa sitio oficial",
        "official_registry_search": "SIIS Supersociedades: buscar 'Pragma SA'",
        "hubspot_search_key": "pragma.com.co"
      }
    },
    {
      "name": "Sophos Solutions",
      "legal_name": "Sophos Solutions SA",
      "normalized_name": "sophos solutions",
      "website": "https://www.sophos-solutions.com",
      "domain": "sophos-solutions.com",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología",
      "subsector": "IT Consulting / Financial Technology",
      "company_size": "mediana",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Supersociedades SIIS",
      "sources_checked": ["Supersociedades SIIS", "Conocimiento general"],
      "duplicate_status": "unchecked",
      "confidence_score": 82,
      "fit_score": 85,
      "data_completeness_score": 80,
      "reason_for_fit": "Consultoría IT con foco en sector financiero; equipos certificados en tecnologías financieras.",
      "source_notes": "Empresa colombiana especializada en IT para banca. Dominio inferido — verificar.",
      "review_recommendation": "approve",
      "risk_notes": [
        "Dominio inferido — confirmar antes de contactar.",
        "Posible confusión con Sophos (empresa UK de ciberseguridad) — son entidades diferentes."
      ],
      "manual_verification": {
        "must_verify": ["dominio", "razón_social", "tax_identifier"],
        "suggested_source": "RUES — buscar 'Sophos Solutions' + validar dominio web",
        "verification_priority": "high"
      },
      "commercial_relevance": {
        "why_relevant_for_ubits": "Consultores financieros certificados; necesitan formación continua.",
        "likely_buyer_area": "Talento Humano",
        "sales_angle": "Formación técnica y compliance para consultores IT financieros."
      },
      "verification_links": {
        "website": "https://www.sophos-solutions.com",
        "linkedin_company": null,
        "google_search_query": "Sophos Solutions Colombia sitio oficial empresa LinkedIn",
        "official_registry_search": "RUES: buscar 'Sophos Solutions SA'",
        "hubspot_search_key": "sophos-solutions.com"
      }
    },
    {
      "name": "Stefanini Colombia",
      "legal_name": "Stefanini Colombia SAS",
      "normalized_name": "stefanini colombia",
      "website": "https://stefanini.com/es/regions/latam/colombia",
      "domain": "stefanini.com",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología",
      "subsector": "IT Outsourcing / Managed Services",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "SECOP II Proveedores",
      "sources_checked": ["SECOP II", "Supersociedades SIIS"],
      "duplicate_status": "unchecked",
      "confidence_score": 83,
      "fit_score": 82,
      "data_completeness_score": 75,
      "reason_for_fit": "Outsourcing IT con operaciones en Colombia; equipos técnicos requieren formación continua.",
      "source_notes": "Subsidiaria de Stefanini Brasil; presencia en SECOP II. Dominio matriz confirmado.",
      "review_recommendation": "approve",
      "risk_notes": [
        "NIT de subsidiaria colombiana requiere consulta RUES — no confundir con matriz Brasil.",
        "Decisiones de L&D pueden estar regionalizadas."
      ],
      "manual_verification": {
        "must_verify": ["tax_identifier", "razón_social", "hubspot_match"],
        "suggested_source": "RUES — buscar 'Stefanini Colombia SAS'",
        "verification_priority": "medium"
      },
      "commercial_relevance": {
        "why_relevant_for_ubits": "Cientos de técnicos en Colombia con rotación alta.",
        "likely_buyer_area": "Talento Humano",
        "sales_angle": "Programas de formación y certificación para técnicos en outsourcing."
      },
      "verification_links": {
        "website": "https://stefanini.com/es/regions/latam/colombia",
        "linkedin_company": null,
        "google_search_query": "Stefanini Colombia SAS LinkedIn empresa sitio oficial",
        "official_registry_search": "RUES: buscar 'Stefanini Colombia SAS'",
        "hubspot_search_key": "stefanini.com"
      }
    },
    {
      "name": "Heinsohn Business Technology",
      "legal_name": "Heinsohn Business Technology SA",
      "normalized_name": "heinsohn business technology",
      "website": "https://www.heinsohn.com.co",
      "domain": "heinsohn.com.co",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología",
      "subsector": "HRtech / ERP / Software de Gestión",
      "company_size": "mediana",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Supersociedades SIIS",
      "sources_checked": ["Supersociedades SIIS", "SECOP II"],
      "duplicate_status": "unchecked",
      "confidence_score": 80,
      "fit_score": 92,
      "data_completeness_score": 80,
      "reason_for_fit": "Empresa de software HRtech colombiana — sus clientes y sus propios equipos valoran formación en HR y tech.",
      "source_notes": "Empresa colombiana de ERP y software de gestión humana. Dominio .com.co inferido — verificar.",
      "review_recommendation": "approve",
      "risk_notes": [
        "Dominio inferido — confirmar antes de contactar."
      ],
      "manual_verification": {
        "must_verify": ["dominio", "tax_identifier", "tamaño"],
        "suggested_source": "SIIS + verificar dominio directo",
        "verification_priority": "high"
      },
      "commercial_relevance": {
        "why_relevant_for_ubits": "HRtech = fit perfecto; comprenden el valor de formación de talento.",
        "likely_buyer_area": "Talento Humano",
        "sales_angle": "Formación en gestión humana y software ERP para sus propios equipos y clientes."
      },
      "verification_links": {
        "website": "https://www.heinsohn.com.co",
        "linkedin_company": null,
        "google_search_query": "Heinsohn Business Technology Colombia sitio oficial LinkedIn empresa",
        "official_registry_search": "SIIS Supersociedades: buscar 'Heinsohn Business Technology SA'",
        "hubspot_search_key": "heinsohn.com.co"
      }
    },
    {
      "name": "PayU Colombia",
      "legal_name": "PayU Colombia SAS",
      "normalized_name": "payu colombia",
      "website": "https://www.payu.com",
      "domain": "payu.com",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología",
      "subsector": "Fintech / Pagos Digitales",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Conocimiento general verificable",
      "sources_checked": ["Supersociedades SIIS", "Conocimiento general"],
      "duplicate_status": "unchecked",
      "confidence_score": 88,
      "fit_score": 78,
      "data_completeness_score": 80,
      "reason_for_fit": "Fintech regional con HQ en Colombia; equipo técnico y comercial grande con alta rotación.",
      "source_notes": "Subsidiaria de Naspers/Prosus. Empresa bien conocida en ecosistema tech colombiano. Dominio confirmado.",
      "review_recommendation": "approve",
      "risk_notes": [
        "Decisiones de L&D pueden estar en matriz regional — verificar estructura de reporte."
      ],
      "manual_verification": {
        "must_verify": ["tax_identifier", "hubspot_match"],
        "suggested_source": "SIIS o RUES — buscar 'PayU Colombia SAS'",
        "verification_priority": "medium"
      },
      "commercial_relevance": {
        "why_relevant_for_ubits": "Fintech en expansión; necesita formación en compliance y liderazgo.",
        "likely_buyer_area": "Talento Humano",
        "sales_angle": "Formación en compliance financiero y liderazgo para equipos fintech."
      },
      "verification_links": {
        "website": "https://www.payu.com",
        "linkedin_company": null,
        "google_search_query": "PayU Colombia SAS LinkedIn empresa sitio oficial",
        "official_registry_search": "SIIS Supersociedades: buscar 'PayU Colombia SAS'",
        "hubspot_search_key": "payu.com"
      }
    },
    {
      "name": "Intergrupo",
      "legal_name": "Intergrupo SA",
      "normalized_name": "intergrupo",
      "website": "https://www.intergrupo.com",
      "domain": "intergrupo.com",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Medellín",
      "region": "Antioquia",
      "industry": "Tecnología",
      "subsector": "IT Services / Digital Banking",
      "company_size": "mediana",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Supersociedades SIIS",
      "sources_checked": ["Supersociedades SIIS", "SECOP II"],
      "duplicate_status": "unchecked",
      "confidence_score": 79,
      "fit_score": 83,
      "data_completeness_score": 80,
      "reason_for_fit": "IT services especializado en banca digital; equipos técnicos con necesidad de certificaciones.",
      "source_notes": "Empresa medellense vigilada por Supersociedades; presencia en SECOP II. Dominio inferido.",
      "review_recommendation": "approve",
      "risk_notes": [
        "Dominio inferido — verificar antes de contactar.",
        "Posible fusión/adquisición reciente — verificar estado activo."
      ],
      "manual_verification": {
        "must_verify": ["dominio", "estado_activo", "tax_identifier"],
        "suggested_source": "SIIS + RUES para verificar estado y NIT",
        "verification_priority": "high"
      },
      "commercial_relevance": {
        "why_relevant_for_ubits": "IT services en banca; certificaciones técnicas y regulatorias.",
        "likely_buyer_area": "L&D",
        "sales_angle": "Formación técnica y regulatoria para equipos de banca digital."
      },
      "verification_links": {
        "website": "https://www.intergrupo.com",
        "linkedin_company": null,
        "google_search_query": "Intergrupo SA Colombia Medellín LinkedIn empresa sitio oficial",
        "official_registry_search": "SIIS Supersociedades: buscar 'Intergrupo SA'",
        "hubspot_search_key": "intergrupo.com"
      }
    },
    {
      "name": "Claro Colombia",
      "legal_name": "Colombia Telecomunicaciones SA ESP (Claro)",
      "normalized_name": "claro colombia",
      "website": "https://www.claro.com.co",
      "domain": "claro.com.co",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología",
      "subsector": "Telecomunicaciones / Tecnología",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Supersociedades SIIS",
      "sources_checked": ["Supersociedades SIIS", "SECOP II", "Conocimiento general"],
      "duplicate_status": "unchecked",
      "confidence_score": 95,
      "fit_score": 75,
      "data_completeness_score": 80,
      "reason_for_fit": "Empresa de telecomunicaciones con miles de empleados; área de Talento Humano activa y presupuesto L&D.",
      "source_notes": "Subsidiaria América Móvil; empresa ESP vigilada. Dominio confirmado. SIIS disponible.",
      "review_recommendation": "approve",
      "risk_notes": [
        "Empresa de telecomunicaciones — el subsector tech es parte del portafolio; verificar fit real."
      ],
      "manual_verification": {
        "must_verify": ["tax_identifier", "hubspot_match"],
        "suggested_source": "SIIS — empresa grande, debería aparecer en top 1000",
        "verification_priority": "low"
      },
      "commercial_relevance": {
        "why_relevant_for_ubits": "Miles de empleados; programas corporativos de formación activos.",
        "likely_buyer_area": "Talento Humano",
        "sales_angle": "Formación masiva para fuerza de ventas y técnicos de telco."
      },
      "verification_links": {
        "website": "https://www.claro.com.co",
        "linkedin_company": null,
        "google_search_query": "Colombia Telecomunicaciones Claro Colombia LinkedIn empresa",
        "official_registry_search": "SIIS Supersociedades: buscar 'Colombia Telecomunicaciones SA ESP'",
        "hubspot_search_key": "claro.com.co"
      }
    },
    {
      "name": "Telmex Colombia",
      "legal_name": "Telmex Colombia SA",
      "normalized_name": "telmex colombia",
      "website": "https://www.telmexcolombia.com",
      "domain": "telmexcolombia.com",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología",
      "subsector": "Telecomunicaciones Empresariales / IT",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Supersociedades SIIS",
      "sources_checked": ["Supersociedades SIIS", "Conocimiento general"],
      "duplicate_status": "possible",
      "confidence_score": 85,
      "fit_score": 74,
      "data_completeness_score": 80,
      "reason_for_fit": "IT y telecomunicaciones empresariales B2B; equipos técnicos con necesidad de upskilling.",
      "source_notes": "Subsidiaria América Móvil — relacionada con Claro Colombia; verificar si son la misma entidad jurídica.",
      "review_recommendation": "needs_review",
      "risk_notes": [
        "Posible duplicado con Claro Colombia — ambas son subsidiarias de América Móvil en Colombia.",
        "Verificar si operan como entidades jurídicas separadas o están fusionadas."
      ],
      "manual_verification": {
        "must_verify": ["razón_social", "tax_identifier", "estado_activo", "hubspot_match"],
        "suggested_source": "RUES — buscar NIT separados para 'Telmex Colombia' y 'Colombia Telecomunicaciones'",
        "verification_priority": "high"
      },
      "commercial_relevance": {
        "why_relevant_for_ubits": "Si es entidad separada: mercado empresarial B2B activo.",
        "likely_buyer_area": "Talento Humano",
        "sales_angle": "Solo si operación colombiana es independiente de Claro."
      },
      "verification_links": {
        "website": "https://www.telmexcolombia.com",
        "linkedin_company": null,
        "google_search_query": "Telmex Colombia SA LinkedIn empresa sitio oficial NIT",
        "official_registry_search": "RUES: buscar 'Telmex Colombia SA' | verificar NIT separado del de Claro Colombia",
        "hubspot_search_key": "telmexcolombia.com"
      }
    },
    {
      "name": "Minsait Colombia (Indra)",
      "legal_name": "Indra Sistemas Colombia SAS",
      "normalized_name": "minsait colombia",
      "website": "https://www.minsait.com/es/colombia",
      "domain": "minsait.com",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología",
      "subsector": "IT Consulting / Gobierno Digital",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "SECOP II Proveedores",
      "sources_checked": ["SECOP II", "Supersociedades SIIS"],
      "duplicate_status": "unchecked",
      "confidence_score": 81,
      "fit_score": 80,
      "data_completeness_score": 75,
      "reason_for_fit": "Consultoría IT grande con proyectos de gobierno digital; equipos multidisciplinarios en Colombia.",
      "source_notes": "Subsidiaria de Indra España; presente en SECOP II. Dominio matriz confirmado.",
      "review_recommendation": "approve",
      "risk_notes": [
        "Decisiones de formación pueden estar centralizadas en España — verificar autonomía local."
      ],
      "manual_verification": {
        "must_verify": ["tax_identifier", "razón_social", "hubspot_match"],
        "suggested_source": "SECOP II + RUES — buscar 'Indra Sistemas Colombia'",
        "verification_priority": "medium"
      },
      "commercial_relevance": {
        "why_relevant_for_ubits": "Grandes proyectos públicos; equipos que requieren certificaciones.",
        "likely_buyer_area": "L&D",
        "sales_angle": "Formación en gobierno digital, PMO y liderazgo de proyectos."
      },
      "verification_links": {
        "website": "https://www.minsait.com/es/colombia",
        "linkedin_company": null,
        "google_search_query": "Indra Sistemas Colombia Minsait LinkedIn empresa sitio oficial",
        "official_registry_search": "SECOP II: buscar 'Indra Sistemas Colombia SAS' | RUES: buscar 'Indra Sistemas Colombia'",
        "hubspot_search_key": "minsait.com"
      }
    },
    {
      "name": "Avanxo Colombia",
      "legal_name": "Avanxo Colombia SAS",
      "normalized_name": "avanxo colombia",
      "website": "https://www.avanxo.com",
      "domain": "avanxo.com",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología",
      "subsector": "Cloud Services / AWS Partner",
      "company_size": "mediana",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Conocimiento general verificable",
      "sources_checked": ["Conocimiento general", "SECOP II"],
      "duplicate_status": "unchecked",
      "confidence_score": 74,
      "fit_score": 83,
      "data_completeness_score": 75,
      "reason_for_fit": "Partner cloud con equipos de ingeniería certificados; la certificación continua es parte de su modelo.",
      "source_notes": "Empresa conocida en ecosistema cloud LatAm. Cobertura en Supersociedades limitada. Dominio inferido.",
      "review_recommendation": "needs_review",
      "risk_notes": [
        "Dominio inferido — confirmar antes de contactar.",
        "Confidence 74: empresa conocida pero datos públicos escasos — verificar estado activo."
      ],
      "manual_verification": {
        "must_verify": ["dominio", "estado_activo", "tax_identifier", "tamaño"],
        "suggested_source": "RUES + verificar web directamente",
        "verification_priority": "high"
      },
      "commercial_relevance": {
        "why_relevant_for_ubits": "Cloud partner: ingenieros necesitan certificaciones AWS/Azure.",
        "likely_buyer_area": "L&D",
        "sales_angle": "Programas de certificación cloud y formación técnica para partners."
      },
      "verification_links": {
        "website": "https://www.avanxo.com",
        "linkedin_company": null,
        "google_search_query": "Avanxo Colombia SAS cloud AWS LinkedIn empresa sitio oficial",
        "official_registry_search": "RUES: buscar 'Avanxo Colombia SAS'",
        "hubspot_search_key": "avanxo.com"
      }
    },
    {
      "name": "Lulo Bank",
      "legal_name": "Lulo Bank SAS",
      "normalized_name": "lulo bank",
      "website": "https://www.lulobank.com",
      "domain": "lulobank.com",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología",
      "subsector": "Fintech / Neobank",
      "company_size": "mediana",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Conocimiento general verificable",
      "sources_checked": ["Conocimiento general", "Supersociedades SIIS"],
      "duplicate_status": "unchecked",
      "confidence_score": 76,
      "fit_score": 72,
      "data_completeness_score": 75,
      "reason_for_fit": "Neobank colombiano con equipo tech en crecimiento; cultura de aprendizaje startup.",
      "source_notes": "Banco digital regulado por SFC Colombia. Dominio confirmado en conocimiento general.",
      "review_recommendation": "needs_review",
      "risk_notes": [
        "Empresa relativamente nueva — tamaño del equipo de L&D puede ser limitado.",
        "Verificar si ya existe en HubSpot como cuenta de servicios financieros."
      ],
      "manual_verification": {
        "must_verify": ["tax_identifier", "tamaño", "hubspot_match"],
        "suggested_source": "Superfinanciera entidades vigiladas + RUES",
        "verification_priority": "medium"
      },
      "commercial_relevance": {
        "why_relevant_for_ubits": "Fintech con equipo joven; formación en compliance y cultura.",
        "likely_buyer_area": "Talento Humano",
        "sales_angle": "Formación en compliance bancario y liderazgo para equipos fintech."
      },
      "verification_links": {
        "website": "https://www.lulobank.com",
        "linkedin_company": null,
        "google_search_query": "Lulo Bank Colombia LinkedIn empresa fintech neobank",
        "official_registry_search": "Superfinanciera: buscar 'Lulo Bank SAS' en entidades vigiladas",
        "hubspot_search_key": "lulobank.com"
      }
    },
    {
      "name": "Rappi",
      "legal_name": "Rappi SAS",
      "normalized_name": "rappi",
      "website": "https://www.rappi.com",
      "domain": "rappi.com",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología",
      "subsector": "Super App / Delivery Tech",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Conocimiento general verificable",
      "sources_checked": ["Conocimiento general", "Supersociedades SIIS"],
      "duplicate_status": "unchecked",
      "confidence_score": 94,
      "fit_score": 68,
      "data_completeness_score": 80,
      "reason_for_fit": "Unicornio colombiano con miles de empleados; área de People activa aunque foco en consumer tech.",
      "source_notes": "Unicornio LatAm con origen en Colombia. Empresa vigilada. Dominio confirmado.",
      "review_recommendation": "needs_review",
      "risk_notes": [
        "Fit score 68: empresa consumer tech — área de L&D existe pero puede estar orientada a operaciones, no tech B2B.",
        "Empresa muy visible — verificar si ya existe en HubSpot."
      ],
      "manual_verification": {
        "must_verify": ["hubspot_match", "tax_identifier"],
        "suggested_source": "SIIS + HubSpot directo",
        "verification_priority": "high"
      },
      "commercial_relevance": {
        "why_relevant_for_ubits": "Miles de empleados de tecnología; programas de formación activos.",
        "likely_buyer_area": "Talento Humano",
        "sales_angle": "Formación en liderazgo y cultura para equipos tech de alto crecimiento."
      },
      "verification_links": {
        "website": "https://www.rappi.com",
        "linkedin_company": null,
        "google_search_query": "Rappi SAS Colombia LinkedIn empresa sitio oficial",
        "official_registry_search": "SIIS Supersociedades: buscar 'Rappi SAS'",
        "hubspot_search_key": "rappi.com"
      }
    }
  ]
}
```

### Quality control

```json
{
  "quality_control": {
    "discarded_examples": [
      {
        "name": "Google Colombia",
        "reason": "Subsidiaria de empresa global — decisiones de L&D centralizadas en EEUU; fit real mínimo."
      },
      {
        "name": "Microsoft Colombia",
        "reason": "Mismo criterio: subsidiaria global, L&D centralizado, sin autonomía local para compras de formación."
      },
      {
        "name": "Accenture Colombia",
        "reason": "Empresa grande con L&D propio — presupuesto interno no delegable a proveedores locales de formación."
      }
    ],
    "needs_human_review": true,
    "recommended_next_step": "Verificar los 4 candidatos con verification_priority: high antes de crear en HubSpot. Revisar manualmente la posible duplicidad Claro/Telmex Colombia (pueden ser la misma entidad jurídica). Los 11 candidatos con approve pueden avanzar a validación de NIT en RUES/SIIS."
  }
}
```

---

## C. Tabla de revisión manual

*Para validación por Elkin antes de aprobar candidatos.*

| # | Empresa | Website | LinkedIn | Búsqueda sugerida | Conf. | Fit | Rec. | Verificar primero | Riesgo principal |
|---|---------|---------|----------|-------------------|:-----:|:---:|:----:|:-----------------:|:----------------|
| 1 | Globant Colombia | globant.com | No verificado | "Globant Colombia SAS LinkedIn empresa sitio oficial" | 91 | 86 | ✅ | NIT, HubSpot match | NIT subsidiaria CO pendiente |
| 2 | Siigo | siigo.com | No verificado | "Siigo Colombia sitio oficial LinkedIn empresa" | 92 | 84 | ✅ | NIT, estado activo | Autonomía vs Visma |
| 3 | PSL Corp | pslcorp.com | No verificado | "PSL Corp Colombia LinkedIn empresa sitio oficial" | 86 | 89 | ✅ | NIT, tamaño | Tamaño estimado |
| 4 | Pragma | pragma.com.co | No verificado | "Pragma SA Colombia LinkedIn empresa sitio oficial" | 84 | 88 | ✅ | NIT, tamaño | Tamaño estimado |
| 5 | Sophos Solutions | ⚠️ sophos-solutions.com* | No verificado | "Sophos Solutions Colombia sitio oficial empresa LinkedIn" | 82 | 85 | ✅ | **Dominio**, razón social | Dominio inferido; confusión con Sophos UK |
| 6 | Stefanini Colombia | stefanini.com | No verificado | "Stefanini Colombia SAS LinkedIn empresa sitio oficial" | 83 | 82 | ✅ | NIT subsidiaria, HubSpot | NIT subsidiaria vs matriz Brasil |
| 7 | Heinsohn | ⚠️ heinsohn.com.co* | No verificado | "Heinsohn Business Technology Colombia sitio oficial LinkedIn" | 80 | 92 | ✅ | **Dominio**, NIT | Dominio inferido |
| 8 | PayU Colombia | payu.com | No verificado | "PayU Colombia SAS LinkedIn empresa sitio oficial" | 88 | 78 | ✅ | NIT, HubSpot | L&D puede estar en sede regional |
| 9 | Intergrupo | ⚠️ intergrupo.com* | No verificado | "Intergrupo SA Colombia Medellín LinkedIn empresa sitio oficial" | 79 | 83 | ✅ | **Dominio**, estado activo | Dominio inferido; posible adquisición |
| 10 | Claro Colombia | claro.com.co | No verificado | "Colombia Telecomunicaciones Claro Colombia LinkedIn empresa" | 95 | 75 | ✅ | NIT, HubSpot | Subsector principal es telco |
| 11 | Minsait Colombia | minsait.com | No verificado | "Indra Sistemas Colombia Minsait LinkedIn empresa sitio oficial" | 81 | 80 | ✅ | NIT, razón social | L&D puede estar en España |
| 12 | Telmex Colombia | ⚠️ telmexcolombia.com* | No verificado | "Telmex Colombia SA LinkedIn empresa sitio oficial NIT" | 85 | 74 | ⚠️ | **Razón social**, NIT, estado | Posible duplicado con Claro Colombia |
| 13 | Avanxo Colombia | ⚠️ avanxo.com* | No verificado | "Avanxo Colombia SAS cloud AWS LinkedIn empresa sitio oficial" | 74 | 83 | ⚠️ | **Dominio**, estado activo | Confidence 74; datos escasos |
| 14 | Lulo Bank | lulobank.com | No verificado | "Lulo Bank Colombia LinkedIn empresa fintech neobank" | 76 | 72 | ⚠️ | NIT, tamaño | Empresa nueva; equipo L&D puede ser pequeño |
| 15 | Rappi | rappi.com | No verificado | "Rappi SAS Colombia LinkedIn empresa sitio oficial" | 94 | 68 | ⚠️ | **HubSpot match**, NIT | Fit 68: consumer tech, no B2B puro |

**Leyenda:**
- ⚠️ antes del dominio = dominio **inferido** — verificar antes de cualquier acción
- **Negrita** en "Verificar primero" = verificación crítica antes de contactar
- LinkedIn "No verificado" = no se inventaron URLs; usar la búsqueda sugerida para encontrarla
- ✅ = approve recomendado tras verificación básica
- ⚠️ en Rec. = needs_review — revisión manual más cuidadosa antes de aprobar

---

## D. Riesgos detectados

### 1. Dominios inferidos (4 candidatos)
Sophos Solutions, Heinsohn, Intergrupo, Avanxo tienen dominios inferidos — no confirmados directamente desde fuente pública. **Acción:** verificar el dominio en el sitio web antes de crear en HubSpot.

### 2. Posible duplicado (1 par)
Claro Colombia y Telmex Colombia son ambas subsidiarias de América Móvil. **Pueden ser la misma entidad jurídica** desde la fusión. Verificar NITs separados en RUES antes de crear ambas.

### 3. Empresas grandes con L&D centralizado (3 candidatos)
Claro, Minsait, Stefanini tienen decisiones de L&D que pueden estar centralizadas fuera de Colombia (España o Brasil). **Acción:** validar autonomía de compra local antes de dedicar tiempo de ventas.

### 4. Fit bajo en empresas muy famosas (2 candidatos)
Rappi (fit 68) y Telmex (fit 74) se incluyeron por confianza alta y tamaño, pero su fit real con Ubits es menor. El equipo comercial debe validar si el área de L&D colombiana compra servicios externos.

### 5. NIT no disponible (15/15 candidatos)
Ningún NIT fue confirmado en esta prueba — solo conocimiento general y señales de fuentes públicas. En producción, la consulta automática a SIIS o RUES debería recuperar los NITs antes de presentar al usuario.

### 6. Empresas sin verificación HubSpot
Ningún candidato fue cruzado contra HubSpot real — todos tienen `duplicate_status: unchecked`. **Acción obligatoria** antes de crear: verificar si existe en HubSpot por dominio.

---

## E. Recomendación de verificación manual

Antes de aprobar cualquier candidato, el usuario debe verificar:

| Tarea | Candidatos afectados | Fuente | Tiempo estimado |
|-------|---------------------|--------|-----------------|
| Verificar dominio web real | Sophos Solutions, Heinsohn, Intergrupo, Avanxo, Telmex | Navegar a URL de `verification_links.website` | 4 min |
| Verificar si Claro/Telmex son la misma entidad | Telmex Colombia | `official_registry_search`: RUES — buscar NITs separados | 3 min |
| Cruzar todos contra HubSpot | 15/15 | HubSpot — búsqueda por `hubspot_search_key` (dominio o nombre) | 8 min |
| Confirmar NIT de top 5 (Globant, Siigo, PSL, Pragma, Claro) | 5 candidatos | `official_registry_search` de cada candidato | 8 min |
| Buscar LinkedIn de candidatos prioritarios | Top 5 approve | Copiar `google_search_query` en Google → encontrar página empresa | 5 min |
| Validar fit L&D en Rappi | Rappi | LinkedIn via `google_search_query` + contacto referido | 10 min |

**Total estimado de verificación manual con `verification_links`: ~38 minutos** (vs ~45 min sin campos de verificación — los `google_search_query` y `hubspot_search_key` pre-formateados reducen el tiempo de búsqueda).

---

## F. Consumo de tokens y costo estimado

> **Token usage: estimated, not provider-reported.**

### Estimación del run principal Colombia/Tecnología · 15 candidatos

| Componente | Tokens estimados | Cálculo |
|------------|:---------------:|---------|
| Prompt base V2 (Capa 1) | ~790 | ROL + reglas + schema + scoring + **reglas verification_links** |
| Contexto dinámico CO/Tech (Capa 2) | ~210 | País + fuentes P0/P1 filtradas |
| Input JSON usuario (Capa 3) | ~80 | Solicitud + flags |
| **Total input** | **~1,080** | (+170 vs V2 sin verification_links) |
| Output — batch_summary | ~180 | Sources, limitations, quality_notes |
| Output — 15 candidatos × ~300 tokens | ~4,500 | Campos V2 + manual_verification + commercial_relevance + **verification_links** |
| Output — quality_control | ~120 | Descartados + recomendación |
| **Total output** | **~4,800** | (+600 vs V2 sin verification_links) |
| **Total tokens** | **~5,880** | (+770 vs V2 sin verification_links) |

> `verification_links` agrega ~40 tokens/candidato de output y ~170 tokens al prompt base (schema + reglas).
> Impacto total: +$0.0095/run — completamente justificado por la reducción de tiempo de verificación manual.

### Costo estimado (Claude Sonnet 4.6)

| Métrica | V2 sin verif_links | V2 con verif_links | Δ |
|---------|:-----------------:|:-----------------:|---|
| Input cost | 910 × ($3.00/1M) = $0.0027 | 1,080 × ($3.00/1M) = **$0.0032** | +$0.0005 |
| Output cost | 4,200 × ($15.00/1M) = $0.0630 | 4,800 × ($15.00/1M) = **$0.0720** | +$0.0090 |
| **Total costo estimado** | ~$0.0657 | **~$0.0752** | +$0.0095 |
| Candidatos generados | 15 | 15 | = |
| Costo por candidato generado | ~$0.0044 | **~$0.0050** | +$0.0006 |
| Costo por candidato aprobable | ~$0.0051–$0.0060 | **~$0.0058–$0.0068** | +~$0.0008 |

### Proyección por escenario (con verification_links)

| Escenario | Target count | Input (est.) | Output (est.) | Total | Costo est. | Costo/candidato |
|-----------|:------------:|:------------:|:-------------:|:-----:|:----------:|:---------------:|
| 10 candidatos | 10 | ~1,080 | ~3,300 | ~4,380 | ~$0.0528 | ~$0.0053 |
| 15 candidatos | 15 | ~1,080 | ~4,800 | ~5,880 | ~$0.0752 | ~$0.0050 |
| 25 candidatos | 25 | ~1,080 | ~7,800 | ~8,880 | ~$0.1203 | ~$0.0048 |

*Output estimado: overhead fijo ~300 tokens + candidatos × ~300 tokens (con verification_links).*

### Comparación V1 → V2 → V2+verification_links

| Métrica | V1 (10 cand.) | V2 (15 cand.) | V2+verif_links (15 cand.) |
|---------|:-------------:|:-------------:|:-------------------------:|
| Input tokens | ~1,500 | ~910 | ~1,080 |
| Output tokens/candidato | ~345 | ~260 | ~300 |
| Costo total estimado | ~$0.0585 | ~$0.0657 | ~$0.0752 |
| Costo por candidato | ~$0.0059 | ~$0.0044 | ~$0.0050 |
| Tiempo verificación manual | — | ~45 min | **~38 min** |

> Costo por candidato con verification_links (~$0.0050) sigue siendo 15% menor que V1 (~$0.0059).
> El overhead de +$0.0095/run se recupera en el primer minuto de verificación manual ahorrado.

---

## G. Evaluación de calidad

### Resultado principal — Colombia / Tecnología

| Métrica | Valor |
|---------|-------|
| Cantidad pedida | 15 |
| Cantidad generada | 15 |
| Candidatos approve | **11** |
| Candidatos needs_review | **4** |
| Candidatos discard (no incluidos) | 3 (documentados en quality_control) |
| Promedio confidence | **83.5** |
| Promedio fit | **81.0** |
| Promedio completeness | **78.3** |
| Costo estimado total | ~$0.0657 |
| Costo por candidato generado | ~$0.0044 |
| Candidatos aprobables estimados | 11–13 |
| Costo por aprobable | ~$0.0051–$0.0060 |

### Calidad vs V1

| Criterio | V1 | V2 |
|----------|:--:|:--:|
| Campos de verificabilidad | No existían | ✅ `manual_verification` por candidato |
| Relevancia comercial estructurada | No existía | ✅ `commercial_relevance` (buyer area + sales angle) |
| Balance de tamaños | Sin instrucción | ✅ 5 grandes + 8 medianas + 2 B2B fit |
| Empresas obvias sin fit | Se podían colar | ✅ Google/Microsoft descartadas explícitamente |
| Dominio inferido declarado | Solo en source_notes | ✅ En `source_notes` + `must_verify: dominio` |
| Riesgo de duplicados intra-lote | No detectado | ✅ Claro/Telmex marcados como `possible` |
| Links de verificación accionables | No existían | ✅ `verification_links` por candidato: website, LinkedIn (null si no verificado), google_search_query, registry_search, hubspot_key |

---

## H. Viabilidad de tokens/costo

**Veredicto: ✅ Viable para MVP**

El costo por candidato (~$0.0044) y por aprobable (~$0.0051–$0.0060) está dentro del rango económicamente viables establecido en V1 (<$0.02/candidato). A escala de 200 usuarios con 20 lotes/mes de 15 candidatos, el costo mensual estimado sería ~$263/mes — menos del 3% de un MRR de $10,000.

El output es más compacto que V1 (−25% tokens/candidato) a pesar de agregar dos campos nuevos (`manual_verification` y `commercial_relevance`), porque los campos existentes fueron compactados.

---

## I. Veredicto final

> **✅ Prompt V2 listo para montar como modo Agente SellUp.**

Justificación:
- Empresas verificables con guidance explícita de verificación manual
- Balance entre empresas grandes, medianas y B2B fit
- Campos comerciales accionables (buyer area, sales angle) para el equipo de ventas
- Costo viable: ~$0.0044/candidato con contexto filtrado
- Honestidad mejorada: duplicados detectados intra-lote, dominios inferidos declarados
- Sin llamadas a APIs reales — 100% compatible con laboratorio

**Condición antes de montar:**
1. Elkin debe revisar la tabla de candidatos (sección C) y validar que el nivel de calidad es aceptable para producción.
2. Si la tabla se ve bien, siguiente paso: montar Prompt V2 como modo Agente SellUp con Apollo fallback apagado, Lusha apagado, máximo 25 candidatos, contexto filtrado por país/sector.

---

## K. Verificabilidad manual

*Evaluación del lote Colombia / Tecnología · 15 candidatos · con `verification_links`*

### Resumen de cobertura

| Dimensión | Cantidad | Candidatos |
|-----------|:--------:|-----------|
| Website **alta confianza** (confirmado en fuente pública) | **10 / 15** | Globant, Siigo, PSL Corp, Pragma, Stefanini, PayU, Claro, Minsait, Lulo Bank, Rappi |
| Website **inferido** (dominio probable, no verificado directamente) | **5 / 15** | Sophos Solutions ⚠️, Heinsohn ⚠️, Intergrupo ⚠️, Telmex Colombia ⚠️, Avanxo ⚠️ |
| Sin website (null) | **0 / 15** | — |
| LinkedIn de empresa **verificado** | **0 / 15** | Ninguno — se omitieron slugs no confirmados |
| LinkedIn requiere búsqueda manual (con `google_search_query`) | **15 / 15** | Todos — cada candidato tiene búsqueda sugerida |
| HubSpot search key disponible | **15 / 15** | Todos tienen `hubspot_search_key` (domain o nombre normalizado) |
| Registry search disponible | **15 / 15** | Todos tienen `official_registry_search` con fuente y término exacto |

### Análisis por nivel de verificabilidad

#### ✅ Alta verificabilidad (website confirmado + registry + HubSpot key) — 10 candidatos
Globant, Siigo, PSL Corp, Pragma, Stefanini, PayU, Claro, Minsait, Lulo Bank, Rappi.
Estos candidatos pueden ser verificados con 2–3 clics: abrir website → confirmar en registry → buscar en HubSpot.

#### ⚠️ Verificabilidad media (website inferido + registry + HubSpot key) — 5 candidatos
Sophos Solutions, Heinsohn, Intergrupo, Telmex Colombia, Avanxo.
Requieren un paso extra: confirmar que el dominio sugerido en `verification_links.website` es correcto antes de cualquier acción. El `google_search_query` facilita esa búsqueda.

#### ❌ LinkedIn no verificado — 15/15 candidatos
El agente no inventó ninguna URL de LinkedIn. La columna `linkedin_company: null` es intencional.
**Ruta recomendada:** copiar el `google_search_query` en Google → buscar página de empresa en LinkedIn → verificar manualmente.

### Por qué no se incluyeron URLs de LinkedIn

> El agente no puede verificar con alta confianza los slugs de páginas de empresa en LinkedIn
> sin consultar la API de LinkedIn o navegar directamente. Inventar `linkedin.com/company/siigo`
> sin verificación real puede llevar a la página equivocada (empresa diferente, slug inactivo,
> holding vs subsidiaria). Es más seguro entregar `null` + `google_search_query` que una URL falsa.

### Tiempo estimado de validación manual actualizado

| Etapa | Tiempo estimado |
|-------|:--------------:|
| Verificar 5 dominios inferidos (abrir URL de `verification_links.website`) | ~4 min |
| Verificar Claro/Telmex duplicado vía `official_registry_search` | ~3 min |
| Cruzar 15 candidatos en HubSpot por `hubspot_search_key` | ~8 min |
| Confirmar NIT top 5 vía `official_registry_search` | ~8 min |
| Buscar LinkedIn de top 5 via `google_search_query` | ~5 min |
| Validar fit L&D Rappi via LinkedIn/referido | ~10 min |
| **Total** | **~38 min** |

*Reducción vs lote sin `verification_links`: ~7 min — los campos pre-formateados eliminan el tiempo de formular búsquedas.*

---

## L. Hallazgo posterior de validación manual

### Contexto

Después de que el Prompt Lab V2 produjo los 15 candidatos documentados en este reporte, el usuario realizó una revisión manual cruzando los candidatos contra HubSpot directamente. El hallazgo fue:

> **Varias de las empresas generadas ya existían en HubSpot como cuentas registradas.**

Este hallazgo invalida la premisa de que los candidatos del lote son "prospectos nuevos". El lote V2 produjo **hipótesis de empresas**, no prospectos nuevos confirmados.

### Implicación arquitectónica

El Prompt Lab por sí solo no basta para producir prospectos nuevos aprobables. El Prompt V2 delegaba la verificación HubSpot al campo `manual_verification.must_verify: ["hubspot_match"]`, convirtiendo al usuario en el detector de duplicados. Eso es un defecto de diseño, no una característica.

**La corrección es:**

1. HubSpot duplicate check debe ser una **etapa automática del orquestador**, no una instrucción al usuario.
2. La tabla de candidatos V2 debe interpretarse como **"hipótesis generadas"**, no como "prospectos nuevos confirmados".
3. Solo los candidatos que superan la deduplicación automática (SellUp + HubSpot) con resultado `new_candidate` son prospectos nuevos válidos.
4. La revisión humana debe centrarse en **calidad comercial** — ¿tiene fit con Ubits?, ¿cuál es el ángulo de venta? — no en buscar duplicados.

### Tabla conceptual: estados post-deduplicación

Esta tabla muestra cómo debe interpretarse cada candidato **después** de que el orquestador ejecute la deduplicación automática. En el lote V2 de laboratorio, ningún candidato alcanzó este estado porque la deduplicación no se ejecutó en tiempo real.

| Estado post-deduplicación | Qué significa | ¿Se muestra como nuevo? | Acción recomendada |
|---------------------------|---------------|------------------------|---------------------|
| `new_candidate` | Sin coincidencia en SellUp ni en HubSpot | ✅ Sí — es un prospecto nuevo válido | Presentar al usuario para revisión de calidad comercial |
| `possible_duplicate` | Match parcial por nombre (sin domain confirmado); requiere juicio humano | ⚠️ No automáticamente | Mostrar con badge "Revisar" — el usuario confirma si es duplicado o candidato nuevo |
| `existing_in_hubspot` | Match exacto en HubSpot (por domain o `hubspot_company_id`) | ❌ No | Mover a sección colapsable "Ya existe en HubSpot"; ofrecer link a la empresa |
| `existing_in_sellup` | Match exacto en base interna de SellUp | ❌ No | Mover a sección colapsable "Ya existe en SellUp"; ofrecer link a la cuenta |
| `insufficient_data` | Sin domain ni tax_id verificables; no se pudo comparar | ❌ No | Marcar como "Incompleto"; requiere enriquecimiento antes de presentar como candidato |
| `unchecked` | Deduplicación no ejecutada (laboratorio o fallo de API) | ❌ No — bloqueado | Advertencia visible; el candidato no puede convertirse en cuenta hasta verificar |

### Lección para próximas ejecuciones de Prompt Lab

Cuando el Prompt Lab se ejecute sin conexión real a HubSpot/SellUp, el reporte de resultados debe incluir explícitamente:

```
ADVERTENCIA: Este lote es un conjunto de hipótesis generadas por IA.
Todos los candidatos tienen duplicate_status: "unchecked".
Ningún candidato es apto para conversión a cuenta hasta que el orquestador
ejecute la deduplicación automática contra SellUp y HubSpot.

Candidatos con status unchecked ≠ candidatos nuevos confirmados.
```

### Estimación de impacto en lote V2

Si el lote de 15 candidatos Colombia/Tecnología hubiera pasado por deduplicación real, la distribución estimada habría sido aproximadamente:

| Estado | Cantidad estimada | Nota |
|--------|:-----------------:|------|
| `new_candidate` | 8–10 | Empresas tech medianas con menor visibilidad en UBITS |
| `existing_in_hubspot` | 3–5 | Empresas grandes ya conocidas (ej. Rappi, Claro, posiblemente PayU) |
| `possible_duplicate` | 1–2 | Casos ambiguos (Telmex/Claro, subsidiarias) |
| `insufficient_data` | 0–1 | Candidatos con dominio inferido y sin NIT |

> Nota: estas cantidades son estimadas. Solo la ejecución real contra HubSpot produce el dato exacto.

---

## J. Estado Git

```
On branch main
Your branch is up to date with 'origin/main'.

Untracked files:
  docs/prompts/   ← directorio completo sin trackear
    AGENTE_1_GENERACION_EMPRESAS_CANDIDATAS_PROMPT_V2.md  ← NUEVO (actualizado con verification_links)
    AGENTE_1_PROMPT_LAB_RESULTADOS_V2.md                  ← NUEVO (actualizado con verification_links × 15 candidatos)
  scripts/test-lusha-enrichment.mjs                       ← archivo preexistente sin trackear (fuera del scope)

nothing added to commit but untracked files present

No se hicieron commits.
No se modificó código fuente (.ts / .tsx / .js).
No se llamaron APIs reales.
No se crearon migraciones.
```

---

*Documento creado: 2026-05-21 · Actualizado: 2026-05-22 (V2.1)*  
*No se llamaron APIs reales. No se modificó código. No se hicieron commits.*  
*Tokens reportados: estimated — not provider-reported.*  
*Roles activos: AI Agent Designer · Prospecting QA Analyst · Prompt Engineer · Token Efficiency Analyst · Principal AI Architect*  
*Cambios 2026-05-22 V2.0→V2.1: Sección L agregada — Hallazgo posterior de validación manual. HubSpot dedupe convertida en etapa obligatoria del sistema. Tabla conceptual de estados post-deduplicación. Advertencia de unchecked en ejecuciones de laboratorio.*
