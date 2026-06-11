-- ============================================================
-- Migration 060: Seed del Catálogo de Industrias v1.0.0
-- Hito 16AB.32 — Carga inicial del Catálogo SellUp 1.0.0
-- ============================================================
--
-- catalog_version: 1.0.0
-- review_status: human_adjustments_applied
-- approved_hitos: 16AB.29, 16AB.29.1, 16AB.29.2, 16AB.30, 16AB.31
-- adjustments_applied: 10
-- structural_checks: 20/20
-- functional_scenarios: 14/14
--
-- source_artifact_hashes:
--   subindustries.json: 0a3f05dd50de4a9ecf9357b3a8337dbcc7c1180e95768460e3c97d2e2e7fcdfd
--   rules.json: 3aa85b87b525eaad4a5df8a1f6271630199d03af1d26bd59d1d96e8eed4aba12
--   aliases.json: 1fc40e5b204486d822c156f4d4595c127ddfc2773b97a5ebacd45aa96597d370
--   search-terms.json: c5acbb73d59ff4a26d19644198e17fdc68d3e15a9228b985d2a6f1a2b8819069
--   geographic-coverage.json: 5b9e7f52eb2a6a3ece34ad9b8541ad52c965d66057c1bc32522f2ace4b8add07
--   industry-common-rules.json: c6fc4bdfa10c5cb8b19dd7acff58b63741b2ff5733352fe32d8a18dba7e73dd1
--
-- uuid_namespace: be3f11a3-3062-58ba-840a-1002fcccb9e7
--   derived_from: uuid5(NAMESPACE_DNS, 'sellup.catalog.v1.0.0')
--
-- generated_at: (see migration timestamp)
--
-- row_counts:
--   industry_catalog_versions: 1
--   industries: 8
--   subindustries: 73
--   subindustry_aliases: 127
--   subindustry_search_terms: 228
--   industry_rules: 42 (source file actual count)
--   subindustry_rules: 364
--
-- IMPORTANT: Do NOT apply with supabase db push --linked until reviewed.
-- ============================================================

begin;

-- ============================================================
-- GUARD: version 1.0.0 must not exist
-- ============================================================
do $$
begin
    if exists (
        select 1 from public.industry_catalog_versions where version = '1.0.0'
    ) then
        raise exception
            'SEED BLOCKED: version 1.0.0 already exists in industry_catalog_versions. '
            'This seed must run exactly once on a clean table. '
            'If you need to reseed, truncate the tables first or create a new migration.';
    end if;
end;
$$ language plpgsql;

-- ============================================================
-- INSERT: industry_catalog_versions
-- ============================================================
INSERT INTO public.industry_catalog_versions (
    id, version, status, name, description, created_by, published_at, archived_at
) VALUES (
    'e4675daf-65a2-5e26-8640-58f1aeaee5ed',
    '1.0.0',
    'draft',
    'Catálogo inicial de industrias y subindustrias SellUp',
    'Primera versión real del catálogo de industrias y subindustrias que alimentará el
     formulario productivo de Generar con IA y los contextos de búsqueda del Agente 1.
     Cubre 8 industrias y 73 subindustrias para LATAM.',
    NULL,
    NULL,
    NULL
);

-- ============================================================
-- INSERT: industries (8 rows)
-- ============================================================
INSERT INTO public.industries (
    id, catalog_version_id, name, slug, description, active, sort_order
) VALUES
    ('06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'Tecnología', 'tecnologia', 'Empresas que desarrollan o proveen software, plataformas digitales, infraestructura tecnológica y servicios TI. Su producto o servicio principal es tecnología vendida o licenciada a otras organizaciones (B2B).', true, 1),
    ('7f728594-1ad2-5837-abed-88b90b067e21', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'Servicios Financieros', 'servicios-financieros', 'Entidades reguladas o supervisadas que proveen servicios financieros: bancos, aseguradoras, brokers, cooperativas financieras, fintechs B2B que operan en el espacio financiero (no solo construyen tecnología).', true, 2),
    ('2c5f0aa0-9116-50ef-838d-68dc01f33ada', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'Salud', 'salud', 'Organizaciones que prestan o facilitan servicios de salud: redes hospitalarias, farmacéuticas, laboratorios clínicos, distribuidores de medicamentos, salud ocupacional y medicina prepagada.', true, 3),
    ('263192bb-4db8-585c-9220-a9eabb77f9e9', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'Educación', 'educacion', 'Instituciones educativas, grupos educativos, proveedores de formación corporativa y certificación profesional B2B. Énfasis en organizaciones con capacidad de compra y oferta enterprise.', true, 4),
    ('e9338391-f2d1-5c84-90da-49a5508e4d3f', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'Retail y Consumo', 'retail', 'Cadenas de retail, operadores omnicanal y fabricantes/distribuidores de bienes de consumo (FMCG). Cubre tanto la distribución al consumidor final como la producción de bienes de consumo masivo.', true, 5),
    ('da9e4f93-b45e-5874-94de-a7b50f739daa', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'Manufactura e Industria', 'manufactura', 'Fabricantes con planta productiva, empresas constructoras e infraestructura, operadores de energía/minería y agroindustria con operación empresarial. Actividades que transforman o producen bienes físicos a escala.', true, 6),
    ('e1c4e056-c7f5-5f81-988e-bd69b7e8f949', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'Consultoría y Servicios Profesionales', 'consultoria-servicios-profesionales', 'Firmas de consultoría, servicios legales, auditoría, outsourcing de procesos (BPO), staffing, facilities y servicios corporativos especializados. No producen bienes físicos ni son tecnología.', true, 7),
    ('11b032ad-e9d4-5390-8bc8-cd740ac28e4e', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'Logística y Transporte', 'logistica-transporte', 'Operadores logísticos, transporte de carga, freight forwarders, agencias de aduana, warehousing y courier empresarial. Operación física de movimiento, almacenamiento y distribución de mercancías B2B.', true, 8)
;

-- ============================================================
-- INSERT: subindustries (73 rows)
-- ============================================================
INSERT INTO public.subindustries (
    id, catalog_version_id, industry_id, name, slug, description, active, sort_order, applicable_countries
) VALUES
    ('3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Software Empresarial (SaaS / ERP / CRM)', 'software-empresarial', 'Plataformas SaaS, ERP, CRM y soluciones de software vendidas a empresas (B2B). El cliente es una organización, no un consumidor individual.', true, 1, NULL),
    ('40a655f2-0c1a-545d-973a-fb357d6b8da9', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Ciberseguridad', 'ciberseguridad', 'Empresas cuyo producto principal es una solución de seguridad tecnológica: protección de datos, gestión de identidades, SOC, detección de amenazas, zero trust.', true, 2, NULL),
    ('f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Infraestructura Cloud y DevOps', 'infraestructura-cloud-devops', 'Proveedores de plataformas cloud, contenedores, DevOps, site reliability y herramientas de infraestructura como código. Sus clientes son equipos de tecnología de otras empresas.', true, 3, NULL),
    ('3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Fintech: Infraestructura y Pagos', 'fintech-infraestructura-pagos', 'Empresas que CONSTRUYEN tecnología financiera como producto: procesadores de pagos, APIs bancarias, plataformas de préstamo digital, infraestructura de pagos B2B. Distinto de entidades que OPERAN servicios financieros.', true, 4, NULL),
    ('2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'HRtech y Gestión del Talento', 'hrtech-gestion-talento', 'Plataformas de gestión de personas, reclutamiento digital, nómina, ATS y experiencia del empleado. El producto principal gestiona procesos de recursos humanos.', true, 5, NULL),
    ('1a00c933-fc42-5767-bc47-dd0f9be5c9fd', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Marketing Technology y Sales Tech', 'martech-salestech', 'Plataformas de automatización de marketing, analytics, CRM de marketing, publicidad programática y herramientas de sales enablement. Sus clientes son equipos de marketing y ventas de empresas.', true, 6, NULL),
    ('81203ac3-a280-5d00-97b1-330f429c8495', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Inteligencia Artificial y Machine Learning', 'inteligencia-artificial-ml', 'Empresas que desarrollan o comercializan soluciones de IA, ML, NLP y visión computacional como producto. La IA/ML es su propuesta de valor central, no un feature adicional.', true, 7, NULL),
    ('87a07024-5d94-55fe-b122-7137ad3c9a12', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Ecommerce Enablement', 'ecommerce-enablement', 'Plataformas y herramientas que HABILITAN el comercio electrónico de terceros: plataformas de tiendas online, pasarelas de pago, herramientas de conversión, plataformas marketplace. No son el retailer sino la infraestructura.', true, 8, NULL),
    ('37fdfe1f-b082-5aa2-9269-5adcbbcf1108', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Healthtech B2B', 'healthtech-b2b', 'Plataformas digitales para el sector salud: historia clínica digital, gestión hospitalaria, telemedicina corporativa, dispositivos médicos conectados. La tecnología es el diferenciador, no el servicio clínico.', true, 9, NULL),
    ('bdce83c0-9d1f-58a8-82de-7289c676ab0a', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Proptech e Inmobiliaria Digital', 'proptech', 'Plataformas tecnológicas para el sector inmobiliario: portales de listados, gestión de propiedades, transacciones digitales de bienes raíces, valuación automatizada.', true, 10, NULL),
    ('014296cc-98e4-5433-bc2f-bbcbcadbf252', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Legaltech', 'legaltech', 'Plataformas tecnológicas para servicios legales: contratos digitales, firma electrónica, gestión documental jurídica, automatización de procesos legales.', true, 11, NULL),
    ('f286731d-fa78-507c-932c-b028ff6f00d7', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Insurtech', 'insurtech', 'Plataformas de tecnología para seguros: distribución digital de pólizas, gestión de siniestros, underwriting algorítmico. La tecnología es el diferenciador, no la operación aseguradora.', true, 12, NULL),
    ('0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Govtech y Ciudades Inteligentes', 'govtech', 'Plataformas tecnológicas para gobierno: servicios públicos digitales, gestión municipal, ciudades inteligentes, trámites en línea. Sus clientes principales son entidades gubernamentales.', true, 13, NULL),
    ('52787e3c-6e77-5fb2-b62b-dd999c4df07e', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Agritech', 'agritech', 'Tecnología aplicada al agro: gestión de cultivos, trazabilidad, drones, IoT agrícola, precision farming. Sus clientes son productores, agroindustria o la cadena de valor agrícola.', true, 14, NULL),
    ('a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Data Analytics y Business Intelligence', 'data-analytics-bi', 'Plataformas de análisis de datos, business intelligence, data warehousing y visualización. Sus clientes son equipos de datos o de negocio de otras empresas.', true, 15, NULL),
    ('1b885eed-5d52-5c0b-be1f-a79797d1e7a9', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'IoT y Hardware Conectado', 'iot-hardware-conectado', 'Empresas que desarrollan o venden dispositivos conectados, sensores industriales, smart devices y plataformas IoT. La conectividad y datos del hardware son centrales en la propuesta de valor.', true, 16, NULL),
    ('b684211e-413a-54d3-8989-a8139e2c1285', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Software Factory y Nearshore', 'software-factory-nearshore', 'Fábricas de software, desarrollo a medida, staff augmentation y nearshore TI. Venden capacidad de desarrollo a empresas que necesitan equipos técnicos externos.', true, 17, NULL),
    ('7d2ce6cb-2dbd-5c46-93dc-502241887d69', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Telco y Comunicaciones', 'telecomunicaciones-tech', 'Operadores de telecomunicaciones, plataformas de comunicaciones unificadas, servicios de conectividad y CPaaS. Sus clientes son empresas u operadores que necesitan infraestructura de comunicación.', true, 18, NULL),
    ('ec013b35-657a-5a4d-b500-477222d724bc', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'QA, Testing y Automatización (RPA)', 'qa-testing-automatizacion', 'Empresas especializadas en aseguramiento de calidad de software, testing automatizado y automatización de procesos robóticos (RPA). Venden servicios o plataformas de testing/automatización a otras empresas.', true, 19, NULL),
    ('40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'Edtech: Plataformas de Aprendizaje', 'edtech-plataformas', 'Empresas que CONSTRUYEN plataformas tecnológicas para educación y aprendizaje: LMS, sistemas de gestión de aprendizaje, plataformas de e-learning, herramientas de evaluación digital. La tecnología es el producto, no el contenido educativo.', true, 20, NULL),
    ('4d764405-cdb7-526e-9468-73fa008bbdc6', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '7f728594-1ad2-5837-abed-88b90b067e21', 'Banca Tradicional', 'banca-tradicional', 'Bancos regulados, entidades bancarias múltiples y de inversión. Operan depósitos, crédito, inversión y servicios transaccionales. Requieren regulación financiera.', true, 1, NULL),
    ('968f71cb-1483-538b-83e2-6eaaf6467dcf', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '7f728594-1ad2-5837-abed-88b90b067e21', 'Seguros Generales', 'seguros-generales', 'Aseguradoras de ramos generales: propiedad, automóviles, transporte, responsabilidad civil, garantías. Reguladas por superintendencias de seguros.', true, 2, NULL),
    ('b9c5711c-21fa-51f9-8aca-30d12a012dd9', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '7f728594-1ad2-5837-abed-88b90b067e21', 'Seguros de Vida y Personas', 'seguros-vida-personas', 'Aseguradoras de vida, accidentes personales, salud grupal y pensiones privadas. Alta demanda de red de asesores y cumplimiento normativo.', true, 3, NULL),
    ('14fdb758-d9d0-56b8-a899-4b2529e87a43', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '7f728594-1ad2-5837-abed-88b90b067e21', 'Brokers e Intermediarios de Seguros', 'brokers-intermediarios-seguros', 'Corredores de seguros corporativos, intermediarios y agencias con fuerza comercial que distribuyen seguros a empresas. No suscriben pólizas propias.', true, 4, NULL),
    ('c81af5fd-147f-5525-b9e5-906230842846', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '7f728594-1ad2-5837-abed-88b90b067e21', 'Fintech B2B: Servicios Financieros', 'fintech-b2b-servicios', 'Fintechs que OPERAN servicios financieros como negocio principal: pagos B2B, facturas electrónicas, open banking, adquirencia, neobancos para empresas. Reguladas o en proceso de regulación.', true, 5, NULL),
    ('c4291ea6-67e1-52ff-ae79-5a67939cf448', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '7f728594-1ad2-5837-abed-88b90b067e21', 'Factoring, Leasing y Crédito Empresarial', 'factoring-leasing-credito', 'Empresas de factoring, leasing, crédito para empresas y servicios de capital de trabajo. Sirven principalmente a pymes y corporaciones.', true, 6, NULL),
    ('87822a25-bfed-5194-8931-b80e2898ea79', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '7f728594-1ad2-5837-abed-88b90b067e21', 'Fondos de Inversión y Gestión de Activos', 'fondos-gestion-activos', 'Gestoras de fondos, fiduciarias, administradoras de inversión y entidades del mercado de capitales. Requieren regulación de valores.', true, 7, NULL),
    ('4668b75d-d69f-50ca-902e-d85767652d79', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '7f728594-1ad2-5837-abed-88b90b067e21', 'Cooperativas y Entidades Financieras Solidarias', 'cooperativas-financieras', 'Cooperativas de ahorro y crédito, cajas de compensación, entidades de economía solidaria con operación financiera de escala. Reguladas por superintendencias de cooperativas.', true, 8, NULL),
    ('041e7562-9bac-596f-a8a2-346f390c0fe8', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '2c5f0aa0-9116-50ef-838d-68dc01f33ada', 'Redes Hospitalarias y Clínicas', 'redes-hospitalarias-clinicas', 'Redes hospitalarias privadas, clínicas especializadas con múltiples sedes, hospitales universitarios y centros médicos de alta complejidad con operación empresarial.', true, 1, NULL),
    ('8515cd86-1a51-577b-b71c-b4907d56ce1f', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '2c5f0aa0-9116-50ef-838d-68dc01f33ada', 'Laboratorios Farmacéuticos', 'laboratorios-farmaceuticos', 'Fabricantes de medicamentos, productos biológicos y biosimilares. Incluye empresas que desarrollan y producen fármacos con planta propia o por contrato.', true, 2, NULL),
    ('c08be8e0-c6a9-5988-8a00-6fc666146f06', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '2c5f0aa0-9116-50ef-838d-68dc01f33ada', 'Distribuidores Farmacéuticos', 'distribuidores-farmaceuticos', 'Empresas de distribución mayorista de medicamentos, insumos médicos y productos farmacéuticos. Operan entre laboratorios y farmacias/hospitales.', true, 3, NULL),
    ('33236dc9-8af2-542f-b88b-06b1584a01f9', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '2c5f0aa0-9116-50ef-838d-68dc01f33ada', 'Dispositivos Médicos y MedTech', 'dispositivos-medicos-medtech', 'Fabricantes e importadores de dispositivos médicos, equipos de diagnóstico, implantes y tecnología médica con registro sanitario. No confundir con healthtech (plataformas digitales de salud).', true, 4, NULL),
    ('431a0c19-885d-5f59-ae46-a4e22f7e9486', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '2c5f0aa0-9116-50ef-838d-68dc01f33ada', 'Laboratorios Clínicos y Diagnóstico', 'laboratorios-clinicos-diagnostico', 'Redes de laboratorios clínicos, centros de diagnóstico, imagenología y patología. Operan análisis de muestras o imágenes como servicio.', true, 5, NULL),
    ('df0765ed-3842-5b2e-a320-b0cee73b11d4', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '2c5f0aa0-9116-50ef-838d-68dc01f33ada', 'Salud Ocupacional y Medicina Laboral', 'salud-ocupacional', 'Empresas especializadas en salud ocupacional, medicina preventiva y servicios de higiene industrial para empresas. Sus clientes son áreas de RRHH o SST de otras organizaciones.', true, 6, NULL),
    ('2bffda5f-45f2-5a36-84e5-5038562c6916', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '2c5f0aa0-9116-50ef-838d-68dc01f33ada', 'Medicina Prepagada y EPS', 'medicina-prepagada-eps', 'Entidades de medicina prepagada, EPS, aseguradoras de salud y planes de salud colectivos. Cubren la intermediación financiera de servicios de salud.', true, 7, ARRAY['AR','BR','CL','CO','EC','MX','PE','UY']::text[]),
    ('24ea07e9-5a06-5236-92a3-b1f677e9e4fb', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '2c5f0aa0-9116-50ef-838d-68dc01f33ada', 'CRO e Investigación Clínica', 'cro-investigacion-clinica', 'Organizaciones de investigación por contrato (CRO), centros de ensayos clínicos y empresas de ciencias de la vida que gestionan estudios clínicos.', true, 8, NULL),
    ('975b1e2b-cd1f-59be-a00a-645de8d6ec34', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '2c5f0aa0-9116-50ef-838d-68dc01f33ada', 'Equipamiento y Suministros Hospitalarios', 'equipamiento-hospitalario', 'Proveedores de equipamiento médico, mobiliario hospitalario, suministros quirúrgicos y consumibles para la operación de centros de salud.', true, 9, NULL),
    ('1779cc43-079d-5a5f-9e15-902f3cdbabae', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '263192bb-4db8-585c-9220-a9eabb77f9e9', 'Universidades e Institutos Privados', 'universidades-institutos-privados', 'Universidades privadas, institutos de educación superior y grupos universitarios con oferta de pregrado, posgrado y programas de formación profesional.', true, 1, NULL),
    ('a4db23d2-6d94-5463-a171-fbee80028206', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '263192bb-4db8-585c-9220-a9eabb77f9e9', 'Universidades Públicas con Capacidad de Compra', 'universidades-publicas-relevantes', 'Universidades públicas grandes con autonomía presupuestal, oferta de educación continua o formación corporativa, y ruta comercial real para UBITS.', true, 2, NULL),
    ('0f8a58ca-4ff5-5c96-8856-15ec3b74d50c', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '263192bb-4db8-585c-9220-a9eabb77f9e9', 'Escuelas de Negocios y Formación Ejecutiva', 'escuelas-negocios-ejecutiva', 'Escuelas de negocios, MBAs, programas de formación ejecutiva y educación para líderes empresariales. Pueden ser independientes o parte de universidades.', true, 3, NULL),
    ('2b631bf6-425d-53ce-8f9d-d156713df570', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '263192bb-4db8-585c-9220-a9eabb77f9e9', 'Formación Corporativa y Corporate Training', 'formacion-corporativa-b2b', 'Proveedores especializados en formación in-company, desarrollo organizacional, capacitación de empleados y gestión del aprendizaje para empresas. Compiten o complementan a UBITS.', true, 4, NULL),
    ('c7cd8535-8714-58ba-ad16-2d157102cb48', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '263192bb-4db8-585c-9220-a9eabb77f9e9', 'Institutos Técnicos y Vocacionales', 'institutos-tecnicos-vocacionales', 'Institutos de formación técnica, tecnológica y vocacional que preparan para el mercado laboral. Cubre SENA (Colombia), SENATI (Perú), CONALEP (México) y equivalentes privados.', true, 5, NULL),
    ('3e9f8993-6d08-5206-8f71-d69b9f99a71c', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '263192bb-4db8-585c-9220-a9eabb77f9e9', 'Certificación Profesional B2B', 'certificacion-profesional-b2b', 'Organismos y empresas de certificación profesional que otorgan credenciales reconocidas: PMP, ITIL, Scrum, AWS, Microsoft, etc. Venden certificaciones a empresas o profesionales.', true, 6, NULL),
    ('8efb5b7b-4790-570d-ade7-a44effcd5a49', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '263192bb-4db8-585c-9220-a9eabb77f9e9', 'Grupos Educativos Multi-sede', 'grupos-educativos-red', 'Grupos empresariales que operan múltiples instituciones educativas (universidades, institutos, colegios) bajo una misma marca o holding. Alta escala y presencia regional.', true, 7, NULL),
    ('e2c051f9-8e52-5218-9542-dbe8c8cbc28d', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e9338391-f2d1-5c84-90da-49a5508e4d3f', 'Supermercados e Hipermercados', 'supermercados-hipermercados', 'Cadenas de supermercados, hipermercados, hard discount y conveniencia. Operan múltiples tiendas de alimentos y consumo masivo.', true, 1, NULL),
    ('912a4b36-8597-5204-bb8e-814fb0769505', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e9338391-f2d1-5c84-90da-49a5508e4d3f', 'Tiendas por Departamento, Moda y Calzado', 'tiendas-departamento-moda', 'Cadenas de tiendas por departamento, retail de moda, calzado, electrodomésticos y mejoramiento del hogar con múltiples puntos de venta.', true, 2, NULL),
    ('d49ba019-c2e4-59b5-bc58-12724ec1f152', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e9338391-f2d1-5c84-90da-49a5508e4d3f', 'Farmacias Cadena y Retail de Salud', 'farmacias-cadena-retail', 'Cadenas de farmacias y droguerías retail, ópticas y tiendas de salud con múltiples puntos de venta. Distinto de laboratorios o distribuidores farmacéuticos.', true, 3, NULL),
    ('9d036663-b424-5989-9bfc-02c85b0c25c8', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e9338391-f2d1-5c84-90da-49a5508e4d3f', 'Retailers Especializados', 'retailers-especializados', 'Cadenas especializadas en categorías como deporte, electrónica, mejoramiento del hogar, ferretería grande, mascotas (pet retail) y entretenimiento con red de tiendas.', true, 4, NULL),
    ('8f893965-daf2-508f-95c7-bbc332595f3e', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e9338391-f2d1-5c84-90da-49a5508e4d3f', 'Operadores Omnicanal y Ecommerce Retail', 'operadores-omnicanal', 'Retailers con operación integrada físico-digital, marketplaces con operación local y pure players de ecommerce con escala empresarial.', true, 5, NULL),
    ('2b2ead23-b436-5b62-910e-997995ad2cd2', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e9338391-f2d1-5c84-90da-49a5508e4d3f', 'Fabricantes de Alimentos y Bebidas (FMCG)', 'fabricantes-alimentos-bebidas', 'Fabricantes y distribuidores estructurados de alimentos procesados, bebidas, lácteos, snacks, cárnicos y panificados industriales. Tienen planta y canal de distribución.', true, 6, NULL),
    ('228440c9-a8d7-51b9-96cd-47bac896b0cf', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e9338391-f2d1-5c84-90da-49a5508e4d3f', 'Cuidado Personal, Higiene y Hogar (FMCG)', 'cuidado-personal-higiene-hogar', 'Fabricantes de productos de cuidado personal, higiene, hogar y mascotas con distribución masiva: champús, jabones, detergentes, pet food y similares.', true, 7, NULL),
    ('76d05169-addd-50f4-b0ef-67e6a0b07fc5', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'da9e4f93-b45e-5874-94de-a7b50f739daa', 'Metalmecánica y Autopartes', 'metalmecanica-autopartes', 'Fabricantes de productos metalmecánicos, autopartes, ensamble automotor y manufactura de precisión metálica. Tienen planta productiva y operación industrial.', true, 1, NULL),
    ('55386a47-3bec-510a-91c6-ba61341f5676', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'da9e4f93-b45e-5874-94de-a7b50f739daa', 'Químicos, Plásticos y Packaging Industrial', 'quimicos-plasticos-packaging', 'Fabricantes de químicos industriales, plásticos, packaging, papel y vidrio para uso industrial o B2B. Operan plantas productivas.', true, 2, NULL),
    ('9ff59aa5-f2b2-5271-a506-73470ba9a4d2', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'da9e4f93-b45e-5874-94de-a7b50f739daa', 'Bienes de Capital y Maquinaria', 'bienes-capital-maquinaria', 'Fabricantes e integradores de maquinaria industrial, bienes de capital, equipos para manufactura y líneas de producción automatizadas.', true, 3, NULL),
    ('9158a6ee-d7ce-524b-a7e9-dc24f3269f92', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'da9e4f93-b45e-5874-94de-a7b50f739daa', 'Manufactura Exportadora y Zona Franca', 'manufactura-exportadora', 'Manufactura orientada a exportación, maquilas, empresas en zonas francas industriales. Alta empleabilidad y necesidad de estándares internacionales.', true, 4, NULL),
    ('b43b5ddd-5c4e-5c09-a693-d9b2e3c32ce6', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'da9e4f93-b45e-5874-94de-a7b50f739daa', 'Construcción e Infraestructura', 'construccion-obra-civil', 'Constructoras, desarrolladoras inmobiliarias, empresas de infraestructura, ingeniería civil, EPC, facility management y property management con volumen.', true, 5, NULL),
    ('87b9e0c7-0d17-5400-93e8-b62906fedf6a', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'da9e4f93-b45e-5874-94de-a7b50f739daa', 'Energía, Minería y Servicios Industriales', 'energia-mineria-servicios', 'Oil & gas, minería, utilities eléctricas, energías renovables, servicios petroleros y mineros, EPC energético y gestión de residuos industriales.', true, 6, ARRAY['CO','PE','CL','MX','BR','AR','BO','EC']::text[]),
    ('eaefd820-c413-571b-b9ba-2100eed3e49f', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'da9e4f93-b45e-5874-94de-a7b50f739daa', 'Agroindustria y Procesamiento Primario', 'agroindustria-procesadora', 'Agroexportadores, floricultura, acuicultura, cadenas agroindustriales y procesadores primarios de materias primas agrícolas. Tienen operación de campo, planta o packing.', true, 7, ARRAY['CO','PE','EC','MX','CL','BR','AR','GT','CR']::text[]),
    ('d6b54f2b-6de3-55de-b84d-fa894fe5e7a8', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', 'Consultoría de Estrategia y Gestión', 'consultoria-estrategia-gestion', 'Firmas de consultoría estratégica, gestión empresarial, transformación organizacional y mejora de procesos. Venden conocimiento y servicios de asesoría a empresas.', true, 1, NULL),
    ('abf86c42-cf23-532c-8343-5db4e225b57e', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', 'Auditoría, Contabilidad y Advisory Financiero', 'auditoria-contabilidad', 'Firmas de auditoría, contabilidad, asesoría tributaria y advisory financiero. Incluye Big Four y firmas de contabilidad con escala.', true, 2, NULL),
    ('dd4c52eb-81ec-5de5-97f3-6ab745bbae7c', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', 'Servicios Legales y Compliance', 'servicios-legales-compliance', 'Firmas de abogados con escala corporativa, asesoría legal empresarial y servicios de compliance regulatorio para organizaciones.', true, 3, NULL),
    ('c2ad5ec0-571a-520e-a026-53a0dc75e260', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', 'BPO y Contact Center', 'bpo-contact-center', 'Empresas de outsourcing de procesos de negocio (BPO), contact centers, customer experience outsourcing y cobranza. Alta empleabilidad y operación multiciudad.', true, 4, NULL),
    ('0e890f25-655c-5061-b354-f86c3ab29062', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', 'Staffing y Servicios Temporales', 'staffing-servicios-temporales', 'Empresas de outsourcing de personal, servicios temporales, payroll, nómina tercerizada y suministro de mano de obra para otras empresas.', true, 5, NULL),
    ('fe8187a9-9e99-5f85-bf36-a1de8c0ec0c4', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', 'Facilities, Aseo Industrial y Seguridad Privada', 'facilities-seguridad-privada', 'Empresas de facility management, limpieza industrial, aseo corporativo, seguridad privada y mantenimiento de instalaciones para clientes corporativos.', true, 6, NULL),
    ('6c83d574-3ca3-5579-bf8e-9c450c4f43c7', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', 'Investigación de Mercados e Inteligencia Comercial', 'investigacion-mercados-inteligencia', 'Firmas de investigación de mercados, medición de audiencias, estudios de opinión y servicios de inteligencia comercial para empresas.', true, 7, NULL),
    ('5a217eb2-0a0e-5a74-b131-e7a34ebe3cb5', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', 'Operadores Logísticos 3PL y 4PL', 'operadores-logisticos-3pl-4pl', 'Operadores logísticos que gestionan la cadena de suministro de terceros: almacenamiento, transporte, distribución y gestión de inventario como servicio.', true, 1, NULL),
    ('695bf6e7-c121-5bc5-940a-5def8d79f523', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', 'Transporte de Carga Terrestre', 'transporte-carga-terrestre', 'Empresas de transporte terrestre de carga pesada, carga general y transporte especializado entre ciudades o regiones. Tienen flota propia o gestionada.', true, 2, NULL),
    ('adcfeed3-fc65-5c45-bf66-7910446075ca', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', 'Freight Forwarders y Agencias de Aduana', 'freight-forwarders-aduana', 'Agentes de carga internacional, freight forwarders y agencias de aduana especializadas en comercio exterior y trámites aduaneros.', true, 3, NULL),
    ('c92627a7-95c6-542f-bb35-f88d401e53c4', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', 'Cadena de Frío y Logística Farmacéutica', 'cadena-frio-farmaceutica', 'Operadores especializados en cadena de frío para alimentos o farmacéuticos, y logística regulada de medicamentos, vacunas y productos biológicos.', true, 4, NULL),
    ('2effb010-8309-5e97-92dd-3b50a5400de6', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', 'Warehousing y Fulfillment B2B', 'warehousing-fulfillment', 'Operadores de bodegas, centros de distribución, almacenamiento y fulfillment para empresas. Gestión de inventario y preparación de pedidos como servicio.', true, 5, NULL),
    ('ae3d1714-e36a-549c-986e-fc53ffa63d80', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', 'Operadores Portuarios y Aeroportuarios de Carga', 'operadores-portuarios-aeroportuarios', 'Terminales portuarias, operadores aeroportuarios de carga, stevedores y empresas de handling de carga en puertos y aeropuertos.', true, 6, NULL),
    ('e729fcea-2082-55b8-a945-8ed65adac821', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', 'Logística para Minería y Energía', 'logistica-mineria-energia', 'Operadores de logística especializada para sectores de minería, oil & gas y energía: transporte de materiales peligrosos, logística de campo y proyectos remotos.', true, 7, ARRAY['CO','PE','CL','MX','BR','AR','BO','EC']::text[]),
    ('7564d31e-3d32-5c3e-b795-81093419f83a', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', 'Courier y Mensajería Empresarial', 'courier-mensajeria-empresarial', 'Empresas de courier, mensajería urgente y entrega de documentos y paquetes para clientes corporativos. Diferente de delivery de comida B2C.', true, 8, NULL)
;

-- ============================================================
-- INSERT: subindustry_aliases (127 rows)
-- ============================================================
INSERT INTO public.subindustry_aliases (
    id, subindustry_id, alias, normalized_alias, language_code, country_code, active
) VALUES
    ('90d7da26-0470-5cae-aa69-05547dbce67a', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'SaaS B2B', 'saas b2b', 'en', NULL, true),
    ('e5e27d25-861e-58d9-8207-4274a12a4261', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'enterprise software', 'enterprise software', 'en', NULL, true),
    ('d31daeec-5f34-55ff-81e1-15a0bbb69d73', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'software de gestión empresarial', 'software de gestion empresarial', 'es', NULL, true),
    ('528350c9-d32a-5202-aed9-bbab44f4e9a6', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'ERP', 'erp', 'en', NULL, true),
    ('6e6f46d1-5455-5af6-bef8-e4b93317f985', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'plataforma empresarial', 'plataforma empresarial', 'es', NULL, true),
    ('c3cc61d7-313a-558d-84b2-0861f6ddb684', '40a655f2-0c1a-545d-973a-fb357d6b8da9', 'seguridad informática', 'seguridad informatica', 'es', NULL, true),
    ('5058c2e1-c7c4-56c2-a1e1-c1fa69fb5954', '40a655f2-0c1a-545d-973a-fb357d6b8da9', 'infosec', 'infosec', 'en', NULL, true),
    ('78b90ec9-3d5c-59d6-975b-d39c781a2b5f', '40a655f2-0c1a-545d-973a-fb357d6b8da9', 'cybersecurity', 'cybersecurity', 'en', NULL, true),
    ('f1fdc60a-97c6-58ab-b467-60361bad65bc', '40a655f2-0c1a-545d-973a-fb357d6b8da9', 'protección de datos', 'proteccion de datos', 'es', NULL, true),
    ('416c8f71-4426-5562-b19b-cb010836d830', 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'cloud computing', 'cloud computing', 'en', NULL, true),
    ('27896379-15e6-5353-8102-d1438cd91c3f', 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'DevOps', 'devops', 'en', NULL, true),
    ('5d53eefa-31d8-5395-b592-621918ccb739', 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'IaaS', 'iaas', 'en', NULL, true),
    ('73ae4df7-1bfc-5f8f-8d8d-281d6d0fedab', 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'plataformas cloud', 'plataformas cloud', 'es', NULL, true),
    ('f11baad0-21a2-5fcd-8bb1-9f52e7af42e4', '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'fintech', 'fintech', 'en', NULL, true),
    ('79921545-379f-52e7-b258-02fa2e9bcf5b', '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'tecnología financiera', 'tecnologia financiera', 'es', NULL, true),
    ('ada62ea5-fbb7-5074-a62a-8d9d1ab28f3d', '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'payments tech', 'payments tech', 'en', NULL, true),
    ('3faf7828-2fe2-53cf-9794-ef348e3130fd', '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'infraestructura de pagos', 'infraestructura de pagos', 'es', NULL, true),
    ('fa52d621-dd40-579a-ad8a-30c330d7c098', '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', 'HR tech', 'hr tech', 'en', NULL, true),
    ('ddeda956-5f04-5ab6-bd10-3da74f3cdea4', '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', 'people tech', 'people tech', 'en', NULL, true),
    ('79fe6a94-6c70-5b1d-ae08-866bcf8346c0', '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', 'gestión del talento', 'gestion del talento', 'es', NULL, true),
    ('6021eec3-fc6f-593e-939d-2a3f38157704', '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', 'HCM', 'hcm', 'en', NULL, true),
    ('09a78dae-7833-5f85-bfcb-4c8166c18fe0', '1a00c933-fc42-5767-bc47-dd0f9be5c9fd', 'martech', 'martech', 'en', NULL, true),
    ('f99a9244-2e8d-5f52-9353-b81ea0fee094', '1a00c933-fc42-5767-bc47-dd0f9be5c9fd', 'marketing automation', 'marketing automation', 'en', NULL, true),
    ('498c0ec8-a72b-59ce-868d-553e7d43988c', '1a00c933-fc42-5767-bc47-dd0f9be5c9fd', 'sales enablement', 'sales enablement', 'en', NULL, true),
    ('7fc1b85e-6247-5514-ad41-efb860ad4874', '81203ac3-a280-5d00-97b1-330f429c8495', 'IA empresarial', 'ia empresarial', 'es', NULL, true),
    ('c27fcc9a-269e-5182-86dd-6f67e480aa54', '81203ac3-a280-5d00-97b1-330f429c8495', 'machine learning', 'machine learning', 'en', NULL, true),
    ('2bdef06a-35f9-5d13-8771-dcd5b756c7e1', '81203ac3-a280-5d00-97b1-330f429c8495', 'AI', 'ai', 'en', NULL, true),
    ('a67a5dfb-9db9-5e11-93d5-c510fee6b77d', '81203ac3-a280-5d00-97b1-330f429c8495', 'IA generativa', 'ia generativa', 'es', NULL, true),
    ('6684de1b-4fb6-5870-bb0c-4809e8faddd8', '87a07024-5d94-55fe-b122-7137ad3c9a12', 'comercio electrónico B2B', 'comercio electronico b2b', 'es', NULL, true),
    ('d4abc238-09f5-58af-a625-d1effa73a88c', '87a07024-5d94-55fe-b122-7137ad3c9a12', 'plataforma de e-commerce', 'plataforma de e-commerce', 'es', NULL, true),
    ('a8e29d7e-4c57-54a9-ac0f-753a4e780df7', '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', 'salud digital', 'salud digital', 'es', NULL, true),
    ('30697ea2-749b-52c0-95ae-f2f48761268d', '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', 'telemedicina B2B', 'telemedicina b2b', 'es', NULL, true),
    ('37a18d5a-9e79-5ab0-9367-7bb9ae3fb38c', '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', 'digital health', 'digital health', 'en', NULL, true),
    ('5c680ab1-2e2e-5952-9cb4-ecc3fbf57ff5', 'bdce83c0-9d1f-58a8-82de-7289c676ab0a', 'real estate tech', 'real estate tech', 'en', NULL, true),
    ('a006fc15-4771-550e-af8f-234bbb75704c', 'bdce83c0-9d1f-58a8-82de-7289c676ab0a', 'inmobiliaria digital', 'inmobiliaria digital', 'es', NULL, true),
    ('1605bac7-2603-54a8-9e46-11436c6fe66e', '014296cc-98e4-5433-bc2f-bbcbcadbf252', 'legal tech', 'legal tech', 'en', NULL, true),
    ('8c5ccdb5-d4a1-5883-893f-49f27b78683b', '014296cc-98e4-5433-bc2f-bbcbcadbf252', 'contratos digitales', 'contratos digitales', 'es', NULL, true),
    ('dc8f2d1e-bb17-5052-837a-853d6968cd1e', '014296cc-98e4-5433-bc2f-bbcbcadbf252', 'firma electrónica', 'firma electronica', 'es', NULL, true),
    ('12ba5017-1354-57ab-b018-656017b53f7c', 'f286731d-fa78-507c-932c-b028ff6f00d7', 'seguro digital', 'seguro digital', 'es', NULL, true),
    ('e1935b7e-a2ac-5d35-8be2-035f511b4090', 'f286731d-fa78-507c-932c-b028ff6f00d7', 'insurance tech', 'insurance tech', 'en', NULL, true),
    ('14e6d155-dc17-5f38-a650-d2c765026fac', '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', 'gobierno digital', 'gobierno digital', 'es', NULL, true),
    ('5f27dd80-3f4e-5744-a4eb-4e44bebdeda3', '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', 'smart city', 'smart city', 'en', NULL, true),
    ('59310c8b-ce3b-5f6e-9607-a6fe022c22a2', '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', 'ciudad inteligente', 'ciudad inteligente', 'es', NULL, true),
    ('3a7c87ea-a4ae-56f7-a1da-910f62cd30d3', '52787e3c-6e77-5fb2-b62b-dd999c4df07e', 'tecnología agrícola', 'tecnologia agricola', 'es', NULL, true),
    ('1982deef-515d-575a-8b50-9bda0b6f1fc4', '52787e3c-6e77-5fb2-b62b-dd999c4df07e', 'agricultura de precisión', 'agricultura de precision', 'es', NULL, true),
    ('de83ebbf-cfa1-567b-9ccb-dc9ecf2a3963', '52787e3c-6e77-5fb2-b62b-dd999c4df07e', 'agro digital', 'agro digital', 'es', NULL, true),
    ('be33f629-d43e-5499-99a8-11ce397d75aa', 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', 'business intelligence', 'business intelligence', 'en', NULL, true),
    ('e48ffa24-8981-5a51-b79b-3ea4d9942c10', 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', 'BI', 'bi', 'en', NULL, true),
    ('642970ff-6211-5566-ab63-6e546022ba08', 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', 'analítica de datos', 'analitica de datos', 'es', NULL, true),
    ('9f4cac3b-2300-5ddb-8234-c5dbea5cdeb3', 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', 'data analytics', 'data analytics', 'en', NULL, true),
    ('2a822f14-f3ac-56e3-92be-74e57e7b09aa', '1b885eed-5d52-5c0b-be1f-a79797d1e7a9', 'Internet de las Cosas', 'internet de las cosas', 'es', NULL, true),
    ('9ed33f34-9f79-509d-a4c8-7c3c23d3a737', '1b885eed-5d52-5c0b-be1f-a79797d1e7a9', 'IoT', 'iot', 'en', NULL, true),
    ('4bdd3278-28d5-511a-80f4-bfaff2c7c688', '1b885eed-5d52-5c0b-be1f-a79797d1e7a9', 'hardware conectado', 'hardware conectado', 'es', NULL, true),
    ('92d5d625-b5c0-5124-a2a1-9a0d36816b56', 'b684211e-413a-54d3-8989-a8139e2c1285', 'fábrica de software', 'fabrica de software', 'es', NULL, true),
    ('cb2ee0ac-889a-5a93-b31a-ad122c514d76', 'b684211e-413a-54d3-8989-a8139e2c1285', 'nearshore', 'nearshore', 'en', NULL, true),
    ('cb71365d-ea53-5d94-a854-f543e25ec998', 'b684211e-413a-54d3-8989-a8139e2c1285', 'staff augmentation', 'staff augmentation', 'en', NULL, true),
    ('ca197659-6b2d-5eb9-b713-b41e88c9214f', 'b684211e-413a-54d3-8989-a8139e2c1285', 'desarrollo a medida', 'desarrollo a medida', 'es', NULL, true),
    ('1c24a8ce-9c91-56e0-a9be-185602839089', '7d2ce6cb-2dbd-5c46-93dc-502241887d69', 'telecomunicaciones', 'telecomunicaciones', 'es', NULL, true),
    ('34b9ffb7-16dd-50e9-8d4d-f6e917276075', '7d2ce6cb-2dbd-5c46-93dc-502241887d69', 'telco', 'telco', 'en', NULL, true),
    ('39c49da3-3c5e-5979-b8fc-23cc4d84a51c', '7d2ce6cb-2dbd-5c46-93dc-502241887d69', 'comunicaciones unificadas', 'comunicaciones unificadas', 'es', NULL, true),
    ('edce9e85-8d8e-5b23-b5f7-e0febe61ccc5', '7d2ce6cb-2dbd-5c46-93dc-502241887d69', 'CPaaS', 'cpaas', 'en', NULL, true),
    ('b4029323-1aec-591e-a8d6-b2c9df938dfe', 'ec013b35-657a-5a4d-b500-477222d724bc', 'QA testing', 'qa testing', 'en', NULL, true),
    ('f9e73047-5258-5618-837b-832f9a92b04b', 'ec013b35-657a-5a4d-b500-477222d724bc', 'RPA', 'rpa', 'en', NULL, true),
    ('48514513-fc39-51b6-90c3-dd5c0db3934f', 'ec013b35-657a-5a4d-b500-477222d724bc', 'automatización de procesos', 'automatizacion de procesos', 'es', NULL, true),
    ('5e190c37-6021-5bd5-9379-a1cf7c07fad7', 'ec013b35-657a-5a4d-b500-477222d724bc', 'testing de software', 'testing de software', 'es', NULL, true),
    ('ea075477-3d34-5342-ac3d-011aebf39a9d', '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', 'plataforma LMS', 'plataforma lms', 'es', NULL, true),
    ('8a19593d-6851-57c3-aba2-9391dbfc8f0a', '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', 'e-learning B2B', 'e-learning b2b', 'es', NULL, true),
    ('062d4a00-81d1-5e48-9245-08cd75aa06ac', '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', 'learning management system', 'learning management system', 'en', NULL, true),
    ('7b392873-8d72-5ff7-ae4b-2c67b355dbb6', '4d764405-cdb7-526e-9468-73fa008bbdc6', 'banco', 'banco', 'es', NULL, true),
    ('a902503d-96ca-5793-8dfc-054ef8366e36', '4d764405-cdb7-526e-9468-73fa008bbdc6', 'entidad bancaria', 'entidad bancaria', 'es', NULL, true),
    ('7382afee-7299-5b19-ab1a-2256c5dba6fd', '4d764405-cdb7-526e-9468-73fa008bbdc6', 'bank', 'bank', 'en', NULL, true),
    ('8718f341-cc52-5e21-9123-401b1d006c36', '968f71cb-1483-538b-83e2-6eaaf6467dcf', 'aseguradoras', 'aseguradoras', 'es', NULL, true),
    ('cb16dacd-30ca-56fa-916f-edef928bb01f', '968f71cb-1483-538b-83e2-6eaaf6467dcf', 'seguros P&C', 'seguros p&c', 'en', NULL, true),
    ('fedf86b3-901d-5938-b2dd-166b338c165e', 'c81af5fd-147f-5525-b9e5-906230842846', 'neobank', 'neobank', 'en', NULL, true),
    ('0cf9a70f-ec48-549c-8627-c2b2167979ec', 'c81af5fd-147f-5525-b9e5-906230842846', 'pagos digitales', 'pagos digitales', 'es', NULL, true),
    ('9b7d026a-6fcc-57c0-b937-1d49eab849e2', 'c81af5fd-147f-5525-b9e5-906230842846', 'open banking', 'open banking', 'en', NULL, true),
    ('c3ca5eb2-4b23-5546-be59-c4fe969bda6e', '041e7562-9bac-596f-a8a2-346f390c0fe8', 'red hospitalaria', 'red hospitalaria', 'es', NULL, true),
    ('56c6555b-89d7-5fe4-9e57-c341940af701', '041e7562-9bac-596f-a8a2-346f390c0fe8', 'hospital privado', 'hospital privado', 'es', NULL, true),
    ('1567378b-dd02-56d4-85a7-12f427ed6c5f', '8515cd86-1a51-577b-b71c-b4907d56ce1f', 'pharma', 'pharma', 'en', NULL, true),
    ('d3c70a1b-773e-58a0-98ee-7a8bdfe5806a', '8515cd86-1a51-577b-b71c-b4907d56ce1f', 'laboratorio farmacéutico', 'laboratorio farmaceutico', 'es', NULL, true),
    ('80ee3cc3-c31b-5c73-b5b4-fdba28055e11', 'df0765ed-3842-5b2e-a320-b0cee73b11d4', 'medicina del trabajo', 'medicina del trabajo', 'es', NULL, true),
    ('4cbd9780-a41d-55ab-9924-906314ba3345', 'df0765ed-3842-5b2e-a320-b0cee73b11d4', 'SST salud', 'sst salud', 'es', NULL, true),
    ('f210d540-c7d8-5368-9f46-018770722ffa', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'EPS', 'eps', 'es', 'CO', true),
    ('2acdcb6d-c331-536c-a096-8c006b222b93', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'ISAPRE', 'isapre', 'es', 'CL', true),
    ('c51f2d7c-6d24-5e7b-957a-5f3e370bf38a', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'plan de salud corporativo', 'plan de salud corporativo', 'es', NULL, true),
    ('5ff8e3ae-fca8-558b-b092-72334e70b1ac', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'plano de saúde', 'plano de saude', 'pt', 'BR', true),
    ('c336de8b-eb5c-505c-85a9-203032559be6', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'operadora de saúde', 'operadora de saude', 'pt', 'BR', true),
    ('4cc39661-7a3e-56ce-a484-a46e9a2e9847', '2b631bf6-425d-53ce-8f9d-d156713df570', 'corporate training', 'corporate training', 'en', NULL, true),
    ('e4b58fbd-fe47-50b8-b314-031d8d423378', '2b631bf6-425d-53ce-8f9d-d156713df570', 'capacitación empresarial', 'capacitacion empresarial', 'es', NULL, true),
    ('d54d2574-b439-5244-92e5-546a3f768ad6', '2b631bf6-425d-53ce-8f9d-d156713df570', 'formación in-company', 'formacion in-company', 'es', NULL, true),
    ('5b681e19-e101-5b64-a155-a29f9e11877b', 'c7cd8535-8714-58ba-ad16-2d157102cb48', 'SENA', 'sena', 'es', 'CO', true),
    ('8d9899ca-bcab-57de-ac9f-4ea84920c1e2', 'c7cd8535-8714-58ba-ad16-2d157102cb48', 'SENATI', 'senati', 'es', 'PE', true),
    ('8c6f09f1-8492-5d11-af7c-65698c830b42', 'c7cd8535-8714-58ba-ad16-2d157102cb48', 'CONALEP', 'conalep', 'es', 'MX', true),
    ('106498be-1d0d-52c9-954d-cc9d07794ac5', 'c7cd8535-8714-58ba-ad16-2d157102cb48', 'formación técnica', 'formacion tecnica', 'es', NULL, true),
    ('cb576fee-1cec-54f9-a4f3-47201707b8db', 'c7cd8535-8714-58ba-ad16-2d157102cb48', 'OTEC', 'otec', 'es', 'CL', true),
    ('347a672c-43d0-571a-885c-a46de8229766', 'c2ad5ec0-571a-520e-a026-53a0dc75e260', 'BPO', 'bpo', 'en', NULL, true),
    ('457ed149-6089-5bd7-b2a3-6cdf92ab1e2c', 'c2ad5ec0-571a-520e-a026-53a0dc75e260', 'contact center', 'contact center', 'en', NULL, true),
    ('a6424356-9a61-5048-8609-6477ec78d07b', 'c2ad5ec0-571a-520e-a026-53a0dc75e260', 'call center', 'call center', 'en', NULL, true),
    ('0deda969-a8e1-54b2-9068-eedeb8fa7715', 'c2ad5ec0-571a-520e-a026-53a0dc75e260', 'outsourcing de procesos', 'outsourcing de procesos', 'es', NULL, true),
    ('b0a4682f-151e-583a-92dc-ff39be96088d', '0e890f25-655c-5061-b354-f86c3ab29062', 'servicios temporales', 'servicios temporales', 'es', NULL, true),
    ('5a3864e5-bca9-5562-95ba-0a92650c7ef7', '0e890f25-655c-5061-b354-f86c3ab29062', 'outsourcing de personal', 'outsourcing de personal', 'es', NULL, true),
    ('5c94f3df-8364-5ee7-8919-97e499222af0', '0e890f25-655c-5061-b354-f86c3ab29062', 'empresa de empleo temporal', 'empresa de empleo temporal', 'es', NULL, true),
    ('d8903d05-ddc4-574c-a60d-a9d2f5bc5989', '5a217eb2-0a0e-5a74-b131-e7a34ebe3cb5', '3PL', '3pl', 'en', NULL, true),
    ('b391a0f5-e07e-5388-bc58-9be27beeffa5', '5a217eb2-0a0e-5a74-b131-e7a34ebe3cb5', 'operador logístico', 'operador logistico', 'es', NULL, true),
    ('6a324063-f613-56ac-be06-f92b3788884a', '5a217eb2-0a0e-5a74-b131-e7a34ebe3cb5', 'logistics provider', 'logistics provider', 'en', NULL, true),
    ('c5ea08ea-f395-5299-9502-10269f0d4410', 'adcfeed3-fc65-5c45-bf66-7910446075ca', 'agente de carga', 'agente de carga', 'es', NULL, true),
    ('b6558b78-4a0d-55b2-bfae-feb7591ba325', 'adcfeed3-fc65-5c45-bf66-7910446075ca', 'agencia de aduana', 'agencia de aduana', 'es', NULL, true),
    ('0e6432a1-5454-553d-bd9e-cdc1c2d757f2', 'adcfeed3-fc65-5c45-bf66-7910446075ca', 'freight forwarder', 'freight forwarder', 'en', NULL, true),
    ('9d6d822a-2108-5bde-a1a3-ff8cf80e98bf', 'b43b5ddd-5c4e-5c09-a693-d9b2e3c32ce6', 'constructora', 'constructora', 'es', NULL, true),
    ('b61f1bc8-6f6a-534f-98cd-cb6820bcbaf3', 'b43b5ddd-5c4e-5c09-a693-d9b2e3c32ce6', 'EPC', 'epc', 'en', NULL, true),
    ('46f85ce2-0b09-52b8-8be6-229f67af02a0', 'b43b5ddd-5c4e-5c09-a693-d9b2e3c32ce6', 'facility management', 'facility management', 'en', NULL, true),
    ('e5318ae9-7968-56a7-9c43-c74b98f626f9', 'b43b5ddd-5c4e-5c09-a693-d9b2e3c32ce6', 'obra civil', 'obra civil', 'es', NULL, true),
    ('80ba8291-df16-5d72-89f2-4e03b1d830cd', '87b9e0c7-0d17-5400-93e8-b62906fedf6a', 'oil and gas', 'oil and gas', 'en', NULL, true),
    ('fedb2f44-d976-54c6-994d-5cb77312ebb6', '87b9e0c7-0d17-5400-93e8-b62906fedf6a', 'minería', 'mineria', 'es', NULL, true),
    ('10097932-d87d-5862-814a-8be2bb1b6cdf', '87b9e0c7-0d17-5400-93e8-b62906fedf6a', 'energías renovables', 'energias renovables', 'es', NULL, true),
    ('a5afefe3-238f-53f5-9a81-0f30c4d5232b', '87b9e0c7-0d17-5400-93e8-b62906fedf6a', 'utilities', 'utilities', 'en', NULL, true),
    ('7d6b98ce-7141-5441-b1f6-ce7df38deb7d', 'eaefd820-c413-571b-b9ba-2100eed3e49f', 'agroexportadora', 'agroexportadora', 'es', NULL, true),
    ('0dcb65f7-f4f8-591f-8abc-b62eed394105', 'eaefd820-c413-571b-b9ba-2100eed3e49f', 'agroindustria', 'agroindustria', 'es', NULL, true),
    ('64e7cf01-6680-5743-8f80-e1a14d4d7ba0', 'eaefd820-c413-571b-b9ba-2100eed3e49f', 'agribusiness', 'agribusiness', 'en', NULL, true),
    ('639f4926-c4cb-5072-a6eb-43e487d7c5ee', 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d', 'cadena de supermercados', 'cadena de supermercados', 'es', NULL, true),
    ('c61ad0f4-9463-5c0c-983c-d429c73801ba', 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d', 'hard discount', 'hard discount', 'en', NULL, true),
    ('a74ca74b-456f-5847-9d3b-fa535bdacc77', '2b2ead23-b436-5b62-910e-997995ad2cd2', 'FMCG alimentos', 'fmcg alimentos', 'es', NULL, true),
    ('4d5a6539-cff1-540d-8f4c-986f14aa8e84', '2b2ead23-b436-5b62-910e-997995ad2cd2', 'consumo masivo', 'consumo masivo', 'es', NULL, true),
    ('24578250-a4cf-53a6-94cd-71b72de74166', '2b2ead23-b436-5b62-910e-997995ad2cd2', 'CPG', 'cpg', 'en', NULL, true),
    ('99beb9a1-1a20-564d-9a95-189245b381f3', '76d05169-addd-50f4-b0ef-67e6a0b07fc5', 'metalmecánica', 'metalmecanica', 'es', NULL, true),
    ('e6fcfc99-c182-5b41-839f-35c52fd7a34a', '76d05169-addd-50f4-b0ef-67e6a0b07fc5', 'autopartes', 'autopartes', 'es', NULL, true),
    ('ac677ffc-f887-5a5a-8781-b82f63c67b1d', '76d05169-addd-50f4-b0ef-67e6a0b07fc5', 'tier 1 automotriz', 'tier 1 automotriz', 'es', NULL, true)
;

-- ============================================================
-- INSERT: subindustry_search_terms (228 rows)
-- ============================================================
INSERT INTO public.subindustry_search_terms (
    id, subindustry_id, term, normalized_term, term_type, language_code, country_code, weight, active
) VALUES
    ('b77a30db-ec45-5d3a-a09c-a489cbaa0411', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'software empresarial', 'software empresarial', 'keyword', 'es', NULL, 1.0000, true),
    ('b52829a0-790f-5395-8d74-34bf5b0f219f', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'SaaS B2B', 'saas b2b', 'keyword', 'en', NULL, 1.0000, true),
    ('f1a409f4-0539-5a9a-936a-77a60644a1bf', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'ERP LATAM', 'erp latam', 'keyword', 'es', NULL, 0.9000, true),
    ('b701dd2a-8d1e-55b9-ba08-5463a987dd92', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'empresa de software {country}', 'empresa de software {country}', 'query_phrase', 'es', NULL, 0.8500, true),
    ('13c98c17-3d53-52e3-a8ee-7469dfcf41d8', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'plataforma de gestión empresarial', 'plataforma de gestion empresarial', 'keyword', 'es', NULL, 0.8000, true),
    ('fbca996e-453b-5a3c-ae89-6c72a5957c6b', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'CRM B2B {country}', 'crm b2b {country}', 'query_phrase', 'es', NULL, 0.8000, true),
    ('6d53ac04-e412-5283-a395-6021eb987b45', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'freelancer individual', 'freelancer individual', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('d0d5834a-4c6d-553f-b8b0-0193f2681622', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'software para el hogar', 'software para el hogar', 'exclusion_term', 'es', NULL, 0.7000, true),
    ('404411b5-a9a2-5ee3-8733-f199ae40e556', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'LinkedIn empresa > 20 empleados software', 'linkedin empresa > 20 empleados software', 'source_hint', 'es', NULL, 0.9000, true),
    ('6ef2835b-7381-5c89-8ae0-dee02e96a22e', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'Crunchbase SaaS LATAM', 'crunchbase saas latam', 'source_hint', 'en', NULL, 0.8500, true),
    ('4a8f3a4c-0766-5ee8-b0d9-14677136270c', '40a655f2-0c1a-545d-973a-fb357d6b8da9', 'ciberseguridad empresas', 'ciberseguridad empresas', 'keyword', 'es', NULL, 1.0000, true),
    ('8b5466e8-57ce-57f3-8199-2fb9599eba10', '40a655f2-0c1a-545d-973a-fb357d6b8da9', 'cybersecurity company {country}', 'cybersecurity company {country}', 'query_phrase', 'en', NULL, 0.9500, true),
    ('08398791-a88f-5d9d-9c7f-14af36d8b018', '40a655f2-0c1a-545d-973a-fb357d6b8da9', 'SOC gestión de seguridad', 'soc gestion de seguridad', 'keyword', 'es', NULL, 0.9000, true),
    ('0fe47811-3ee2-5ab4-9c5f-17b770c389b5', '40a655f2-0c1a-545d-973a-fb357d6b8da9', 'empresa de protección de datos LATAM', 'empresa de proteccion de datos latam', 'query_phrase', 'es', NULL, 0.8500, true),
    ('9e743424-a7a2-57b4-933b-456e6eb10b5e', '40a655f2-0c1a-545d-973a-fb357d6b8da9', 'antivirus consumidor final', 'antivirus consumidor final', 'exclusion_term', 'es', NULL, 0.7500, true),
    ('f703869a-ee90-5da4-a7cb-8ee23c8ad917', '40a655f2-0c1a-545d-973a-fb357d6b8da9', 'LinkedIn Companies cybersecurity Colombia Mexico', 'linkedin companies cybersecurity colombia mexico', 'source_hint', 'en', NULL, 0.9000, true),
    ('aa3ff290-a605-59d7-ac9e-0ac2ef1c8a44', 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'cloud computing empresas', 'cloud computing empresas', 'keyword', 'es', NULL, 1.0000, true),
    ('846bc95f-40b3-5f1e-8c61-157c5643a189', 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'proveedor cloud LATAM', 'proveedor cloud latam', 'keyword', 'es', NULL, 0.9500, true),
    ('527bdf79-e7a2-562b-b8f0-0c6a03916ab7', 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'DevOps platform {country}', 'devops platform {country}', 'query_phrase', 'en', NULL, 0.9000, true),
    ('5ae55ecf-5e5a-5423-94e8-f739d73d77cb', 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'cloud hosting B2B', 'cloud hosting b2b', 'keyword', 'en', NULL, 0.8500, true),
    ('bde646e5-3057-5a86-8e71-c37360375678', 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'hosting personal blog', 'hosting personal blog', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('ede02680-8121-54a4-b886-673311389cc0', '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'fintech startup {country}', 'fintech startup {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('18182252-956b-59a4-9121-5e5ac13fdf33', '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'plataforma de pagos digitales', 'plataforma de pagos digitales', 'keyword', 'es', NULL, 0.9500, true),
    ('e5da1ff7-cd0e-5ae7-a127-744f848fcd8c', '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'infraestructura de pagos B2B', 'infraestructura de pagos b2b', 'keyword', 'es', NULL, 0.9000, true),
    ('8a4533cd-1622-5a85-a551-21761d2dd43f', '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'wallet digital empresa tecnológica', 'wallet digital empresa tecnologica', 'keyword', 'es', NULL, 0.8000, true),
    ('98f1ade0-b63c-50d3-8534-8698f7b896fc', '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'banco regulado supervisado', 'banco regulado supervisado', 'exclusion_term', 'es', NULL, 0.8500, true),
    ('1cdbb1fe-5c92-5713-b608-d31c79e11013', '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'aseguradora entidad financiera', 'aseguradora entidad financiera', 'exclusion_term', 'es', NULL, 0.8500, true),
    ('c1ddbc9a-79da-536b-b4c6-b33181ae5c11', '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'Crunchbase fintech payments LATAM', 'crunchbase fintech payments latam', 'source_hint', 'en', NULL, 0.9000, true),
    ('51f90c60-07cd-5f0e-bddd-1ddaf3121a51', '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', 'HR tech empresa {country}', 'hr tech empresa {country}', 'query_phrase', 'en', NULL, 1.0000, true),
    ('ea7174a2-2db3-585b-889c-71ee6067d77f', '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', 'software de recursos humanos', 'software de recursos humanos', 'keyword', 'es', NULL, 0.9500, true),
    ('048cf2c4-4a9a-5ba8-8298-fe9a057ac09b', '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', 'plataforma de gestión del talento', 'plataforma de gestion del talento', 'keyword', 'es', NULL, 0.9000, true),
    ('876b67f1-da4b-53de-be64-76930da846f4', '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', 'nómina digital LATAM', 'nomina digital latam', 'keyword', 'es', NULL, 0.8000, true),
    ('65394e38-1fd2-52ed-9769-a51910f83211', '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', 'empresa de staffing temporal', 'empresa de staffing temporal', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('dc5b14aa-ff27-5f11-b988-eb041a8f90b8', '1a00c933-fc42-5767-bc47-dd0f9be5c9fd', 'marketing automation empresa', 'marketing automation empresa', 'keyword', 'en', NULL, 1.0000, true),
    ('d225425d-6198-5796-b2a4-fea450b2d7ed', '1a00c933-fc42-5767-bc47-dd0f9be5c9fd', 'plataforma de automatización de marketing', 'plataforma de automatizacion de marketing', 'keyword', 'es', NULL, 0.9500, true),
    ('a1abc8d8-175a-56c1-835c-68855d31141c', '1a00c933-fc42-5767-bc47-dd0f9be5c9fd', 'CRM ventas B2B {country}', 'crm ventas b2b {country}', 'query_phrase', 'es', NULL, 0.9000, true),
    ('10996b64-e3bf-5009-9626-9f07fadb5004', '1a00c933-fc42-5767-bc47-dd0f9be5c9fd', 'agencia de marketing digital', 'agencia de marketing digital', 'exclusion_term', 'es', NULL, 0.7500, true),
    ('70d9f763-2437-5d33-af2b-04bd07ece56e', '81203ac3-a280-5d00-97b1-330f429c8495', 'inteligencia artificial empresa B2B', 'inteligencia artificial empresa b2b', 'keyword', 'es', NULL, 1.0000, true),
    ('51b7e70f-3f4f-594c-9bac-18206154678f', '81203ac3-a280-5d00-97b1-330f429c8495', 'AI startup LATAM', 'ai startup latam', 'query_phrase', 'en', NULL, 0.9500, true),
    ('68d81a96-78ab-5ec5-abf6-1522a9cb6db7', '81203ac3-a280-5d00-97b1-330f429c8495', 'machine learning empresa {country}', 'machine learning empresa {country}', 'query_phrase', 'en', NULL, 0.9000, true),
    ('58ede41d-5f0b-5445-aa80-fbe57d78fff2', '81203ac3-a280-5d00-97b1-330f429c8495', 'IA generativa B2B', 'ia generativa b2b', 'keyword', 'es', NULL, 0.9000, true),
    ('f6cfa44a-e8ab-5bc8-90bf-70da024dd1ae', '87a07024-5d94-55fe-b122-7137ad3c9a12', 'plataforma e-commerce B2B', 'plataforma e-commerce b2b', 'keyword', 'es', NULL, 1.0000, true),
    ('876dd6be-4273-503b-91fb-d2a85744fd21', '87a07024-5d94-55fe-b122-7137ad3c9a12', 'comercio electrónico empresa proveedora', 'comercio electronico empresa proveedora', 'keyword', 'es', NULL, 0.9000, true),
    ('577d742a-8447-5d36-80a3-cb3c41b43768', '87a07024-5d94-55fe-b122-7137ad3c9a12', 'tienda online consumidor final', 'tienda online consumidor final', 'exclusion_term', 'es', NULL, 0.7500, true),
    ('177e6178-eab4-5c23-8dc6-586d7b0fce4d', '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', 'health tech empresa B2B', 'health tech empresa b2b', 'keyword', 'en', NULL, 1.0000, true),
    ('10bfe410-a035-5063-bfbb-715e14a81ce8', '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', 'salud digital plataforma', 'salud digital plataforma', 'keyword', 'es', NULL, 0.9500, true),
    ('17f2f95f-2db4-5c35-923a-954c87608272', '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', 'telemedicina B2B empresa tecnológica', 'telemedicina b2b empresa tecnologica', 'keyword', 'es', NULL, 0.9000, true),
    ('c80494cd-487b-5563-bbdd-ec986e991da8', '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', 'hospital red hospitalaria', 'hospital red hospitalaria', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('4b885a2b-e073-5894-90c4-25c6f3cbb381', '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', 'clínica prestadora salud', 'clinica prestadora salud', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('44e50f16-494b-5bf3-806d-436359e338de', 'bdce83c0-9d1f-58a8-82de-7289c676ab0a', 'proptech empresa {country}', 'proptech empresa {country}', 'query_phrase', 'en', NULL, 1.0000, true),
    ('bdaa1962-b9b6-5267-b1f9-c71d99299375', 'bdce83c0-9d1f-58a8-82de-7289c676ab0a', 'plataforma inmobiliaria digital', 'plataforma inmobiliaria digital', 'keyword', 'es', NULL, 0.9000, true),
    ('52f6eb27-3529-5c8a-b989-39f6c512d794', 'bdce83c0-9d1f-58a8-82de-7289c676ab0a', 'inmobiliaria tradicional sin tecnología', 'inmobiliaria tradicional sin tecnologia', 'exclusion_term', 'es', NULL, 0.7500, true),
    ('54ba844a-77b7-54d0-8b53-0e5173fa8cb1', '014296cc-98e4-5433-bc2f-bbcbcadbf252', 'legaltech empresa {country}', 'legaltech empresa {country}', 'query_phrase', 'en', NULL, 1.0000, true),
    ('f14a57f4-6dea-52cc-a313-fea1d71b081f', '014296cc-98e4-5433-bc2f-bbcbcadbf252', 'firma electrónica B2B', 'firma electronica b2b', 'keyword', 'es', NULL, 0.9000, true),
    ('76b03f03-d29b-53ce-9df3-8d0b15ecd910', '014296cc-98e4-5433-bc2f-bbcbcadbf252', 'contratos inteligentes empresa tech', 'contratos inteligentes empresa tech', 'keyword', 'es', NULL, 0.8500, true),
    ('1a973bfd-3390-5aa9-a6b1-090b39c9a6b8', '014296cc-98e4-5433-bc2f-bbcbcadbf252', 'estudio jurídico abogados tradicionales', 'estudio juridico abogados tradicionales', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('b84037f3-7b56-5aa9-97cd-7860b23c7616', 'f286731d-fa78-507c-932c-b028ff6f00d7', 'insurtech empresa {country}', 'insurtech empresa {country}', 'query_phrase', 'en', NULL, 1.0000, true),
    ('600293f0-3696-5757-b828-d80923e3fd42', 'f286731d-fa78-507c-932c-b028ff6f00d7', 'tecnología de seguros B2B', 'tecnologia de seguros b2b', 'keyword', 'es', NULL, 0.9000, true),
    ('ad2263f7-a43d-57c6-8bff-e97c41ffdbef', 'f286731d-fa78-507c-932c-b028ff6f00d7', 'aseguradora regulada SFC', 'aseguradora regulada sfc', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('87b90c22-690a-57c4-9ba6-96d4067d9ae7', '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', 'govtech empresa {country}', 'govtech empresa {country}', 'query_phrase', 'en', NULL, 1.0000, true),
    ('a6e7d21b-9215-5dd9-94c0-5bcbff80db0f', '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', 'gobierno digital empresa', 'gobierno digital empresa', 'keyword', 'es', NULL, 0.9000, true),
    ('323fdab6-c855-519d-8f84-2d2416013d1e', '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', 'ciudad inteligente smart city B2B', 'ciudad inteligente smart city b2b', 'keyword', 'es', NULL, 0.8500, true),
    ('132bd1e3-a7ea-53ba-93b4-e819a799a907', '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', 'entidad pública gobierno', 'entidad publica gobierno', 'exclusion_term', 'es', NULL, 0.8500, true),
    ('f6bb3ef3-d126-59c1-90a1-6f57acb4789d', '52787e3c-6e77-5fb2-b62b-dd999c4df07e', 'agritech empresa LATAM', 'agritech empresa latam', 'query_phrase', 'en', NULL, 1.0000, true),
    ('75f9bc81-7e37-5dcd-9cf6-88c1841118a5', '52787e3c-6e77-5fb2-b62b-dd999c4df07e', 'agricultura de precisión empresa tech', 'agricultura de precision empresa tech', 'keyword', 'es', NULL, 0.9000, true),
    ('3a79c9d3-c942-5240-b330-fea6e25784bf', '52787e3c-6e77-5fb2-b62b-dd999c4df07e', 'agroindustria empresa procesadora', 'agroindustria empresa procesadora', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('161cbaf5-3d7a-58be-95b7-39068541f651', 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', 'business intelligence empresa {country}', 'business intelligence empresa {country}', 'query_phrase', 'en', NULL, 1.0000, true),
    ('e0fc19da-9313-5986-a2d0-8e046693394c', 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', 'analítica de datos plataforma B2B', 'analitica de datos plataforma b2b', 'keyword', 'es', NULL, 0.9500, true),
    ('a4fa5170-1066-5b63-8dc7-247619738635', 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', 'data warehouse empresa', 'data warehouse empresa', 'keyword', 'en', NULL, 0.8500, true),
    ('cdee0f9b-b902-542a-8a4a-846864b527fe', '1b885eed-5d52-5c0b-be1f-a79797d1e7a9', 'IoT empresa B2B {country}', 'iot empresa b2b {country}', 'query_phrase', 'en', NULL, 1.0000, true),
    ('f6ccb8c0-a3c8-5098-82b7-8156e7d3e8ea', '1b885eed-5d52-5c0b-be1f-a79797d1e7a9', 'hardware conectado empresa tecnológica', 'hardware conectado empresa tecnologica', 'keyword', 'es', NULL, 0.9000, true),
    ('511d2d61-2d9d-5ba1-9a39-b3771690c626', '1b885eed-5d52-5c0b-be1f-a79797d1e7a9', 'electrónica consumidor final', 'electronica consumidor final', 'exclusion_term', 'es', NULL, 0.7500, true),
    ('fd1b4c67-afcb-513a-b3dd-250dda466640', 'b684211e-413a-54d3-8989-a8139e2c1285', 'fábrica de software {country}', 'fabrica de software {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('4be78e53-de0f-5593-9175-3a8f66ef7163', 'b684211e-413a-54d3-8989-a8139e2c1285', 'nearshore development LATAM', 'nearshore development latam', 'keyword', 'en', NULL, 0.9500, true),
    ('a8656374-9705-57a0-8f50-f9efd36d1270', 'b684211e-413a-54d3-8989-a8139e2c1285', 'staff augmentation empresa tecnológica', 'staff augmentation empresa tecnologica', 'keyword', 'en', NULL, 0.9000, true),
    ('9775ab63-58c8-5227-a24a-3dc0d8a430ce', 'b684211e-413a-54d3-8989-a8139e2c1285', 'freelancer individual sin empresa', 'freelancer individual sin empresa', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('f90800ba-6e3d-5f16-a094-4f84e28f032b', 'b684211e-413a-54d3-8989-a8139e2c1285', 'LinkedIn Companies software factory Colombia Peru', 'linkedin companies software factory colombia peru', 'source_hint', 'en', NULL, 0.8500, true),
    ('da1a32ce-6fdc-54ed-92b7-05d9345a6461', '7d2ce6cb-2dbd-5c46-93dc-502241887d69', 'telecomunicaciones empresa operadora', 'telecomunicaciones empresa operadora', 'keyword', 'es', NULL, 1.0000, true),
    ('d9bddcd5-e1d4-5ff0-8d5c-9f8e1ebd71f1', '7d2ce6cb-2dbd-5c46-93dc-502241887d69', 'telco proveedor {country}', 'telco proveedor {country}', 'query_phrase', 'es', NULL, 0.9000, true),
    ('76e1248b-5abb-597b-be27-797f7e8d6edf', '7d2ce6cb-2dbd-5c46-93dc-502241887d69', 'CPaaS comunicaciones en la nube B2B', 'cpaas comunicaciones en la nube b2b', 'keyword', 'en', NULL, 0.8500, true),
    ('9563c95e-1e91-5736-980e-d33a229d0ab8', 'ec013b35-657a-5a4d-b500-477222d724bc', 'QA testing empresa {country}', 'qa testing empresa {country}', 'query_phrase', 'en', NULL, 1.0000, true),
    ('8ab7c606-ae31-5b98-b23f-05159308d4de', 'ec013b35-657a-5a4d-b500-477222d724bc', 'RPA automatización de procesos', 'rpa automatizacion de procesos', 'keyword', 'es', NULL, 0.9000, true),
    ('394d73fe-e158-593c-8f2b-7c2e71513d74', 'ec013b35-657a-5a4d-b500-477222d724bc', 'testing automatizado empresa B2B', 'testing automatizado empresa b2b', 'keyword', 'es', NULL, 0.8500, true),
    ('700c5480-22d5-5522-bdc2-afac409926b5', '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', 'plataforma LMS empresa tecnológica', 'plataforma lms empresa tecnologica', 'keyword', 'es', NULL, 1.0000, true),
    ('c6e48944-ceb8-59d7-b35f-019d02e67b50', '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', 'edtech startup {country}', 'edtech startup {country}', 'query_phrase', 'en', NULL, 0.9500, true),
    ('761d391e-d40c-5f14-a0e1-2d09a2e02738', '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', 'e-learning plataforma B2B', 'e-learning plataforma b2b', 'keyword', 'es', NULL, 0.9000, true),
    ('60a6da59-84d0-5547-993e-28248f60acad', '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', 'institución educativa universidad', 'institucion educativa universidad', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('ca8f9d79-fce1-5a6b-a48f-25f22242e615', '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', 'empresa formación corporativa prestadora', 'empresa formacion corporativa prestadora', 'exclusion_term', 'es', NULL, 0.7500, true),
    ('f3629eae-2429-5f10-a930-0f3438bb41bd', '4d764405-cdb7-526e-9468-73fa008bbdc6', 'banco {country} empresa financiera', 'banco {country} empresa financiera', 'query_phrase', 'es', NULL, 1.0000, true),
    ('863c3e17-03c4-5c5e-8988-a58db3c7f229', '4d764405-cdb7-526e-9468-73fa008bbdc6', 'entidad bancaria regulada', 'entidad bancaria regulada', 'keyword', 'es', NULL, 0.9500, true),
    ('bf5ff0c9-f938-53b3-a35b-5d972a9e6045', '4d764405-cdb7-526e-9468-73fa008bbdc6', 'corporativo banca empresas', 'corporativo banca empresas', 'keyword', 'es', NULL, 0.8500, true),
    ('0995dc09-5317-5502-bc47-2e07411bf63a', '4d764405-cdb7-526e-9468-73fa008bbdc6', 'Superintendencia Financiera bancos {country}', 'superintendencia financiera bancos {country}', 'source_hint', 'es', NULL, 0.9000, true),
    ('04505772-da6e-5f87-917e-0e5f53e94f41', '4d764405-cdb7-526e-9468-73fa008bbdc6', 'neobank fintech tecnología pagos', 'neobank fintech tecnologia pagos', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('b08c3a89-18dd-5a88-a93c-94e86a762d47', '968f71cb-1483-538b-83e2-6eaaf6467dcf', 'aseguradora seguros generales {country}', 'aseguradora seguros generales {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('cbd45827-738f-5c76-b861-a7e2629a66e1', '968f71cb-1483-538b-83e2-6eaaf6467dcf', 'compañía de seguros P&C', 'compania de seguros p&c', 'keyword', 'es', NULL, 0.9000, true),
    ('7f3c536a-f316-5ffd-9236-01f8b91af0ab', '968f71cb-1483-538b-83e2-6eaaf6467dcf', 'Fasecolda ACOLDESE directorio aseguradoras', 'fasecolda acoldese directorio aseguradoras', 'source_hint', 'es', NULL, 0.8500, true),
    ('a6c88d44-1f73-59aa-a819-a9abb287e8d6', 'b9c5711c-21fa-51f9-8aca-30d12a012dd9', 'seguros de vida empresa {country}', 'seguros de vida empresa {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('dd848012-a503-5d8f-9938-cf847f64c16d', 'b9c5711c-21fa-51f9-8aca-30d12a012dd9', 'seguro de vida corporativo grupal', 'seguro de vida corporativo grupal', 'keyword', 'es', NULL, 0.9000, true),
    ('d6d32b14-7fbe-546a-b118-11d52a932b5c', '14fdb758-d9d0-56b8-a899-4b2529e87a43', 'broker de seguros {country}', 'broker de seguros {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('8c1d9bbb-18be-574f-84c4-0caf9271a79d', '14fdb758-d9d0-56b8-a899-4b2529e87a43', 'intermediario de seguros corporativo', 'intermediario de seguros corporativo', 'keyword', 'es', NULL, 0.9000, true),
    ('77153bb7-772a-551c-a3b1-c8c4408f52cb', '14fdb758-d9d0-56b8-a899-4b2529e87a43', 'aseguradora directa', 'aseguradora directa', 'exclusion_term', 'es', NULL, 0.7500, true),
    ('75ec37e3-61c2-5047-996b-d8fb641c0923', 'c81af5fd-147f-5525-b9e5-906230842846', 'fintech servicios financieros {country}', 'fintech servicios financieros {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('38fb2611-59e2-583d-9131-a89022e15fda', 'c81af5fd-147f-5525-b9e5-906230842846', 'neobank empresa finanzas', 'neobank empresa finanzas', 'keyword', 'es', NULL, 0.9000, true),
    ('105de461-2d9c-553c-8e80-0b339342f39f', 'c81af5fd-147f-5525-b9e5-906230842846', 'open banking empresa operadora', 'open banking empresa operadora', 'keyword', 'en', NULL, 0.8500, true),
    ('457d9cb3-8504-5291-969c-3a82127da756', 'c81af5fd-147f-5525-b9e5-906230842846', 'empresa que construye tecnología pagos', 'empresa que construye tecnologia pagos', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('75fdaf4e-c7b7-5cd1-a140-21f4bdb2d802', 'c4291ea6-67e1-52ff-ae79-5a67939cf448', 'factoring empresa {country}', 'factoring empresa {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('d13dbd86-c7f6-5cf3-b68f-d686a0a22cfb', 'c4291ea6-67e1-52ff-ae79-5a67939cf448', 'leasing empresarial financiero', 'leasing empresarial financiero', 'keyword', 'es', NULL, 0.9000, true),
    ('235c97dd-f159-58ff-ba95-7d234f1abebf', 'c4291ea6-67e1-52ff-ae79-5a67939cf448', 'crédito empresarial no bancario', 'credito empresarial no bancario', 'keyword', 'es', NULL, 0.8500, true),
    ('880daaf5-13f1-5aa6-9347-980e2bacca50', '87822a25-bfed-5194-8931-b80e2898ea79', 'fondo de inversión gestión activos {country}', 'fondo de inversion gestion activos {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('a373fb0a-b38b-58e6-a2ff-3a55623f21d6', '87822a25-bfed-5194-8931-b80e2898ea79', 'asset management empresa LATAM', 'asset management empresa latam', 'keyword', 'en', NULL, 0.9000, true),
    ('6473dfaf-e00d-535f-a408-eec71fe9c29d', '4668b75d-d69f-50ca-902e-d85767652d79', 'cooperativa financiera {country}', 'cooperativa financiera {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('4f987af6-be7f-531a-9e14-aa9c2b8de655', '4668b75d-d69f-50ca-902e-d85767652d79', 'cooperativa de ahorro y crédito', 'cooperativa de ahorro y credito', 'keyword', 'es', NULL, 0.9000, true),
    ('6cc240b1-a84e-53ee-bf79-bf49daf1a370', '041e7562-9bac-596f-a8a2-346f390c0fe8', 'red hospitalaria privada {country}', 'red hospitalaria privada {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('9d2f64f2-3b20-552c-b11c-073182769cf5', '041e7562-9bac-596f-a8a2-346f390c0fe8', 'grupo hospitalario clínicas', 'grupo hospitalario clinicas', 'keyword', 'es', NULL, 0.9500, true),
    ('9aaef058-2566-5a26-a1f5-4a4fd2ac38b4', '041e7562-9bac-596f-a8a2-346f390c0fe8', 'hospital público gobierno', 'hospital publico gobierno', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('78464637-1ebc-5735-96b2-a0e11326c637', '041e7562-9bac-596f-a8a2-346f390c0fe8', 'empresa tecnología salud plataforma', 'empresa tecnologia salud plataforma', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('88da716c-9b57-5a7e-a57b-cc796f3ff8e9', '8515cd86-1a51-577b-b71c-b4907d56ce1f', 'laboratorio farmacéutico {country}', 'laboratorio farmaceutico {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('ffac47a6-3596-595f-a1eb-cbec1944024f', '8515cd86-1a51-577b-b71c-b4907d56ce1f', 'pharma empresa LATAM', 'pharma empresa latam', 'keyword', 'en', NULL, 0.9500, true),
    ('4b53e10a-7477-5fc0-a5c8-4060f1964397', '8515cd86-1a51-577b-b71c-b4907d56ce1f', 'laboratorio clínico diagnóstico', 'laboratorio clinico diagnostico', 'exclusion_term', 'es', NULL, 0.7500, true),
    ('a6304c8c-97e0-58bd-90a2-cd7503d9e835', 'c08be8e0-c6a9-5988-8a00-6fc666146f06', 'distribuidor farmacéutico {country}', 'distribuidor farmaceutico {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('8b31aead-f972-59c3-90b7-a6f7cc7a0d8c', 'c08be8e0-c6a9-5988-8a00-6fc666146f06', 'cadena distribución medicamentos', 'cadena distribucion medicamentos', 'keyword', 'es', NULL, 0.9000, true),
    ('c93f4044-32d0-52b1-821f-75d1ee2a54ad', '33236dc9-8af2-542f-b88b-06b1584a01f9', 'dispositivos médicos empresa {country}', 'dispositivos medicos empresa {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('d064ef3d-fc69-532e-a874-f2f5b914addd', '33236dc9-8af2-542f-b88b-06b1584a01f9', 'medtech empresa LATAM', 'medtech empresa latam', 'keyword', 'en', NULL, 0.9500, true),
    ('418f43fe-c38a-584d-96d7-2c0da12c84d1', '33236dc9-8af2-542f-b88b-06b1584a01f9', 'equipamiento hospitalario distribuidor', 'equipamiento hospitalario distribuidor', 'keyword', 'es', NULL, 0.8500, true),
    ('f0a024ec-0a0b-5639-aca4-907c570b522c', '431a0c19-885d-5f59-ae46-a4e22f7e9486', 'laboratorio clínico diagnóstico {country}', 'laboratorio clinico diagnostico {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('23e3f738-efed-539e-86d5-07858b7aa129', '431a0c19-885d-5f59-ae46-a4e22f7e9486', 'red de laboratorios clínicos', 'red de laboratorios clinicos', 'keyword', 'es', NULL, 0.9000, true),
    ('2ea0e36b-28f7-53c1-ae31-1ee611ac59c5', 'df0765ed-3842-5b2e-a320-b0cee73b11d4', 'salud ocupacional empresa {country}', 'salud ocupacional empresa {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('84d4f35f-fb87-5fe3-a3f8-a7cefc56fe15', 'df0765ed-3842-5b2e-a320-b0cee73b11d4', 'medicina del trabajo empresa', 'medicina del trabajo empresa', 'keyword', 'es', NULL, 0.9000, true),
    ('8f938ae7-271b-5271-ae01-467c9447709b', 'df0765ed-3842-5b2e-a320-b0cee73b11d4', 'SST seguridad salud trabajo empresa', 'sst seguridad salud trabajo empresa', 'keyword', 'es', NULL, 0.8500, true),
    ('081b23b5-af2d-51a9-b683-3ad97e6313ab', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'EPS medicina prepagada {country}', 'eps medicina prepagada {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('0b696d2c-ff87-59fb-a558-9ad0ff554a0f', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'plan de salud corporativo', 'plan de salud corporativo', 'keyword', 'es', NULL, 0.9000, true),
    ('d52567fd-f89e-56cd-ae92-53d2411d70cd', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'ISAPRE {country}', 'isapre {country}', 'query_phrase', 'es', NULL, 0.8500, true),
    ('02e65971-6927-5b02-ae4d-3a5d0c031820', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'Supersalud Colombia directorio EPS', 'supersalud colombia directorio eps', 'source_hint', 'es', NULL, 0.9000, true),
    ('5394d06e-0f3e-5c3e-b276-d41cec455c0e', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'operadoras de planos privados de saúde empresariais Brasil', 'operadoras de planos privados de saude empresariais brasil', 'query_phrase', 'pt', 'BR', 0.9000, true),
    ('a7f89fbe-49df-57c8-8b2d-13f7c0961b2a', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'hospital clínica prestadora SUS', 'hospital clinica prestadora sus', 'exclusion_term', 'pt', 'BR', 0.8500, true),
    ('1aa34fcb-ae12-57b6-b1eb-578a77803584', '24ea07e9-5a06-5236-92a3-b1f677e9e4fb', 'CRO investigación clínica {country}', 'cro investigacion clinica {country}', 'query_phrase', 'en', NULL, 1.0000, true),
    ('27029e65-68ee-5514-bddf-1af9f6485c98', '24ea07e9-5a06-5236-92a3-b1f677e9e4fb', 'organización de investigación clínica', 'organizacion de investigacion clinica', 'keyword', 'es', NULL, 0.9000, true),
    ('cee6db9b-fe5c-5290-b3cf-95306755d9d4', '975b1e2b-cd1f-59be-a00a-645de8d6ec34', 'equipamiento hospitalario empresa {country}', 'equipamiento hospitalario empresa {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('d7935e9a-a3d5-53d2-834f-33fdde53788c', '975b1e2b-cd1f-59be-a00a-645de8d6ec34', 'proveedor equipos médicos hospital', 'proveedor equipos medicos hospital', 'keyword', 'es', NULL, 0.9000, true),
    ('d24287a4-5c08-50b6-ab39-c1fcb2a778ff', '1779cc43-079d-5a5f-9e15-902f3cdbabae', 'universidad privada {country}', 'universidad privada {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('025595b5-66d7-5922-bdf4-f27d1283bd99', '1779cc43-079d-5a5f-9e15-902f3cdbabae', 'instituto de educación superior privado', 'instituto de educacion superior privado', 'keyword', 'es', NULL, 0.9000, true),
    ('bd31309b-a2ac-53c6-a57e-061ab1fb2e05', '1779cc43-079d-5a5f-9e15-902f3cdbabae', 'universidad pública estatal', 'universidad publica estatal', 'exclusion_term', 'es', NULL, 0.7500, true),
    ('e06987e2-ba3c-5655-a5a6-94293ad9c790', 'a4db23d2-6d94-5463-a171-fbee80028206', 'universidad pública relevante {country}', 'universidad publica relevante {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('7eae605e-04bb-5f37-b8ab-4462d67909b4', 'a4db23d2-6d94-5463-a171-fbee80028206', 'universidad nacional autónoma', 'universidad nacional autonoma', 'keyword', 'es', NULL, 0.8500, true),
    ('6adb736a-859c-5916-bf00-012b8371aaaa', '0f8a58ca-4ff5-5c96-8856-15ec3b74d50c', 'escuela de negocios {country}', 'escuela de negocios {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('0e1cbe3d-9b66-5b6c-9454-e58f09a675e0', '0f8a58ca-4ff5-5c96-8856-15ec3b74d50c', 'MBA ejecutivo LATAM', 'mba ejecutivo latam', 'keyword', 'es', NULL, 0.9000, true),
    ('7eb99359-0902-58b4-97a1-faa3cb412f3d', '0f8a58ca-4ff5-5c96-8856-15ec3b74d50c', 'formación ejecutiva liderazgo empresa', 'formacion ejecutiva liderazgo empresa', 'keyword', 'es', NULL, 0.8500, true),
    ('4a1dae72-8688-5fc4-9d2b-e3c6c8db428e', '2b631bf6-425d-53ce-8f9d-d156713df570', 'capacitación corporativa empresa {country}', 'capacitacion corporativa empresa {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('0a515f38-24be-50b9-a31a-0ebff6361caf', '2b631bf6-425d-53ce-8f9d-d156713df570', 'formación in-company B2B', 'formacion in-company b2b', 'keyword', 'es', NULL, 0.9500, true),
    ('08ab0b3a-80a5-581a-8517-65d1bc8ce57c', '2b631bf6-425d-53ce-8f9d-d156713df570', 'proveedor training empresas', 'proveedor training empresas', 'keyword', 'es', NULL, 0.9000, true),
    ('06ef63fa-cae6-5f47-ba25-677037e32192', '2b631bf6-425d-53ce-8f9d-d156713df570', 'plataforma LMS e-learning tecnológica', 'plataforma lms e-learning tecnologica', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('4178c60c-e2d7-5cb2-a9e7-ce2e3403afe8', '2b631bf6-425d-53ce-8f9d-d156713df570', 'LinkedIn Learning UBITS formación corporativa directorio', 'linkedin learning ubits formacion corporativa directorio', 'source_hint', 'es', NULL, 0.9000, true),
    ('042545cf-6e71-5334-8bf8-018e0b57530d', 'c7cd8535-8714-58ba-ad16-2d157102cb48', 'instituto técnico vocacional {country}', 'instituto tecnico vocacional {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('9f358e2d-6bb7-5793-9cba-8a2866630e71', 'c7cd8535-8714-58ba-ad16-2d157102cb48', 'formación técnica profesional LATAM', 'formacion tecnica profesional latam', 'keyword', 'es', NULL, 0.9000, true),
    ('7d5a27a5-009b-5596-8ebd-31fcb24b9eef', 'c7cd8535-8714-58ba-ad16-2d157102cb48', 'SENA OTEC SENATI CONALEP', 'sena otec senati conalep', 'keyword', 'es', NULL, 0.8500, true),
    ('7c473f13-4c0a-5163-9d5b-06465e029255', '3e9f8993-6d08-5206-8f71-d69b9f99a71c', 'certificación profesional empresa {country}', 'certificacion profesional empresa {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('11c88a45-e8ae-5d04-ae29-8bebc4a8e4a3', '3e9f8993-6d08-5206-8f71-d69b9f99a71c', 'proveedor certificaciones tech B2B', 'proveedor certificaciones tech b2b', 'keyword', 'es', NULL, 0.9000, true),
    ('c9e88372-a137-5dbb-bd9b-69ff0f4dc666', '8efb5b7b-4790-570d-ade7-a44effcd5a49', 'grupo educativo red colegios {country}', 'grupo educativo red colegios {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('33773097-5ae8-5300-b807-9a80dba45a0e', '8efb5b7b-4790-570d-ade7-a44effcd5a49', 'holding educativo LATAM', 'holding educativo latam', 'keyword', 'es', NULL, 0.9000, true),
    ('b7cb7af1-f587-5bcc-a4ac-fbb558cc18e4', 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d', 'cadena supermercados {country}', 'cadena supermercados {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('361593f0-8eb4-5f29-ad92-f500267006f0', 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d', 'hipermercado hard discount retail', 'hipermercado hard discount retail', 'keyword', 'es', NULL, 0.9000, true),
    ('c8b47d92-a94b-5a69-bb10-cd8b60147062', '912a4b36-8597-5204-bb8e-814fb0769505', 'tienda por departamentos {country}', 'tienda por departamentos {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('a512a1b8-c91a-5942-878a-f4453694f878', '912a4b36-8597-5204-bb8e-814fb0769505', 'cadena moda retail fashion', 'cadena moda retail fashion', 'keyword', 'es', NULL, 0.9000, true),
    ('034aec57-7d86-5aac-b2e9-7bf5e35e07d6', 'd49ba019-c2e4-59b5-bc58-12724ec1f152', 'cadena farmacias {country}', 'cadena farmacias {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('ef230bde-c766-5133-90c5-99de7893c4f6', 'd49ba019-c2e4-59b5-bc58-12724ec1f152', 'droguerías cadena retail farmacia', 'droguerias cadena retail farmacia', 'keyword', 'es', NULL, 0.9000, true),
    ('69d99231-0d9a-575b-bae5-0b16e0e6a308', '9d036663-b424-5989-9bfc-02c85b0c25c8', 'retailer especializado {country}', 'retailer especializado {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('594ab521-2383-5f51-9422-f3389db988d2', '9d036663-b424-5989-9bfc-02c85b0c25c8', 'cadena electrodomésticos ferretería materiales', 'cadena electrodomesticos ferreteria materiales', 'keyword', 'es', NULL, 0.8500, true),
    ('1a424779-f3eb-5f8e-8e92-5b06efc186ce', '8f893965-daf2-508f-95c7-bbc332595f3e', 'operador omnicanal retail {country}', 'operador omnicanal retail {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('5fd34680-4717-52b9-bbae-536bb48e3149', '8f893965-daf2-508f-95c7-bbc332595f3e', 'retail omnichannel ecommerce físico', 'retail omnichannel ecommerce fisico', 'keyword', 'es', NULL, 0.9000, true),
    ('39f344cf-25b1-5af8-ab3c-aefd05cefd85', '2b2ead23-b436-5b62-910e-997995ad2cd2', 'fabricante alimentos bebidas {country}', 'fabricante alimentos bebidas {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('5733c037-3414-5138-81a7-123f5889a758', '2b2ead23-b436-5b62-910e-997995ad2cd2', 'empresa FMCG consumo masivo LATAM', 'empresa fmcg consumo masivo latam', 'keyword', 'es', NULL, 0.9500, true),
    ('b880a7ce-c414-59a5-a97c-e0276c5a692f', '2b2ead23-b436-5b62-910e-997995ad2cd2', 'CPG food beverage empresa', 'cpg food beverage empresa', 'keyword', 'en', NULL, 0.8500, true),
    ('e1f02a6f-c2b6-577f-a240-028a66b744fa', '228440c9-a8d7-51b9-96cd-47bac896b0cf', 'empresa cuidado personal higiene hogar {country}', 'empresa cuidado personal higiene hogar {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('6558287a-e502-5ddb-8e4d-59ccab2ad7e0', '228440c9-a8d7-51b9-96cd-47bac896b0cf', 'FMCG cuidado personal LATAM', 'fmcg cuidado personal latam', 'keyword', 'es', NULL, 0.9000, true),
    ('fd61e7a8-bda3-56d8-b580-73eaa14d1fbb', '76d05169-addd-50f4-b0ef-67e6a0b07fc5', 'empresa metalmecánica {country}', 'empresa metalmecanica {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('1d626a44-52d1-5dfe-8c08-4fce65890657', '76d05169-addd-50f4-b0ef-67e6a0b07fc5', 'fabricante autopartes LATAM', 'fabricante autopartes latam', 'keyword', 'es', NULL, 0.9000, true),
    ('3de6a8a5-117e-5a92-93b3-b62356b7eb7c', '76d05169-addd-50f4-b0ef-67e6a0b07fc5', 'acería siderurgia manufactura metal', 'aceria siderurgia manufactura metal', 'keyword', 'es', NULL, 0.8500, true),
    ('44f27706-3de7-59b6-b746-22cd78a8a5bf', '55386a47-3bec-510a-91c6-ba61341f5676', 'empresa química plásticos {country}', 'empresa quimica plasticos {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('558229b7-6a3d-5e09-81e0-bc765f2e2451', '55386a47-3bec-510a-91c6-ba61341f5676', 'fabricante packaging embalajes', 'fabricante packaging embalajes', 'keyword', 'es', NULL, 0.9000, true),
    ('2cab6b54-5ecc-5f83-87fd-ecb6a604cf92', '9ff59aa5-f2b2-5271-a506-73470ba9a4d2', 'fabricante maquinaria bienes de capital {country}', 'fabricante maquinaria bienes de capital {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('0bee207d-3caf-56bb-887d-88ab1bdec748', '9ff59aa5-f2b2-5271-a506-73470ba9a4d2', 'equipo industrial empresa manufactura', 'equipo industrial empresa manufactura', 'keyword', 'es', NULL, 0.9000, true),
    ('e8b2f699-1a00-5ea7-a4df-10b871a5e400', '9158a6ee-d7ce-524b-a7e9-dc24f3269f92', 'empresa manufactura exportadora {country}', 'empresa manufactura exportadora {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('352f358c-e958-533c-80fc-e52376e9d7fe', '9158a6ee-d7ce-524b-a7e9-dc24f3269f92', 'maquiladora exportación LATAM', 'maquiladora exportacion latam', 'keyword', 'es', NULL, 0.8500, true),
    ('c8b56c1d-c03c-554f-a7c7-9775732ba196', 'b43b5ddd-5c4e-5c09-a693-d9b2e3c32ce6', 'constructora obras civiles {country}', 'constructora obras civiles {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('8af5b441-9e43-53a8-907a-e2cdbee7e9e3', 'b43b5ddd-5c4e-5c09-a693-d9b2e3c32ce6', 'empresa construcción infraestructura EPC', 'empresa construccion infraestructura epc', 'keyword', 'es', NULL, 0.9000, true),
    ('e3aa25bb-7007-513d-8487-f169f84e811c', 'b43b5ddd-5c4e-5c09-a693-d9b2e3c32ce6', 'CAMACOL Cámara Colombiana Construcción directorio', 'camacol camara colombiana construccion directorio', 'source_hint', 'es', NULL, 0.8500, true),
    ('2e96a61d-27d3-5bc7-8121-39a0491b7f51', '87b9e0c7-0d17-5400-93e8-b62906fedf6a', 'empresa energía minería {country}', 'empresa energia mineria {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('d6d0af8f-0ded-5dad-8be4-5bb2be311f81', '87b9e0c7-0d17-5400-93e8-b62906fedf6a', 'oil gas empresa LATAM', 'oil gas empresa latam', 'keyword', 'en', NULL, 0.9000, true),
    ('ff53a610-be58-56a0-ba93-00e0854cc393', '87b9e0c7-0d17-5400-93e8-b62906fedf6a', 'energías renovables empresa operadora', 'energias renovables empresa operadora', 'keyword', 'es', NULL, 0.8500, true),
    ('5e5f3886-3afb-50ee-b8d4-f085d3e488e2', '87b9e0c7-0d17-5400-93e8-b62906fedf6a', 'tech empresa proveedora tecnología energía', 'tech empresa proveedora tecnologia energia', 'exclusion_term', 'es', NULL, 0.7500, true),
    ('cfb61d5c-027e-5e81-a5e3-d3017bcf832b', 'eaefd820-c413-571b-b9ba-2100eed3e49f', 'agroindustria empresa procesadora {country}', 'agroindustria empresa procesadora {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('4a7fff76-8e73-5b9a-bc9f-560d71ef5d7a', 'eaefd820-c413-571b-b9ba-2100eed3e49f', 'agroexportadora LATAM empresa', 'agroexportadora latam empresa', 'keyword', 'es', NULL, 0.9000, true),
    ('dbc0375b-911e-5d53-a25c-eba798973b0e', 'eaefd820-c413-571b-b9ba-2100eed3e49f', 'empresa tecnología agrícola agritech', 'empresa tecnologia agricola agritech', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('5c9578a9-4d35-5df8-91d3-725f8dc87dbf', 'd6b54f2b-6de3-55de-b84d-fa894fe5e7a8', 'consultoría estratégica empresa {country}', 'consultoria estrategica empresa {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('95952e42-e206-5cdf-8bed-192f534ec373', 'd6b54f2b-6de3-55de-b84d-fa894fe5e7a8', 'firma de consultoría de gestión LATAM', 'firma de consultoria de gestion latam', 'keyword', 'es', NULL, 0.9000, true),
    ('bab65272-1fbb-539b-af1d-e45335e1b97e', 'd6b54f2b-6de3-55de-b84d-fa894fe5e7a8', 'Big 4 consultoría estratégica', 'big 4 consultoria estrategica', 'keyword', 'es', NULL, 0.8500, true),
    ('4370725f-b2fb-5d3a-abc5-2db5ca2ede70', 'abf86c42-cf23-532c-8343-5db4e225b57e', 'firma auditoría contabilidad {country}', 'firma auditoria contabilidad {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('b4a19167-81b7-58af-b80a-1fb1d7371711', 'abf86c42-cf23-532c-8343-5db4e225b57e', 'empresa auditora contable LATAM', 'empresa auditora contable latam', 'keyword', 'es', NULL, 0.9000, true),
    ('e5c93bcb-4184-5996-9f3e-16ba679ece84', 'dd4c52eb-81ec-5de5-97f3-6ab745bbae7c', 'firma legal servicios jurídicos {country}', 'firma legal servicios juridicos {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('bd024b9d-f418-5d6f-a79e-3217114b36e4', 'dd4c52eb-81ec-5de5-97f3-6ab745bbae7c', 'estudio jurídico compliance corporativo', 'estudio juridico compliance corporativo', 'keyword', 'es', NULL, 0.9000, true),
    ('4c9bc784-a722-5453-bb2e-ebe6bbbb74ee', 'dd4c52eb-81ec-5de5-97f3-6ab745bbae7c', 'empresa legaltech tecnología contratos', 'empresa legaltech tecnologia contratos', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('ce3d2238-000c-5ad1-b2cc-cd4919fcffb7', 'c2ad5ec0-571a-520e-a026-53a0dc75e260', 'BPO contact center empresa {country}', 'bpo contact center empresa {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('e97d94eb-89b2-59fb-bd9b-303dfcf1ceb9', 'c2ad5ec0-571a-520e-a026-53a0dc75e260', 'empresa outsourcing procesos LATAM', 'empresa outsourcing procesos latam', 'keyword', 'es', NULL, 0.9000, true),
    ('d043e6c6-2cf7-5c91-a56e-056e52aafd3b', 'c2ad5ec0-571a-520e-a026-53a0dc75e260', 'empresa tecnología call center software', 'empresa tecnologia call center software', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('292813c0-e168-5166-9cb3-c0e0998145d4', '0e890f25-655c-5061-b354-f86c3ab29062', 'empresa servicios temporales {country}', 'empresa servicios temporales {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('cbbb467c-6e70-5fed-a682-5bba5ffd40c4', '0e890f25-655c-5061-b354-f86c3ab29062', 'outsourcing nómina personal empresa', 'outsourcing nomina personal empresa', 'keyword', 'es', NULL, 0.9000, true),
    ('0f0211ad-11c2-54e2-b0c5-9e0cca2bb1f2', '0e890f25-655c-5061-b354-f86c3ab29062', 'empresa HR tech software nómina', 'empresa hr tech software nomina', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('47cd4c84-5731-5adc-9763-4eedd63c3a1b', 'fe8187a9-9e99-5f85-bf36-a1de8c0ec0c4', 'servicios de facilities empresa {country}', 'servicios de facilities empresa {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('028bbe47-26f9-5740-894c-8334683f5b37', 'fe8187a9-9e99-5f85-bf36-a1de8c0ec0c4', 'vigilancia seguridad privada empresa', 'vigilancia seguridad privada empresa', 'keyword', 'es', NULL, 0.9000, true),
    ('0753bbda-14d1-5d55-b1d3-863bf5e68a54', 'fe8187a9-9e99-5f85-bf36-a1de8c0ec0c4', 'empresa ciberseguridad tecnología digital', 'empresa ciberseguridad tecnologia digital', 'exclusion_term', 'es', NULL, 0.8000, true),
    ('16b72289-e37f-5d70-b682-e00238f6ec50', '6c83d574-3ca3-5579-bf8e-9c450c4f43c7', 'investigación de mercados empresa {country}', 'investigacion de mercados empresa {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('bb32dee3-9733-509b-bd3f-119a6ccd1375', '6c83d574-3ca3-5579-bf8e-9c450c4f43c7', 'market research inteligencia de negocios', 'market research inteligencia de negocios', 'keyword', 'en', NULL, 0.9000, true),
    ('7334488a-fbdd-517f-a1e7-6150b32060c6', '5a217eb2-0a0e-5a74-b131-e7a34ebe3cb5', 'operador logístico 3PL {country}', 'operador logistico 3pl {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('ea6b6634-a26f-5ff6-9d27-101d6058bbd1', '5a217eb2-0a0e-5a74-b131-e7a34ebe3cb5', 'proveedor logística B2B LATAM', 'proveedor logistica b2b latam', 'keyword', 'es', NULL, 0.9500, true),
    ('e78c72db-f627-5532-9aa3-03fd9baf2a66', '695bf6e7-c121-5bc5-940a-5def8d79f523', 'empresa transporte carga terrestre {country}', 'empresa transporte carga terrestre {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('900668b1-ccb3-596f-b6fe-133a588f7410', '695bf6e7-c121-5bc5-940a-5def8d79f523', 'flota de camiones empresa transporte', 'flota de camiones empresa transporte', 'keyword', 'es', NULL, 0.9000, true),
    ('5b102618-fbef-55b3-a9fc-962a31eff110', 'adcfeed3-fc65-5c45-bf66-7910446075ca', 'freight forwarder agencia aduana {country}', 'freight forwarder agencia aduana {country}', 'query_phrase', 'en', NULL, 1.0000, true),
    ('13a169a5-def9-54ed-b73b-4eff47614e58', 'adcfeed3-fc65-5c45-bf66-7910446075ca', 'agente de carga internacional LATAM', 'agente de carga internacional latam', 'keyword', 'es', NULL, 0.9000, true),
    ('c1c7a316-1cd2-520e-93f7-e6d1f7f98768', 'c92627a7-95c6-542f-bb35-f88d401e53c4', 'cadena de frío farmacéutica {country}', 'cadena de frio farmaceutica {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('bcccbe8b-5e3c-5767-af0f-6fead0e31337', 'c92627a7-95c6-542f-bb35-f88d401e53c4', 'almacenamiento temperatura controlada medicamentos', 'almacenamiento temperatura controlada medicamentos', 'keyword', 'es', NULL, 0.9000, true),
    ('ef2cc673-9f16-559d-8441-237d5a75953d', '2effb010-8309-5e97-92dd-3b50a5400de6', 'empresa warehousing fulfillment {country}', 'empresa warehousing fulfillment {country}', 'query_phrase', 'en', NULL, 1.0000, true),
    ('3bfeb71e-2da7-57bd-adf8-db687f2d98ab', '2effb010-8309-5e97-92dd-3b50a5400de6', 'bodegaje almacenamiento empresarial LATAM', 'bodegaje almacenamiento empresarial latam', 'keyword', 'es', NULL, 0.9000, true),
    ('0da4bd5e-67a1-5c2f-aab0-26db617aed37', 'ae3d1714-e36a-549c-986e-fc53ffa63d80', 'operador portuario aeroportuario {country}', 'operador portuario aeroportuario {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('a79ee756-9f40-5078-957a-5952ac2dc979', 'ae3d1714-e36a-549c-986e-fc53ffa63d80', 'terminal portuaria empresa logística', 'terminal portuaria empresa logistica', 'keyword', 'es', NULL, 0.9000, true),
    ('bf97f3b7-eea5-553e-a35d-29375e0f87b3', 'e729fcea-2082-55b8-a945-8ed65adac821', 'logística minería energía empresa {country}', 'logistica mineria energia empresa {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('856cd4ab-16e9-5e16-aca2-0a388657f968', 'e729fcea-2082-55b8-a945-8ed65adac821', 'transporte especializado industria extractiva', 'transporte especializado industria extractiva', 'keyword', 'es', NULL, 0.9000, true),
    ('0cf35dc2-03c3-588b-8340-7f2a5e37a38a', '7564d31e-3d32-5c3e-b795-81093419f83a', 'courier mensajería empresarial {country}', 'courier mensajeria empresarial {country}', 'query_phrase', 'es', NULL, 1.0000, true),
    ('c23f98e9-4ffd-59cb-9684-36e352375701', '7564d31e-3d32-5c3e-b795-81093419f83a', 'última milla B2B empresa', 'ultima milla b2b empresa', 'keyword', 'es', NULL, 0.8500, true)
;

-- ============================================================
-- INSERT: industry_rules (42 rows)
-- NOTE: source file (industry-common-rules.json) contains 42 rules.
--       Pre-seed audit estimated 48; actual canonical count is used here.
-- ============================================================
INSERT INTO public.industry_rules (
    id, catalog_version_id, industry_id, rule_key, rule_type, execution_layer, priority,
    rule_text, configuration, source_document, source_section, active, sort_order
) VALUES
    ('b2107e73-507e-5c5f-83e6-1ccb1ec8c1da', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'TECNOLOGIA_INCLUSION_01', 'inclusion', 'model', 'high', 'La empresa opera principalmente como proveedor de tecnología (su producto o servicio principal es tecnología vendida a otras organizaciones)', '{}'::jsonb, 'industry-common-rules.json', 'tecnologia.inclusion', true, 0),
    ('ca152a94-536e-5e41-afe1-801281d3b449', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'TECNOLOGIA_INCLUSION_02', 'inclusion', 'model', 'normal', 'Tiene presencia digital documentable (web, LinkedIn, Crunchbase, GitHub organizacional)', '{}'::jsonb, 'industry-common-rules.json', 'tecnologia.inclusion', true, 1),
    ('30b12fb2-fe8b-51f4-8bd7-d36d4d389a5b', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'TECNOLOGIA_EXCLUSION_01', 'exclusion', 'model', 'high', 'Es un departamento de TI interno de una empresa no tecnológica', '{}'::jsonb, 'industry-common-rules.json', 'tecnologia.exclusion', true, 0),
    ('43357da6-0f70-552a-8361-963a065fc749', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'TECNOLOGIA_EXCLUSION_02', 'exclusion', 'model', 'normal', 'Opera exclusivamente como entidad regulada financiera, de salud o educativa sin un producto tecnológico propio', '{}'::jsonb, 'industry-common-rules.json', 'tecnologia.exclusion', true, 1),
    ('87943ea3-6e37-5acc-9a69-8899d5b1f61b', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'TECNOLOGIA_QUALITY_GATE_01', 'quality_gate', 'model', 'high', 'Empresa con al menos 5 empleados verificables en LinkedIn o registro mercantil', '{}'::jsonb, 'industry-common-rules.json', 'tecnologia.quality_gate', true, 0),
    ('e46b054e-29cc-5d91-95e9-cd20fecf669a', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', 'TECNOLOGIA_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene equipo técnico y comercial identificable (CTO, CPO, VP of Sales o equivalente)', '{}'::jsonb, 'industry-common-rules.json', 'tecnologia.fit_signal', true, 0),
    ('605363c7-b2bc-5e66-a655-3258114915e2', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '7f728594-1ad2-5837-abed-88b90b067e21', 'SERVICIOS_FINANCIEROS_INCLUSION_01', 'inclusion', 'model', 'high', 'Entidad regulada por el ente supervisor financiero del país (SFC Colombia, CNBV México, CMF Chile, SBS Perú/Ecuador, etc.)', '{}'::jsonb, 'industry-common-rules.json', 'servicios-financieros.inclusion', true, 0),
    ('667cd8cb-44ff-5e08-9015-cc1e8771b244', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '7f728594-1ad2-5837-abed-88b90b067e21', 'SERVICIOS_FINANCIEROS_INCLUSION_02', 'inclusion', 'model', 'normal', 'O bien entidad que opera servicios financieros con registro mercantil en sector financiero aunque aún en proceso de licenciamiento', '{}'::jsonb, 'industry-common-rules.json', 'servicios-financieros.inclusion', true, 1),
    ('9acb85c2-cb12-54eb-88a4-bdf140701922', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '7f728594-1ad2-5837-abed-88b90b067e21', 'SERVICIOS_FINANCIEROS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa de tecnología que construye software para el sector financiero sin operar servicios propios', '{}'::jsonb, 'industry-common-rules.json', 'servicios-financieros.exclusion', true, 0),
    ('be1faa53-851d-51d8-a1cb-244ce597f65e', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '7f728594-1ad2-5837-abed-88b90b067e21', 'SERVICIOS_FINANCIEROS_QUALITY_GATE_01', 'quality_gate', 'model', 'high', 'Entidad con operación activa verificable por listados regulatorios o reportes financieros públicos', '{}'::jsonb, 'industry-common-rules.json', 'servicios-financieros.quality_gate', true, 0),
    ('654684da-d261-5ace-8c3e-09e5767aff3a', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '7f728594-1ad2-5837-abed-88b90b067e21', 'SERVICIOS_FINANCIEROS_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene área de Recursos Humanos o Capacitación documentada con más de 3 personas', '{}'::jsonb, 'industry-common-rules.json', 'servicios-financieros.fit_signal', true, 0),
    ('67f642ab-6dc7-5597-83ac-31a197ba6fab', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '7f728594-1ad2-5837-abed-88b90b067e21', 'SERVICIOS_FINANCIEROS_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Más de 100 empleados (señal de escala que justifica formación corporativa)', '{}'::jsonb, 'industry-common-rules.json', 'servicios-financieros.fit_signal', true, 1),
    ('304de949-7f91-5e56-bbdc-011bee40ae2b', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '2c5f0aa0-9116-50ef-838d-68dc01f33ada', 'SALUD_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa u organización con habilitación sanitaria, registro de laboratorio o autorización regulatoria para operar en el sector salud', '{}'::jsonb, 'industry-common-rules.json', 'salud.inclusion', true, 0),
    ('010d8d43-16c0-5803-b594-e17afc29efee', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '2c5f0aa0-9116-50ef-838d-68dc01f33ada', 'SALUD_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa de tecnología que desarrolla software o hardware de salud sin prestar servicios de salud directamente', '{}'::jsonb, 'industry-common-rules.json', 'salud.exclusion', true, 0),
    ('c5b7343a-1424-5d32-9ab6-927f4e4947e7', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '2c5f0aa0-9116-50ef-838d-68dc01f33ada', 'SALUD_QUALITY_GATE_01', 'quality_gate', 'model', 'high', 'Entidad con código de habilitación, registro INVIMA, COFEPRIS, ISP u equivalente verificable', '{}'::jsonb, 'industry-common-rules.json', 'salud.quality_gate', true, 0),
    ('d9ce5ee5-9417-5bb9-b9e4-696b62cb0de5', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '2c5f0aa0-9116-50ef-838d-68dc01f33ada', 'SALUD_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene área de docencia médica, residencias clínicas o convenios universitarios', '{}'::jsonb, 'industry-common-rules.json', 'salud.fit_signal', true, 0),
    ('7ad9ce41-1d36-5f31-9ebf-38a7122f2cbb', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '2c5f0aa0-9116-50ef-838d-68dc01f33ada', 'SALUD_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Tiene equipo de SST o salud ocupacional para sus propios empleados (señal de madurez organizacional)', '{}'::jsonb, 'industry-common-rules.json', 'salud.fit_signal', true, 1),
    ('ccc1b8cc-5181-546d-98eb-1a29ac321d8f', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '263192bb-4db8-585c-9220-a9eabb77f9e9', 'EDUCACION_INCLUSION_01', 'inclusion', 'model', 'high', 'Organización cuya actividad principal es la formación, capacitación o certificación de personas', '{}'::jsonb, 'industry-common-rules.json', 'educacion.inclusion', true, 0),
    ('3788321d-ca0f-5dbd-ae30-5de1a5084da6', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '263192bb-4db8-585c-9220-a9eabb77f9e9', 'EDUCACION_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa tecnológica que desarrolla plataformas de aprendizaje pero no imparte formación directamente', '{}'::jsonb, 'industry-common-rules.json', 'educacion.exclusion', true, 0),
    ('5f4f598c-291e-5f0a-9c04-c95c7f7a1f6a', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '263192bb-4db8-585c-9220-a9eabb77f9e9', 'EDUCACION_QUALITY_GATE_01', 'quality_gate', 'model', 'high', 'Reconocimiento por ministerio de educación, registro de SENA/OTEC/SENATI u organismo certificador en el país', '{}'::jsonb, 'industry-common-rules.json', 'educacion.quality_gate', true, 0),
    ('648a7e36-2ba4-53ae-9818-f990630c69e3', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '263192bb-4db8-585c-9220-a9eabb77f9e9', 'EDUCACION_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene programa de capacitación docente o desarrollo profesional para su propio personal', '{}'::jsonb, 'industry-common-rules.json', 'educacion.fit_signal', true, 0),
    ('c85f0643-f087-55b6-82d1-d32facdaab58', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '263192bb-4db8-585c-9220-a9eabb77f9e9', 'EDUCACION_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Ofrece formación modular o certificación por competencias (señal de orientación corporativa)', '{}'::jsonb, 'industry-common-rules.json', 'educacion.fit_signal', true, 1),
    ('8843efbc-4f9f-5981-98cf-744220ef7450', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e9338391-f2d1-5c84-90da-49a5508e4d3f', 'RETAIL_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa con operación comercial de venta al consumidor o B2B de productos físicos o de consumo masivo', '{}'::jsonb, 'industry-common-rules.json', 'retail.inclusion', true, 0),
    ('a28cbba4-8687-5864-abf8-8593a71a820e', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e9338391-f2d1-5c84-90da-49a5508e4d3f', 'RETAIL_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa de tecnología o plataforma digital que habilita el e-commerce pero no opera retail propio', '{}'::jsonb, 'industry-common-rules.json', 'retail.exclusion', true, 0),
    ('3b6a9737-4c85-5703-805d-90244c4cf510', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e9338391-f2d1-5c84-90da-49a5508e4d3f', 'RETAIL_QUALITY_GATE_01', 'quality_gate', 'model', 'high', 'Más de 3 puntos de venta o presencia nacional/regional verificable', '{}'::jsonb, 'industry-common-rules.json', 'retail.quality_gate', true, 0),
    ('c266baaf-413e-5f72-a3fc-36e92e25505d', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e9338391-f2d1-5c84-90da-49a5508e4d3f', 'RETAIL_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene área de recursos humanos con capacitación de fuerza de ventas o cajeros', '{}'::jsonb, 'industry-common-rules.json', 'retail.fit_signal', true, 0),
    ('b71be777-647e-557c-ac1e-d6ef8492fe8b', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e9338391-f2d1-5c84-90da-49a5508e4d3f', 'RETAIL_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Programa de formación en servicio al cliente o manejo de inventarios documentado', '{}'::jsonb, 'industry-common-rules.json', 'retail.fit_signal', true, 1),
    ('6dbb64e3-984f-50ce-b62b-afe115be8ac4', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'da9e4f93-b45e-5874-94de-a7b50f739daa', 'MANUFACTURA_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa con planta de producción, obra en ejecución u operación industrial verificable', '{}'::jsonb, 'industry-common-rules.json', 'manufactura.inclusion', true, 0),
    ('65bd5ad6-91d8-5f6e-b1f2-b8f515838f99', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'da9e4f93-b45e-5874-94de-a7b50f739daa', 'MANUFACTURA_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa de tecnología o consultoría sin operación industrial física propia', '{}'::jsonb, 'industry-common-rules.json', 'manufactura.exclusion', true, 0),
    ('84a9fc67-fbef-5bdf-bebf-5a5f9478e9ed', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'da9e4f93-b45e-5874-94de-a7b50f739daa', 'MANUFACTURA_QUALITY_GATE_01', 'quality_gate', 'model', 'high', 'Número de empleados mayor a 20 (operación industrial relevante) o registro de exportaciones', '{}'::jsonb, 'industry-common-rules.json', 'manufactura.quality_gate', true, 0),
    ('88c6bb47-3930-524b-b109-f9530ce18aae', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'da9e4f93-b45e-5874-94de-a7b50f739daa', 'MANUFACTURA_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Certificación ISO 9001, 14001 o OHSAS 18001 (señal de madurez y necesidad de formación)', '{}'::jsonb, 'industry-common-rules.json', 'manufactura.fit_signal', true, 0),
    ('344752e6-812d-5cb5-abfb-078023d4760c', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'da9e4f93-b45e-5874-94de-a7b50f739daa', 'MANUFACTURA_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Tiene área de capacitación operativa o HSEQ documentada', '{}'::jsonb, 'industry-common-rules.json', 'manufactura.fit_signal', true, 1),
    ('08f89d28-011f-5372-bfc5-57e0435d549d', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', 'CONSULTORIA_SERVICIOS_PROFESIONALES_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa cuyo producto principal es conocimiento o servicios profesionales entregados a otras organizaciones', '{}'::jsonb, 'industry-common-rules.json', 'consultoria-servicios-profesionales.inclusion', true, 0),
    ('17b07b0c-07c2-5aca-b5c9-746aef549270', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', 'CONSULTORIA_SERVICIOS_PROFESIONALES_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa que vende tecnología como producto principal (incluso si brinda consultoría como servicio secundario)', '{}'::jsonb, 'industry-common-rules.json', 'consultoria-servicios-profesionales.exclusion', true, 0),
    ('7da89621-b826-5c31-bac0-9212a4601cd9', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', 'CONSULTORIA_SERVICIOS_PROFESIONALES_QUALITY_GATE_01', 'quality_gate', 'model', 'high', 'Empresa con al menos 10 profesionales en nómina o perfil documentado en LinkedIn', '{}'::jsonb, 'industry-common-rules.json', 'consultoria-servicios-profesionales.quality_gate', true, 0),
    ('388cdbf9-b822-5518-8f59-54a975e99b46', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', 'CONSULTORIA_SERVICIOS_PROFESIONALES_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene programa de desarrollo profesional para sus consultores o plan de carrera documentado', '{}'::jsonb, 'industry-common-rules.json', 'consultoria-servicios-profesionales.fit_signal', true, 0),
    ('570b95c1-20bf-5583-a5b8-eeafd2fae7b0', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', 'CONSULTORIA_SERVICIOS_PROFESIONALES_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Tiene área de reclutamiento o partnerships con universidades para trainee', '{}'::jsonb, 'industry-common-rules.json', 'consultoria-servicios-profesionales.fit_signal', true, 1),
    ('4f847c6c-c53c-5a4c-9785-d445cc2aaa14', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', 'LOGISTICA_TRANSPORTE_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa con operación física de movimiento, almacenamiento o distribución de mercancías', '{}'::jsonb, 'industry-common-rules.json', 'logistica-transporte.inclusion', true, 0),
    ('21b739c1-4932-5694-83b3-83ad7bb03f39', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', 'LOGISTICA_TRANSPORTE_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa de tecnología que provee software de gestión logística sin operar la logística', '{}'::jsonb, 'industry-common-rules.json', 'logistica-transporte.exclusion', true, 0),
    ('c12bc77a-9a2c-5d59-a100-15a90b64b154', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', 'LOGISTICA_TRANSPORTE_QUALITY_GATE_01', 'quality_gate', 'model', 'high', 'Habilitación como transportador o agente logístico por autoridad regulatoria del país', '{}'::jsonb, 'industry-common-rules.json', 'logistica-transporte.quality_gate', true, 0),
    ('abd4a5cc-2109-5539-a947-007782a62555', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', 'LOGISTICA_TRANSPORTE_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene programa de formación de conductores o capacitación en operaciones logísticas', '{}'::jsonb, 'industry-common-rules.json', 'logistica-transporte.fit_signal', true, 0),
    ('fda1a951-ee27-5e60-9cd3-9244b622a303', 'e4675daf-65a2-5e26-8640-58f1aeaee5ed', '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', 'LOGISTICA_TRANSPORTE_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Tiene certificación en gestión de cadena de suministro (APICS, CSCMP o equivalente)', '{}'::jsonb, 'industry-common-rules.json', 'logistica-transporte.fit_signal', true, 1)
;

-- ============================================================
-- INSERT: subindustry_rules (364 rows)
-- Explicit rules from rules.json + derived rules from subindustries.json
-- for subindustries without explicit rules.
-- ============================================================
INSERT INTO public.subindustry_rules (
    id, subindustry_id, rule_key, rule_type, execution_layer, priority,
    rule_text, configuration, source_document, source_section, active, sort_order
) VALUES
    ('7e069c4a-532b-528d-811b-3c58f7d75a30', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'SOFTWARE_EMPRESARIAL_INCLUSION_01', 'inclusion', 'model', 'high', 'La empresa vende software como servicio (SaaS) o licencia a otras empresas', '{}'::jsonb, 'rules.json', 'software-empresarial.inclusion', true, 0),
    ('f3ef19b9-9885-5d1d-8e73-da11bc9ad5e8', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'SOFTWARE_EMPRESARIAL_INCLUSION_02', 'inclusion', 'model', 'normal', 'Tiene producto propio (no solo servicios de desarrollo)', '{}'::jsonb, 'rules.json', 'software-empresarial.inclusion', true, 1),
    ('fa1f1a69-c7de-5b8b-923c-15669e7a3918', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'SOFTWARE_EMPRESARIAL_EXCLUSION_01', 'exclusion', 'model', 'high', 'Es una agencia de desarrollo sin producto propio', '{}'::jsonb, 'rules.json', 'software-empresarial.exclusion', true, 0),
    ('81589f64-82b7-5c6f-b508-d2d1b1a4666a', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'SOFTWARE_EMPRESARIAL_EXCLUSION_02', 'exclusion', 'model', 'normal', 'Vende exclusivamente a consumidor final B2C', '{}'::jsonb, 'rules.json', 'software-empresarial.exclusion', true, 1),
    ('0cd60ff1-f007-5813-a1dc-3069f66fb8b9', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'SOFTWARE_EMPRESARIAL_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene equipo de ventas B2B de más de 5 personas', '{}'::jsonb, 'rules.json', 'software-empresarial.fit_signal', true, 0),
    ('0ffdbaa1-e657-5547-9822-c7977d65823c', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'SOFTWARE_EMPRESARIAL_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Proceso de onboarding documentado o certificaciones de producto', '{}'::jsonb, 'rules.json', 'software-empresarial.fit_signal', true, 1),
    ('ae899757-e840-555e-82f6-c41e50120e86', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'SOFTWARE_EMPRESARIAL_EVIDENCE_REQUIREMENT_01', 'evidence_requirement', 'model', 'high', 'Página web con pricing o demo request orientado a empresas', '{}'::jsonb, 'rules.json', 'software-empresarial.evidence_requirement', true, 0),
    ('03ebb564-9e47-5185-857e-308296efef20', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'SOFTWARE_EMPRESARIAL_SEARCH_STRATEGY_01', 'search_strategy', 'model', 'high', 'Buscar en Crunchbase ''SaaS LATAM'', LinkedIn companies filtro industry=Software', '{}'::jsonb, 'rules.json', 'software-empresarial.search_strategy', true, 0),
    ('2d174971-53db-5e19-b1a7-2cf776829d9a', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'SOFTWARE_EMPRESARIAL_QUALITY_GATE_01', 'quality_gate', 'model', 'high', 'Empresa con al menos 10 empleados verificables', '{}'::jsonb, 'rules.json', 'software-empresarial.quality_gate', true, 0),
    ('656e2330-851e-5ea8-9611-67bc83990683', '3107711d-2a6c-557e-9fd2-4f49e16df9e2', 'SOFTWARE_EMPRESARIAL_EXCLUSION_03', 'exclusion', 'model', 'high', 'No clasificar en software-empresarial plataformas cuya propuesta de valor principal sea marketing automation, sales engagement, lead generation o CRM orientado predominantemente a la adquisición y gestión comercial de clientes', '{"crm_in_scope": ["CRM operacional transversal", "ERP con módulo CRM secundario", "gestión administrativa de cuentas", "soporte postventa", "workflows empresariales generales"], "crm_out_of_scope": ["marketing automation", "sales engagement", "lead generation", "revenue intelligence", "customer acquisition platforms", "CRM cuya función principal es captar o nutrir leads"], "decision_criterion": "Si el módulo CRM es accesorio a un ERP o plataforma de operaciones → software-empresarial. Si el CRM es la propuesta de valor central orientada a ventas o marketing → martech-salestech.", "examples": {"software_empresarial": ["ERP con módulo CRM para gestión de cuentas empresariales", "Plataforma de operaciones con CRM de soporte integrado"], "martech_salestech": ["Plataforma de marketing automation con CRM de ventas", "CRM enfocado en pipeline comercial y lead nurturing", "Plataforma de sales engagement con scoring de leads"]}}'::jsonb, 'rules.json', 'software-empresarial.exclusion', true, 2),
    ('942f010c-88a3-5687-a04d-f7b4d4f05912', '40a655f2-0c1a-545d-973a-fb357d6b8da9', 'CIBERSEGURIDAD_INCLUSION_01', 'inclusion', 'model', 'high', 'Ofrece productos o servicios de ciberseguridad a otras empresas', '{}'::jsonb, 'rules.json', 'ciberseguridad.inclusion', true, 0),
    ('18b1cf86-42f8-5c96-baf2-e919a4c67e07', '40a655f2-0c1a-545d-973a-fb357d6b8da9', 'CIBERSEGURIDAD_INCLUSION_02', 'inclusion', 'model', 'normal', 'Tiene al menos un producto de seguridad propio o un servicio SOC', '{}'::jsonb, 'rules.json', 'ciberseguridad.inclusion', true, 1),
    ('d1881410-3a9f-5ff8-a681-c0e6e6e92501', '40a655f2-0c1a-545d-973a-fb357d6b8da9', 'CIBERSEGURIDAD_EXCLUSION_01', 'exclusion', 'model', 'high', 'Es un departamento interno de seguridad, no una empresa independiente', '{}'::jsonb, 'rules.json', 'ciberseguridad.exclusion', true, 0),
    ('3efd77ac-ddbc-559d-a55b-ec46b232d8e9', '40a655f2-0c1a-545d-973a-fb357d6b8da9', 'CIBERSEGURIDAD_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene certificaciones ISO 27001 o SOC 2', '{}'::jsonb, 'rules.json', 'ciberseguridad.fit_signal', true, 0),
    ('021687c2-aeeb-54ed-8a68-6beea3a95925', '40a655f2-0c1a-545d-973a-fb357d6b8da9', 'CIBERSEGURIDAD_EVIDENCE_REQUIREMENT_01', 'evidence_requirement', 'model', 'high', 'Web con soluciones de seguridad documentadas y casos de uso empresariales', '{}'::jsonb, 'rules.json', 'ciberseguridad.evidence_requirement', true, 0),
    ('cd83be7b-2407-5a7d-8768-86e55d2e5b96', '40a655f2-0c1a-545d-973a-fb357d6b8da9', 'CIBERSEGURIDAD_QUALITY_GATE_01', 'quality_gate', 'model', 'high', 'Empresa con clientes corporativos identificables', '{}'::jsonb, 'rules.json', 'ciberseguridad.quality_gate', true, 0),
    ('79be9a70-7fb4-5448-8c26-0c49dabe19c8', '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'FINTECH_INFRAESTRUCTURA_PAGOS_INCLUSION_01', 'inclusion', 'model', 'high', 'Construye y vende tecnología de pagos o infraestructura financiera a terceros', '{}'::jsonb, 'rules.json', 'fintech-infraestructura-pagos.inclusion', true, 0),
    ('0c66acad-f35f-52fd-93d3-01f98c6d45fc', '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'FINTECH_INFRAESTRUCTURA_PAGOS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Opera como entidad financiera regulada por la SFC u equivalente', '{}'::jsonb, 'rules.json', 'fintech-infraestructura-pagos.exclusion', true, 0),
    ('04e7855a-78d6-52e2-bd7c-4ddce7315b58', '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'FINTECH_INFRAESTRUCTURA_PAGOS_EXCLUSION_02', 'exclusion', 'model', 'normal', 'Su producto principal es préstamos o inversiones (no infraestructura tech)', '{}'::jsonb, 'rules.json', 'fintech-infraestructura-pagos.exclusion', true, 1),
    ('6b8f8ce9-8993-5161-b3d7-003d8e66fd54', '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'FINTECH_INFRAESTRUCTURA_PAGOS_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'API de pagos documentada o integración con múltiples bancos', '{}'::jsonb, 'rules.json', 'fintech-infraestructura-pagos.fit_signal', true, 0),
    ('a25cf8f9-9c97-5f6b-be01-97c4356f3b41', '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', 'FINTECH_INFRAESTRUCTURA_PAGOS_SEARCH_STRATEGY_01', 'search_strategy', 'model', 'high', 'Buscar en Crunchbase categoría ''Payments + FinTech Infrastructure LATAM''', '{}'::jsonb, 'rules.json', 'fintech-infraestructura-pagos.search_strategy', true, 0),
    ('21033a7d-88ec-5e96-9c3e-c2dca6c6b233', '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', 'HRTECH_GESTION_TALENTO_INCLUSION_01', 'inclusion', 'model', 'high', 'Vende software de RRHH, nómina, reclutamiento o evaluación a empresas', '{}'::jsonb, 'rules.json', 'hrtech-gestion-talento.inclusion', true, 0),
    ('6493c46d-15e6-5de9-b194-178293f0d0c1', '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', 'HRTECH_GESTION_TALENTO_EXCLUSION_01', 'exclusion', 'model', 'high', 'Presta servicios de staffing o personal temporal (no tecnología)', '{}'::jsonb, 'rules.json', 'hrtech-gestion-talento.exclusion', true, 0),
    ('c4075b72-e674-5f72-ac53-eed72933a0a4', '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', 'HRTECH_GESTION_TALENTO_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Integración con sistemas ERP y módulo de reporting', '{}'::jsonb, 'rules.json', 'hrtech-gestion-talento.fit_signal', true, 0),
    ('ed735456-24b3-5dc6-b4ac-53a79179a61d', '1a00c933-fc42-5767-bc47-dd0f9be5c9fd', 'MARTECH_SALESTECH_EXCLUSION_01', 'exclusion', 'model', 'high', 'No clasificar en martech-salestech sistemas empresariales generales cuya función principal sea ERP, operación administrativa o gestión transversal de procesos, aunque incluyan un módulo CRM como funcionalidad secundaria', '{"excluded_profiles": ["ERP general con módulo CRM secundario", "software administrativo empresarial", "sistemas operacionales transversales", "plataformas de back-office con funcionalidad CRM integrada", "herramientas internas de gestión sin foco comercial"], "included_profiles": ["marketing automation como propuesta principal", "sales engagement como propuesta principal", "lead generation y nurturing", "revenue intelligence", "customer acquisition platforms"], "decision_criterion": "Si la empresa se describe principalmente como proveedor de ERP, finanzas, RRHH u operaciones con CRM como módulo → software-empresarial. Si el CRM o la automatización de ventas/marketing ES el producto principal → martech-salestech.", "examples": {"not_martech_salestech": ["Suite ERP con módulo CRM para gestión de cuentas empresariales", "Plataforma de nómina con módulo de seguimiento de ventas"], "martech_salestech": ["Plataforma de marketing automation con gestión de leads y email journeys", "CRM especializado en pipeline de ventas con scoring y forecasting"]}}'::jsonb, 'rules.json', 'martech-salestech.exclusion', true, 0),
    ('32ee1e56-bf5a-5824-bb45-2227940c657a', '81203ac3-a280-5d00-97b1-330f429c8495', 'INTELIGENCIA_ARTIFICIAL_ML_INCLUSION_01', 'inclusion', 'model', 'high', 'Desarrolla o comercializa soluciones de IA/ML como producto principal B2B', '{}'::jsonb, 'rules.json', 'inteligencia-artificial-ml.inclusion', true, 0),
    ('622872b4-66d1-5908-9b5d-8e3c9fd6a145', '81203ac3-a280-5d00-97b1-330f429c8495', 'INTELIGENCIA_ARTIFICIAL_ML_EXCLUSION_01', 'exclusion', 'model', 'high', 'Usa IA como herramienta interna sin venderla a terceros', '{}'::jsonb, 'rules.json', 'inteligencia-artificial-ml.exclusion', true, 0),
    ('7e545d74-2a9f-59b7-a485-a031d88328cc', '81203ac3-a280-5d00-97b1-330f429c8495', 'INTELIGENCIA_ARTIFICIAL_ML_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Paper técnico, API documentada o demo disponible de producto de IA', '{}'::jsonb, 'rules.json', 'inteligencia-artificial-ml.fit_signal', true, 0),
    ('3793ad36-3ccb-56a2-baf2-4f963943f94e', '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', 'HEALTHTECH_B2B_INCLUSION_01', 'inclusion', 'model', 'high', 'Construye plataformas o software para el sector salud que vende a hospitales/clínicas/EPS', '{}'::jsonb, 'rules.json', 'healthtech-b2b.inclusion', true, 0),
    ('e8822c2f-b0ef-5854-ac64-49c31cf907e7', '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', 'HEALTHTECH_B2B_EXCLUSION_01', 'exclusion', 'model', 'high', 'Presta servicios de salud directamente (hospital, clínica, EPS)', '{}'::jsonb, 'rules.json', 'healthtech-b2b.exclusion', true, 0),
    ('f2f758a8-fb4a-56aa-90c9-c1ee0294a230', '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', 'HEALTHTECH_B2B_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Integración con HIS (Hospital Information System) o e-prescripción', '{}'::jsonb, 'rules.json', 'healthtech-b2b.fit_signal', true, 0),
    ('5fef2be7-37a1-5838-9081-564fd6d5f1a3', '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', 'EDTECH_PLATAFORMAS_INCLUSION_01', 'inclusion', 'model', 'high', 'Desarrolla plataformas LMS, herramientas de e-learning o simuladores que vende a otras organizaciones', '{}'::jsonb, 'rules.json', 'edtech-plataformas.inclusion', true, 0),
    ('fc5461f5-55f2-520d-adda-a049e7d0db50', '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', 'EDTECH_PLATAFORMAS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Es una institución educativa que consume plataformas, no las desarrolla', '{}'::jsonb, 'rules.json', 'edtech-plataformas.exclusion', true, 0),
    ('0c42924e-2159-59df-8fd1-8a8c52fc247c', '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', 'EDTECH_PLATAFORMAS_EXCLUSION_02', 'exclusion', 'model', 'normal', 'Presta formación corporativa como servicio sin plataforma propia', '{}'::jsonb, 'rules.json', 'edtech-plataformas.exclusion', true, 1),
    ('fac74170-2c38-5d43-9091-07bddc014d69', '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', 'EDTECH_PLATAFORMAS_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene plataforma propia con white-label o API de integración', '{}'::jsonb, 'rules.json', 'edtech-plataformas.fit_signal', true, 0),
    ('efb8af5f-da07-5e5e-a7de-2d4757232b1b', '4d764405-cdb7-526e-9468-73fa008bbdc6', 'BANCA_TRADICIONAL_INCLUSION_01', 'inclusion', 'model', 'high', 'Entidad bancaria regulada con operación en LATAM y mercado corporativo', '{}'::jsonb, 'rules.json', 'banca-tradicional.inclusion', true, 0),
    ('a3484a3b-100a-50fc-82ad-b666fe95285f', '4d764405-cdb7-526e-9468-73fa008bbdc6', 'BANCA_TRADICIONAL_INCLUSION_02', 'inclusion', 'model', 'normal', 'Tiene área de banca corporativa o empresas con más de 500 empleados', '{}'::jsonb, 'rules.json', 'banca-tradicional.inclusion', true, 1),
    ('31967de1-3ce7-592e-b204-9cd3f7ac2c46', '4d764405-cdb7-526e-9468-73fa008bbdc6', 'BANCA_TRADICIONAL_EXCLUSION_01', 'exclusion', 'model', 'high', 'Banco del estado sin autonomía comercial', '{}'::jsonb, 'rules.json', 'banca-tradicional.exclusion', true, 0),
    ('4cd760b4-57d7-5618-bfb3-320a45a7c162', '4d764405-cdb7-526e-9468-73fa008bbdc6', 'BANCA_TRADICIONAL_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Prioridad alta en bancos con segmento PYMES o corporativo activo', '{}'::jsonb, 'rules.json', 'banca-tradicional.fit_signal', true, 0),
    ('b81c584f-a560-5dcd-9e38-b5ccd0010a3c', '4d764405-cdb7-526e-9468-73fa008bbdc6', 'BANCA_TRADICIONAL_SEARCH_STRATEGY_01', 'search_strategy', 'model', 'high', 'Consultar listados regulatorios de la Superintendencia Financiera o equivalente', '{}'::jsonb, 'rules.json', 'banca-tradicional.search_strategy', true, 0),
    ('a4e43f8c-dee5-530d-939e-0722fc8948fd', '968f71cb-1483-538b-83e2-6eaaf6467dcf', 'SEGUROS_GENERALES_INCLUSION_01', 'inclusion', 'model', 'high', 'Aseguradora regulada que opera seguros de propiedad, daños o responsabilidad civil', '{}'::jsonb, 'rules.json', 'seguros-generales.inclusion', true, 0),
    ('2f52882d-8ebf-539f-b9eb-c9c14aa8b905', '968f71cb-1483-538b-83e2-6eaaf6467dcf', 'SEGUROS_GENERALES_EXCLUSION_01', 'exclusion', 'model', 'high', 'Broker o intermediario sin cartera propia', '{}'::jsonb, 'rules.json', 'seguros-generales.exclusion', true, 0),
    ('ae09ab76-58ba-52e4-b118-ac658ad56e0e', '968f71cb-1483-538b-83e2-6eaaf6467dcf', 'SEGUROS_GENERALES_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene productos de seguro corporativo o de flota vehicular', '{}'::jsonb, 'rules.json', 'seguros-generales.fit_signal', true, 0),
    ('84e28475-b407-5dab-b3c0-f4ae69aab345', 'c81af5fd-147f-5525-b9e5-906230842846', 'FINTECH_B2B_SERVICIOS_INCLUSION_01', 'inclusion', 'model', 'high', 'Opera servicios financieros digitales (pagos, crédito, cuenta) como producto principal a empresas o personas', '{}'::jsonb, 'rules.json', 'fintech-b2b-servicios.inclusion', true, 0),
    ('35dd970e-131e-5cb3-bfe1-922a5bbb0d59', 'c81af5fd-147f-5525-b9e5-906230842846', 'FINTECH_B2B_SERVICIOS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Construye la tecnología de pagos como producto pero no la opera como servicio', '{}'::jsonb, 'rules.json', 'fintech-b2b-servicios.exclusion', true, 0),
    ('b32b34f6-9053-59c5-9442-abb954e6d1ef', 'c81af5fd-147f-5525-b9e5-906230842846', 'FINTECH_B2B_SERVICIOS_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Regulada o en proceso de regulación por entidad financiera local', '{}'::jsonb, 'rules.json', 'fintech-b2b-servicios.fit_signal', true, 0),
    ('2375933d-22e2-5c02-8641-c672b3b82476', '041e7562-9bac-596f-a8a2-346f390c0fe8', 'REDES_HOSPITALARIAS_CLINICAS_INCLUSION_01', 'inclusion', 'model', 'high', 'Red de 3 o más establecimientos de atención en salud de nivel 3 o 4', '{}'::jsonb, 'rules.json', 'redes-hospitalarias-clinicas.inclusion', true, 0),
    ('2a80268b-d04c-524f-a6ca-fdedd814b523', '041e7562-9bac-596f-a8a2-346f390c0fe8', 'REDES_HOSPITALARIAS_CLINICAS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Clínica o consultorio independiente sin red', '{}'::jsonb, 'rules.json', 'redes-hospitalarias-clinicas.exclusion', true, 0),
    ('ced5ef44-dab4-5a06-8389-38bd43883e4a', '041e7562-9bac-596f-a8a2-346f390c0fe8', 'REDES_HOSPITALARIAS_CLINICAS_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Área de formación clínica o convenios con universidades médicas', '{}'::jsonb, 'rules.json', 'redes-hospitalarias-clinicas.fit_signal', true, 0),
    ('352bb077-9b8e-5ff1-a043-c9ab5dbdf3bb', '8515cd86-1a51-577b-b71c-b4907d56ce1f', 'LABORATORIOS_FARMACEUTICOS_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa con planta de producción farmacéutica propia o maquila certificada', '{}'::jsonb, 'rules.json', 'laboratorios-farmaceuticos.inclusion', true, 0)
;

INSERT INTO public.subindustry_rules (
    id, subindustry_id, rule_key, rule_type, execution_layer, priority,
    rule_text, configuration, source_document, source_section, active, sort_order
) VALUES
    ('08120bcb-2057-56a7-b9e3-dc9bdc958631', '8515cd86-1a51-577b-b71c-b4907d56ce1f', 'LABORATORIOS_FARMACEUTICOS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Solo distribuye medicamentos sin producción propia', '{}'::jsonb, 'rules.json', 'laboratorios-farmaceuticos.exclusion', true, 0),
    ('7533b296-6c69-5964-b172-f65c0f42a30f', '8515cd86-1a51-577b-b71c-b4907d56ce1f', 'LABORATORIOS_FARMACEUTICOS_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Registros sanitarios propios en más de 2 países', '{}'::jsonb, 'rules.json', 'laboratorios-farmaceuticos.fit_signal', true, 0),
    ('8b4abb53-b164-5d60-9d7e-8cdab436fdbd', 'df0765ed-3842-5b2e-a320-b0cee73b11d4', 'SALUD_OCUPACIONAL_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa especializada en SST, medicina laboral o salud ocupacional para otras organizaciones', '{}'::jsonb, 'rules.json', 'salud-ocupacional.inclusion', true, 0),
    ('d507d941-a271-56fd-a385-e140c87a89b3', 'df0765ed-3842-5b2e-a320-b0cee73b11d4', 'SALUD_OCUPACIONAL_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Certificación como prestador de SST ante ministerio de trabajo', '{}'::jsonb, 'rules.json', 'salud-ocupacional.fit_signal', true, 0),
    ('4a675197-eff4-5a9d-86f5-edeca4dfb0a7', '2b631bf6-425d-53ce-8f9d-d156713df570', 'FORMACION_CORPORATIVA_B2B_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa que diseña y entrega programas de formación a organizaciones empresariales', '{}'::jsonb, 'rules.json', 'formacion-corporativa-b2b.inclusion', true, 0),
    ('3d346591-1a20-5edd-82ea-45bd4a1efe25', '2b631bf6-425d-53ce-8f9d-d156713df570', 'FORMACION_CORPORATIVA_B2B_EXCLUSION_01', 'exclusion', 'model', 'high', 'Desarrolla plataformas tecnológicas para formación (→ edtech-plataformas)', '{}'::jsonb, 'rules.json', 'formacion-corporativa-b2b.exclusion', true, 0),
    ('23a9b875-8d4c-579f-bef2-ae8b1b3b2fe2', '2b631bf6-425d-53ce-8f9d-d156713df570', 'FORMACION_CORPORATIVA_B2B_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene catálogo de cursos de liderazgo, compliance o habilidades empresariales', '{}'::jsonb, 'rules.json', 'formacion-corporativa-b2b.fit_signal', true, 0),
    ('4f7f40c8-409b-597d-9327-3235d1e45732', '2b631bf6-425d-53ce-8f9d-d156713df570', 'FORMACION_CORPORATIVA_B2B_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Directa competencia o referente de UBITS', '{}'::jsonb, 'rules.json', 'formacion-corporativa-b2b.fit_signal', true, 1),
    ('7e5c9abb-3513-55f0-88af-87e2f9ec9381', '2b631bf6-425d-53ce-8f9d-d156713df570', 'FORMACION_CORPORATIVA_B2B_SEARCH_STRATEGY_01', 'search_strategy', 'model', 'high', 'Buscar en LinkedIn Companies ''corporate training LATAM'', Cámara de Comercio categoría formación', '{}'::jsonb, 'rules.json', 'formacion-corporativa-b2b.search_strategy', true, 0),
    ('b42f0e20-392a-5d1f-9b3c-d5a2ceb40e97', 'c7cd8535-8714-58ba-ad16-2d157102cb48', 'INSTITUTOS_TECNICOS_VOCACIONALES_INCLUSION_01', 'inclusion', 'model', 'high', 'Instituto técnico o vocacional con matrícula corporativa B2B o convenios empresa-escuela', '{}'::jsonb, 'rules.json', 'institutos-tecnicos-vocacionales.inclusion', true, 0),
    ('0252188a-493d-56b4-84a9-f93e497890e6', 'c7cd8535-8714-58ba-ad16-2d157102cb48', 'INSTITUTOS_TECNICOS_VOCACIONALES_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene área de capacitación empresarial o formación continua', '{}'::jsonb, 'rules.json', 'institutos-tecnicos-vocacionales.fit_signal', true, 0),
    ('5bdee449-8626-5ef1-b787-a4430d7b5a42', 'c7cd8535-8714-58ba-ad16-2d157102cb48', 'INSTITUTOS_TECNICOS_VOCACIONALES_SEARCH_STRATEGY_01', 'search_strategy', 'model', 'high', 'Buscar en Ministerios de Educación LATAM listados OTEC/SENATI/CONALEP/SENA', '{}'::jsonb, 'rules.json', 'institutos-tecnicos-vocacionales.search_strategy', true, 0),
    ('549a1110-ea19-5d2e-875d-90f730209e34', 'b43b5ddd-5c4e-5c09-a693-d9b2e3c32ce6', 'CONSTRUCCION_OBRA_CIVIL_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa constructora con proyectos activos de infraestructura o edificaciones', '{}'::jsonb, 'rules.json', 'construccion-obra-civil.inclusion', true, 0),
    ('e60307d3-0f47-5a02-8af0-65f7751f8c49', 'b43b5ddd-5c4e-5c09-a693-d9b2e3c32ce6', 'CONSTRUCCION_OBRA_CIVIL_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Afiliada a gremio constructor (CAMACOL, CMIC, etc.)', '{}'::jsonb, 'rules.json', 'construccion-obra-civil.fit_signal', true, 0),
    ('c29a7251-f9cb-5cd0-be95-28f34d28d82d', '87b9e0c7-0d17-5400-93e8-b62906fedf6a', 'ENERGIA_MINERIA_SERVICIOS_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa operadora de energía, gas, petróleo o minería con presencia en LATAM', '{}'::jsonb, 'rules.json', 'energia-mineria-servicios.inclusion', true, 0),
    ('7ef39d44-23aa-5c09-a40b-add8958d816a', '87b9e0c7-0d17-5400-93e8-b62906fedf6a', 'ENERGIA_MINERIA_SERVICIOS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Startup tech que provee software para el sector energético (→ Tecnología)', '{}'::jsonb, 'rules.json', 'energia-mineria-servicios.exclusion', true, 0),
    ('f6a30639-72cb-5085-af5b-d9bd4c1cebee', '87b9e0c7-0d17-5400-93e8-b62906fedf6a', 'ENERGIA_MINERIA_SERVICIOS_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene programas de certificación técnica o convenios con institutos técnicos', '{}'::jsonb, 'rules.json', 'energia-mineria-servicios.fit_signal', true, 0),
    ('0a65fe5e-1142-5cd9-a8e2-5de8ea3ea32f', 'eaefd820-c413-571b-b9ba-2100eed3e49f', 'AGROINDUSTRIA_PROCESADORA_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa con operación industrial de procesamiento de productos agropecuarios', '{}'::jsonb, 'rules.json', 'agroindustria-procesadora.inclusion', true, 0),
    ('92fff7c9-6368-556e-a5e5-43dc13df2f41', 'eaefd820-c413-571b-b9ba-2100eed3e49f', 'AGROINDUSTRIA_PROCESADORA_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa de tecnología agrícola que vende software o hardware al agro (→ agritech)', '{}'::jsonb, 'rules.json', 'agroindustria-procesadora.exclusion', true, 0),
    ('dabc71bf-dd18-5422-b51a-7f818848d042', 'eaefd820-c413-571b-b9ba-2100eed3e49f', 'AGROINDUSTRIA_PROCESADORA_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene área de formación técnica para operarios o técnicos de campo', '{}'::jsonb, 'rules.json', 'agroindustria-procesadora.fit_signal', true, 0),
    ('86de39b7-d411-5fb8-ac2a-a40494bf1fd3', 'c2ad5ec0-571a-520e-a026-53a0dc75e260', 'BPO_CONTACT_CENTER_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa que opera procesos de negocio o contact center para otras organizaciones', '{}'::jsonb, 'rules.json', 'bpo-contact-center.inclusion', true, 0),
    ('7fa97355-d8ed-5942-9705-73b7ecfe0ff7', 'c2ad5ec0-571a-520e-a026-53a0dc75e260', 'BPO_CONTACT_CENTER_EXCLUSION_01', 'exclusion', 'model', 'high', 'Desarrolla software de contact center sin operar los procesos', '{}'::jsonb, 'rules.json', 'bpo-contact-center.exclusion', true, 0),
    ('da428fd2-1eed-5383-b4da-077a8aae1b31', 'c2ad5ec0-571a-520e-a026-53a0dc75e260', 'BPO_CONTACT_CENTER_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene área de capacitación de agentes o programas de certificación interna', '{}'::jsonb, 'rules.json', 'bpo-contact-center.fit_signal', true, 0),
    ('82747c9b-0608-5160-add1-3c811889ec78', '0e890f25-655c-5061-b354-f86c3ab29062', 'STAFFING_SERVICIOS_TEMPORALES_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa autorizada para contratar y suministrar personal temporal', '{}'::jsonb, 'rules.json', 'staffing-servicios-temporales.inclusion', true, 0),
    ('1c755770-df8f-5294-b2d6-ffd1961b05b9', '0e890f25-655c-5061-b354-f86c3ab29062', 'STAFFING_SERVICIOS_TEMPORALES_EXCLUSION_01', 'exclusion', 'model', 'high', 'Plataforma tecnológica de RRHH sin operación de personal', '{}'::jsonb, 'rules.json', 'staffing-servicios-temporales.exclusion', true, 0),
    ('9b8c7e85-5baf-5354-b068-6347cfd0ba7f', '0e890f25-655c-5061-b354-f86c3ab29062', 'STAFFING_SERVICIOS_TEMPORALES_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene certificación ante Ministerio de Trabajo para prestación de servicios temporales', '{}'::jsonb, 'rules.json', 'staffing-servicios-temporales.fit_signal', true, 0),
    ('fee2b8b3-d03c-5da0-9c08-75c4c059716a', '5a217eb2-0a0e-5a74-b131-e7a34ebe3cb5', 'OPERADORES_LOGISTICOS_3PL_4PL_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa que provee servicios logísticos integrales a terceros (almacén, transporte, distribución)', '{}'::jsonb, 'rules.json', 'operadores-logisticos-3pl-4pl.inclusion', true, 0),
    ('8d6316b6-9a95-5344-8eba-b489ad9fdf7c', '5a217eb2-0a0e-5a74-b131-e7a34ebe3cb5', 'OPERADORES_LOGISTICOS_3PL_4PL_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene flota propia y plataforma de visibilidad logística', '{}'::jsonb, 'rules.json', 'operadores-logisticos-3pl-4pl.fit_signal', true, 0),
    ('7c59f4e5-db75-5cf7-937a-f1d494b68d70', '695bf6e7-c121-5bc5-940a-5def8d79f523', 'TRANSPORTE_CARGA_TERRESTRE_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa transportista con flota de carga terrestre mayor a 10 vehículos', '{}'::jsonb, 'rules.json', 'transporte-carga-terrestre.inclusion', true, 0),
    ('e9e9aee3-97f8-5da9-86d9-5d0a7f5e8d66', '695bf6e7-c121-5bc5-940a-5def8d79f523', 'TRANSPORTE_CARGA_TERRESTRE_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene rutas regulares B2B documentadas y seguro de carga', '{}'::jsonb, 'rules.json', 'transporte-carga-terrestre.fit_signal', true, 0),
    ('c773e2fe-50b2-5aab-aee8-5ebd18cf3523', 'adcfeed3-fc65-5c45-bf66-7910446075ca', 'FREIGHT_FORWARDERS_ADUANA_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa con autorización como agente de carga y/o agente aduanero', '{}'::jsonb, 'rules.json', 'freight-forwarders-aduana.inclusion', true, 0),
    ('2dcf025f-50f0-5946-b1e9-aa109381819a', 'adcfeed3-fc65-5c45-bf66-7910446075ca', 'FREIGHT_FORWARDERS_ADUANA_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Tiene representaciones de líneas marítimas o aéreas internacionales', '{}'::jsonb, 'rules.json', 'freight-forwarders-aduana.fit_signal', true, 0),
    ('86fcca0e-ec4d-5e6d-a0cb-87646610520a', '2effb010-8309-5e97-92dd-3b50a5400de6', 'WAREHOUSING_FULFILLMENT_INCLUSION_01', 'inclusion', 'model', 'high', 'Empresa con instalaciones de almacenamiento y/o fulfillment para terceros', '{}'::jsonb, 'rules.json', 'warehousing-fulfillment.inclusion', true, 0),
    ('af4aed4c-958c-5637-8410-ada6395dbf1d', '2effb010-8309-5e97-92dd-3b50a5400de6', 'WAREHOUSING_FULFILLMENT_FIT_SIGNAL_01', 'fit_signal', 'model', 'high', 'Integración con plataformas e-commerce o ERP de clientes', '{}'::jsonb, 'rules.json', 'warehousing-fulfillment.fit_signal', true, 0),
    ('f28c9988-7d64-5c8f-bd2f-afe6be871200', 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'INFRAESTRUCTURA_CLOUD_DEVOPS_INCLUSION_01', 'inclusion', 'model', 'high', 'Provee infraestructura tecnológica como servicio', '{}'::jsonb, 'subindustries.json', 'infraestructura-cloud-devops.inclusion_criteria', true, 0),
    ('81298bff-acfa-5dd2-acd9-3d3da30523b6', 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'INFRAESTRUCTURA_CLOUD_DEVOPS_INCLUSION_02', 'inclusion', 'model', 'high', 'Sus clientes son equipos de tecnología de otras empresas', '{}'::jsonb, 'subindustries.json', 'infraestructura-cloud-devops.inclusion_criteria', true, 1),
    ('b47d89b9-6485-52af-82f7-1b9d62cc2616', 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'INFRAESTRUCTURA_CLOUD_DEVOPS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Data center físico sin componente cloud o software', '{}'::jsonb, 'subindustries.json', 'infraestructura-cloud-devops.exclusion_criteria', true, 0),
    ('5f44fadb-aa91-57f3-b772-e23b02b205ac', 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'INFRAESTRUCTURA_CLOUD_DEVOPS_EXCLUSION_02', 'exclusion', 'model', 'high', 'Telco que provee conectividad pero no plataforma cloud', '{}'::jsonb, 'subindustries.json', 'infraestructura-cloud-devops.exclusion_criteria', true, 1),
    ('235e66a8-1b24-5e1d-936e-3fb716aeb859', 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'INFRAESTRUCTURA_CLOUD_DEVOPS_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos de ingeniería en crecimiento', '{}'::jsonb, 'subindustries.json', 'infraestructura-cloud-devops.ubits_fit_signals', true, 0),
    ('5b12a9e7-5978-572e-8213-0647f9670c71', 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'INFRAESTRUCTURA_CLOUD_DEVOPS_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Adopción de nuevas tecnologías cloud que demanda capacitación', '{}'::jsonb, 'subindustries.json', 'infraestructura-cloud-devops.ubits_fit_signals', true, 1),
    ('7e3ebc9c-bc06-521a-8f63-34ae9f4ad06b', 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', 'INFRAESTRUCTURA_CLOUD_DEVOPS_FIT_SIGNAL_03', 'fit_signal', 'model', 'normal', 'Certificaciones cloud (AWS, Azure, GCP)', '{}'::jsonb, 'subindustries.json', 'infraestructura-cloud-devops.ubits_fit_signals', true, 2),
    ('6f43e162-05cd-592f-b9e6-df16d59149cd', '87a07024-5d94-55fe-b122-7137ad3c9a12', 'ECOMMERCE_ENABLEMENT_INCLUSION_01', 'inclusion', 'model', 'high', 'El producto principal facilita o infraestructura transacciones comerciales online de terceros', '{}'::jsonb, 'subindustries.json', 'ecommerce-enablement.inclusion_criteria', true, 0),
    ('ce471ba4-f180-58c4-9587-583a580c4559', '87a07024-5d94-55fe-b122-7137ad3c9a12', 'ECOMMERCE_ENABLEMENT_INCLUSION_02', 'inclusion', 'model', 'high', 'Sus clientes son empresas que quieren vender online, no consumidores finales', '{}'::jsonb, 'subindustries.json', 'ecommerce-enablement.inclusion_criteria', true, 1),
    ('05389dc1-5a87-550d-8581-ff7a1c7488d5', '87a07024-5d94-55fe-b122-7137ad3c9a12', 'ECOMMERCE_ENABLEMENT_EXCLUSION_01', 'exclusion', 'model', 'high', 'Tienda online de un retailer (ej: Falabella.com) — ese es retail, no ecommerce-tech', '{}'::jsonb, 'subindustries.json', 'ecommerce-enablement.exclusion_criteria', true, 0),
    ('8acd8710-d58b-5dac-b25c-0ec5caf69b98', '87a07024-5d94-55fe-b122-7137ad3c9a12', 'ECOMMERCE_ENABLEMENT_EXCLUSION_02', 'exclusion', 'model', 'high', 'App de delivery de comida sin plataforma de comercio propia', '{}'::jsonb, 'subindustries.json', 'ecommerce-enablement.exclusion_criteria', true, 1),
    ('70d8df04-3314-5d89-b48a-e3615bf73f84', '87a07024-5d94-55fe-b122-7137ad3c9a12', 'ECOMMERCE_ENABLEMENT_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos de operaciones y customer success en crecimiento', '{}'::jsonb, 'subindustries.json', 'ecommerce-enablement.ubits_fit_signals', true, 0),
    ('d6f13502-2403-5e59-b494-66c41955da55', 'bdce83c0-9d1f-58a8-82de-7289c676ab0a', 'PROPTECH_INCLUSION_01', 'inclusion', 'model', 'high', 'La tecnología digital diferencia el servicio en el sector inmobiliario', '{}'::jsonb, 'subindustries.json', 'proptech.inclusion_criteria', true, 0),
    ('79c8cf70-bb22-5db2-966a-51b825ac64bf', 'bdce83c0-9d1f-58a8-82de-7289c676ab0a', 'PROPTECH_INCLUSION_02', 'inclusion', 'model', 'high', 'Opera en compra, venta, alquiler o gestión de propiedades con plataforma propia', '{}'::jsonb, 'subindustries.json', 'proptech.inclusion_criteria', true, 1),
    ('ca5a18a2-c6e7-5a37-9043-b8adc33319d7', 'bdce83c0-9d1f-58a8-82de-7289c676ab0a', 'PROPTECH_EXCLUSION_01', 'exclusion', 'model', 'high', 'Inmobiliaria tradicional sin plataforma tecnológica diferenciada', '{}'::jsonb, 'subindustries.json', 'proptech.exclusion_criteria', true, 0),
    ('514e4664-874f-53e7-9d77-6c33ac766d9a', 'bdce83c0-9d1f-58a8-82de-7289c676ab0a', 'PROPTECH_EXCLUSION_02', 'exclusion', 'model', 'high', 'Constructora sin componente digital de gestión o ventas', '{}'::jsonb, 'subindustries.json', 'proptech.exclusion_criteria', true, 1)
;

INSERT INTO public.subindustry_rules (
    id, subindustry_id, rule_key, rule_type, execution_layer, priority,
    rule_text, configuration, source_document, source_section, active, sort_order
) VALUES
    ('1c48ebc5-6028-5506-a8a5-cbae1fdd6ace', 'bdce83c0-9d1f-58a8-82de-7289c676ab0a', 'PROPTECH_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos comerciales de venta de propiedades que necesitan capacitación', '{}'::jsonb, 'subindustries.json', 'proptech.ubits_fit_signals', true, 0),
    ('702eb0c4-bc66-5834-a6fb-3eb7257420f7', '014296cc-98e4-5433-bc2f-bbcbcadbf252', 'LEGALTECH_INCLUSION_01', 'inclusion', 'model', 'high', 'La tecnología automatiza o mejora procesos legales', '{}'::jsonb, 'subindustries.json', 'legaltech.inclusion_criteria', true, 0),
    ('84485348-bb6a-5d4d-bfaf-25a04ce29aa4', '014296cc-98e4-5433-bc2f-bbcbcadbf252', 'LEGALTECH_INCLUSION_02', 'inclusion', 'model', 'high', 'Vende plataforma o software a empresas u organizaciones con necesidades jurídicas', '{}'::jsonb, 'subindustries.json', 'legaltech.inclusion_criteria', true, 1),
    ('0bb622e4-50fe-582f-8061-4a7c45c240b2', '014296cc-98e4-5433-bc2f-bbcbcadbf252', 'LEGALTECH_EXCLUSION_01', 'exclusion', 'model', 'high', 'Firma de abogados que usa software pero no lo desarrolla (→ Consultoría > servicios-legales)', '{}'::jsonb, 'subindustries.json', 'legaltech.exclusion_criteria', true, 0),
    ('dd86b7d4-17f2-55fc-8cdc-342e7e80a717', '014296cc-98e4-5433-bc2f-bbcbcadbf252', 'LEGALTECH_EXCLUSION_02', 'exclusion', 'model', 'high', 'Servicios notariales tradicionales', '{}'::jsonb, 'subindustries.json', 'legaltech.exclusion_criteria', true, 1),
    ('46cd0eea-31f6-54cb-bdc6-c10cff717230', '014296cc-98e4-5433-bc2f-bbcbcadbf252', 'LEGALTECH_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos legales y de compliance que necesitan formación continua', '{}'::jsonb, 'subindustries.json', 'legaltech.ubits_fit_signals', true, 0),
    ('2d55b1b0-b6ca-572d-a091-8dfc22f9e9ff', 'f286731d-fa78-507c-932c-b028ff6f00d7', 'INSURTECH_INCLUSION_01', 'inclusion', 'model', 'high', 'La tecnología digital es el diferenciador en la propuesta de seguros', '{}'::jsonb, 'subindustries.json', 'insurtech.inclusion_criteria', true, 0),
    ('2a94902d-9dc7-50dd-a4b1-aec304b5f19c', 'f286731d-fa78-507c-932c-b028ff6f00d7', 'INSURTECH_INCLUSION_02', 'inclusion', 'model', 'high', 'Vende plataforma o infraestructura a aseguradoras u otras empresas', '{}'::jsonb, 'subindustries.json', 'insurtech.inclusion_criteria', true, 1),
    ('7f6696ea-036c-5309-bb86-274656cb1f14', 'f286731d-fa78-507c-932c-b028ff6f00d7', 'INSURTECH_EXCLUSION_01', 'exclusion', 'model', 'high', 'Aseguradora tradicional sin propuesta tecnológica diferenciada (→ Servicios Financieros > seguros)', '{}'::jsonb, 'subindustries.json', 'insurtech.exclusion_criteria', true, 0),
    ('7c1967ec-4174-58b6-8fa3-56b6b9e217f7', 'f286731d-fa78-507c-932c-b028ff6f00d7', 'INSURTECH_EXCLUSION_02', 'exclusion', 'model', 'high', 'Corredor de seguros sin plataforma propia (→ Servicios Financieros > brokers)', '{}'::jsonb, 'subindustries.json', 'insurtech.exclusion_criteria', true, 1),
    ('d2f98dce-1c54-5c3b-ab08-4388c190ffc2', 'f286731d-fa78-507c-932c-b028ff6f00d7', 'INSURTECH_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos de producto y ventas que necesitan formación en seguros y tecnología', '{}'::jsonb, 'subindustries.json', 'insurtech.ubits_fit_signals', true, 0),
    ('fb667c27-66ff-5360-8fec-e69e3675bd55', '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', 'GOVTECH_INCLUSION_01', 'inclusion', 'model', 'high', 'Sus clientes principales son entidades gubernamentales o públicas', '{}'::jsonb, 'subindustries.json', 'govtech.inclusion_criteria', true, 0),
    ('516511cd-ff6a-5e93-a128-363ee81b2126', '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', 'GOVTECH_INCLUSION_02', 'inclusion', 'model', 'high', 'La tecnología mejora servicios públicos o la gestión gubernamental', '{}'::jsonb, 'subindustries.json', 'govtech.inclusion_criteria', true, 1),
    ('94b259fc-d1ec-5cfd-a6be-3adae5c954a8', '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', 'GOVTECH_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa de consultoría gubernamental sin plataforma tecnológica', '{}'::jsonb, 'subindustries.json', 'govtech.exclusion_criteria', true, 0),
    ('2d5aee9a-c624-52ef-961b-c0d64be03d41', '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', 'GOVTECH_EXCLUSION_02', 'exclusion', 'model', 'high', 'Constructora de infraestructura física para ciudades', '{}'::jsonb, 'subindustries.json', 'govtech.exclusion_criteria', true, 1),
    ('6d059bf0-b3da-5fd3-8117-d3de2b1bae9b', '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', 'GOVTECH_EXCLUSION_03', 'exclusion', 'model', 'high', 'Entidad gubernamental, ministerio, alcaldía, organismo público o empresa estatal que adquiere o utiliza tecnología pero no la desarrolla ni comercializa como producto propio', '{}'::jsonb, 'subindustries.json', 'govtech.exclusion_criteria', true, 2),
    ('1b028b22-7202-5663-ba21-f662dda98cc9', '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', 'GOVTECH_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos de implementación y capacitación en gobierno digital', '{}'::jsonb, 'subindustries.json', 'govtech.ubits_fit_signals', true, 0),
    ('4b62f522-a244-59f2-a934-4738b233bf1f', '52787e3c-6e77-5fb2-b62b-dd999c4df07e', 'AGRITECH_INCLUSION_01', 'inclusion', 'model', 'high', 'La tecnología mejora procesos agropecuarios como propuesta de valor central', '{}'::jsonb, 'subindustries.json', 'agritech.inclusion_criteria', true, 0),
    ('91e9059e-60b5-53b4-88bf-498b61e21c34', '52787e3c-6e77-5fb2-b62b-dd999c4df07e', 'AGRITECH_INCLUSION_02', 'inclusion', 'model', 'high', 'Vende plataforma o hardware a productores o empresas agroindustriales', '{}'::jsonb, 'subindustries.json', 'agritech.inclusion_criteria', true, 1),
    ('2f24eee9-5310-5619-ba00-8b244f58b8f9', '52787e3c-6e77-5fb2-b62b-dd999c4df07e', 'AGRITECH_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa agroindustrial sin propuesta tecnológica diferenciada (→ Manufactura > agroindustria)', '{}'::jsonb, 'subindustries.json', 'agritech.exclusion_criteria', true, 0),
    ('3805e17e-46a6-5f4e-b2ae-98ad8f6151d4', '52787e3c-6e77-5fb2-b62b-dd999c4df07e', 'AGRITECH_EXCLUSION_02', 'exclusion', 'model', 'high', 'Proveedor de insumos agrícolas sin componente digital', '{}'::jsonb, 'subindustries.json', 'agritech.exclusion_criteria', true, 1),
    ('c2a9e289-debb-58b9-9ae7-01dea4510bd0', '52787e3c-6e77-5fb2-b62b-dd999c4df07e', 'AGRITECH_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos de campo y gestión que necesitan formación en tecnologías digitales aplicadas', '{}'::jsonb, 'subindustries.json', 'agritech.ubits_fit_signals', true, 0),
    ('ba5c0ef8-b09c-588f-a38f-486b4531839d', 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', 'DATA_ANALYTICS_BI_INCLUSION_01', 'inclusion', 'model', 'high', 'El producto principal permite analizar, visualizar o gestionar datos empresariales', '{}'::jsonb, 'subindustries.json', 'data-analytics-bi.inclusion_criteria', true, 0),
    ('00e20b68-084c-53a4-a14d-a5626a035ab3', 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', 'DATA_ANALYTICS_BI_INCLUSION_02', 'inclusion', 'model', 'high', 'Vende plataforma de datos a otras empresas (B2B)', '{}'::jsonb, 'subindustries.json', 'data-analytics-bi.inclusion_criteria', true, 1),
    ('7214383a-3c58-527b-94ff-70611f4ef48b', 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', 'DATA_ANALYTICS_BI_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa que usa BI internamente pero no lo vende como producto', '{}'::jsonb, 'subindustries.json', 'data-analytics-bi.exclusion_criteria', true, 0),
    ('21e232b9-3018-5cde-abf8-e5b1c69015c9', 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', 'DATA_ANALYTICS_BI_EXCLUSION_02', 'exclusion', 'model', 'high', 'Consultora de datos sin plataforma propia (→ Consultoría)', '{}'::jsonb, 'subindustries.json', 'data-analytics-bi.exclusion_criteria', true, 1),
    ('5cb1464b-5448-5f9e-8f03-7e893935051e', 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', 'DATA_ANALYTICS_BI_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos de datos y analistas que necesitan formación en herramientas y metodologías', '{}'::jsonb, 'subindustries.json', 'data-analytics-bi.ubits_fit_signals', true, 0),
    ('9c993b49-e045-5bc1-8dfd-030cbd1bf365', '1b885eed-5d52-5c0b-be1f-a79797d1e7a9', 'IOT_HARDWARE_CONECTADO_INCLUSION_01', 'inclusion', 'model', 'high', 'Desarrolla o vende dispositivos conectados o plataformas IoT', '{}'::jsonb, 'subindustries.json', 'iot-hardware-conectado.inclusion_criteria', true, 0),
    ('b76850a9-eb58-5f61-a76f-77101702706c', '1b885eed-5d52-5c0b-be1f-a79797d1e7a9', 'IOT_HARDWARE_CONECTADO_INCLUSION_02', 'inclusion', 'model', 'high', 'La conectividad y los datos del hardware son centrales en la propuesta de valor', '{}'::jsonb, 'subindustries.json', 'iot-hardware-conectado.inclusion_criteria', true, 1),
    ('b94024cc-9c92-5052-8084-9fa054e052bb', '1b885eed-5d52-5c0b-be1f-a79797d1e7a9', 'IOT_HARDWARE_CONECTADO_EXCLUSION_01', 'exclusion', 'model', 'high', 'Fabricante de electrónica de consumo sin foco en conectividad de datos', '{}'::jsonb, 'subindustries.json', 'iot-hardware-conectado.exclusion_criteria', true, 0),
    ('cfc13edc-8e77-5a50-9282-7bce29509573', '1b885eed-5d52-5c0b-be1f-a79797d1e7a9', 'IOT_HARDWARE_CONECTADO_EXCLUSION_02', 'exclusion', 'model', 'high', 'Empresa de hardware industrial sin componente digital conectado', '{}'::jsonb, 'subindustries.json', 'iot-hardware-conectado.exclusion_criteria', true, 1),
    ('6ba49d5d-acf8-574d-a0a7-d5ea8968bb9f', '1b885eed-5d52-5c0b-be1f-a79797d1e7a9', 'IOT_HARDWARE_CONECTADO_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos de ingeniería y técnicos que necesitan formación en nuevas tecnologías', '{}'::jsonb, 'subindustries.json', 'iot-hardware-conectado.ubits_fit_signals', true, 0),
    ('632a0ad1-d95a-5edd-b805-97be96818f9f', 'b684211e-413a-54d3-8989-a8139e2c1285', 'SOFTWARE_FACTORY_NEARSHORE_INCLUSION_01', 'inclusion', 'model', 'high', 'El modelo de negocio principal es proveer capacidad de desarrollo de software', '{}'::jsonb, 'subindustries.json', 'software-factory-nearshore.inclusion_criteria', true, 0),
    ('b69b5766-7d6f-5d00-8df7-adea0489c701', 'b684211e-413a-54d3-8989-a8139e2c1285', 'SOFTWARE_FACTORY_NEARSHORE_INCLUSION_02', 'inclusion', 'model', 'high', 'Sus clientes son empresas que necesitan equipos técnicos externos o desarrollo a medida', '{}'::jsonb, 'subindustries.json', 'software-factory-nearshore.inclusion_criteria', true, 1),
    ('9e3ab837-a038-5cb0-8802-ee070a7d17bc', 'b684211e-413a-54d3-8989-a8139e2c1285', 'SOFTWARE_FACTORY_NEARSHORE_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa con producto propio (SaaS, ERP) que también hace desarrollo (→ software-empresarial o especialidad)', '{}'::jsonb, 'subindustries.json', 'software-factory-nearshore.exclusion_criteria', true, 0),
    ('761e1c5e-27aa-5778-a3c4-d37284a78dbd', 'b684211e-413a-54d3-8989-a8139e2c1285', 'SOFTWARE_FACTORY_NEARSHORE_EXCLUSION_02', 'exclusion', 'model', 'high', 'Consultora de transformación digital sin capacidad de desarrollo', '{}'::jsonb, 'subindustries.json', 'software-factory-nearshore.exclusion_criteria', true, 1),
    ('becb6857-7b90-50b6-b2b7-5b3f373ff5cc', 'b684211e-413a-54d3-8989-a8139e2c1285', 'SOFTWARE_FACTORY_NEARSHORE_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Alta demanda de reskilling técnico', '{}'::jsonb, 'subindustries.json', 'software-factory-nearshore.ubits_fit_signals', true, 0),
    ('cd9ebe5e-a66c-5d19-a7ba-6b543c9edd1e', 'b684211e-413a-54d3-8989-a8139e2c1285', 'SOFTWARE_FACTORY_NEARSHORE_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Certificaciones en metodologías ágiles y cloud', '{}'::jsonb, 'subindustries.json', 'software-factory-nearshore.ubits_fit_signals', true, 1),
    ('4156cdb1-4a62-59a7-8138-92801a13be45', 'b684211e-413a-54d3-8989-a8139e2c1285', 'SOFTWARE_FACTORY_NEARSHORE_FIT_SIGNAL_03', 'fit_signal', 'model', 'normal', 'Equipos de delivery técnico que necesitan formación continua', '{}'::jsonb, 'subindustries.json', 'software-factory-nearshore.ubits_fit_signals', true, 2),
    ('52c02b72-7d90-5de3-b8aa-aa04d8ae9505', '7d2ce6cb-2dbd-5c46-93dc-502241887d69', 'TELECOMUNICACIONES_TECH_INCLUSION_01', 'inclusion', 'model', 'high', 'Opera en provisión de servicios de comunicación o conectividad', '{}'::jsonb, 'subindustries.json', 'telecomunicaciones-tech.inclusion_criteria', true, 0),
    ('0cf7b7b0-92b3-5439-bc64-85f1a86b6aa9', '7d2ce6cb-2dbd-5c46-93dc-502241887d69', 'TELECOMUNICACIONES_TECH_INCLUSION_02', 'inclusion', 'model', 'high', 'Sus clientes son empresas u operadores que necesitan infraestructura de comunicación', '{}'::jsonb, 'subindustries.json', 'telecomunicaciones-tech.inclusion_criteria', true, 1),
    ('91ab8ca6-d090-5ec0-9389-1d35959fe264', '7d2ce6cb-2dbd-5c46-93dc-502241887d69', 'TELECOMUNICACIONES_TECH_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa de hardware de telecomunicaciones sin servicio de conectividad', '{}'::jsonb, 'subindustries.json', 'telecomunicaciones-tech.exclusion_criteria', true, 0),
    ('cb1dcfeb-8900-5079-bc6d-d6edf0b73301', '7d2ce6cb-2dbd-5c46-93dc-502241887d69', 'TELECOMUNICACIONES_TECH_EXCLUSION_02', 'exclusion', 'model', 'high', 'Empresa de radiodifusión o medios de comunicación', '{}'::jsonb, 'subindustries.json', 'telecomunicaciones-tech.exclusion_criteria', true, 1),
    ('14f6aa24-d5c5-5308-9eeb-cad4ac515029', '7d2ce6cb-2dbd-5c46-93dc-502241887d69', 'TELECOMUNICACIONES_TECH_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos técnicos y comerciales que necesitan formación en nuevas tecnologías de conectividad', '{}'::jsonb, 'subindustries.json', 'telecomunicaciones-tech.ubits_fit_signals', true, 0),
    ('e3516d36-61ce-5eb5-8bf4-04dffa401c3b', 'ec013b35-657a-5a4d-b500-477222d724bc', 'QA_TESTING_AUTOMATIZACION_INCLUSION_01', 'inclusion', 'model', 'high', 'El servicio o producto principal es testing de software, QA o automatización de procesos', '{}'::jsonb, 'subindustries.json', 'qa-testing-automatizacion.inclusion_criteria', true, 0),
    ('f443e42f-2086-5ae9-9c80-2d337b8cba47', 'ec013b35-657a-5a4d-b500-477222d724bc', 'QA_TESTING_AUTOMATIZACION_INCLUSION_02', 'inclusion', 'model', 'high', 'Sus clientes son empresas que necesitan asegurar calidad de software o automatizar procesos', '{}'::jsonb, 'subindustries.json', 'qa-testing-automatizacion.inclusion_criteria', true, 1),
    ('703d5899-f873-556d-a1ce-4e397add24c8', 'ec013b35-657a-5a4d-b500-477222d724bc', 'QA_TESTING_AUTOMATIZACION_EXCLUSION_01', 'exclusion', 'model', 'high', 'Software factory que hace QA internamente como parte de un entregable mayor', '{}'::jsonb, 'subindustries.json', 'qa-testing-automatizacion.exclusion_criteria', true, 0),
    ('a889c51c-edbd-5119-80d3-4c4406f5c645', 'ec013b35-657a-5a4d-b500-477222d724bc', 'QA_TESTING_AUTOMATIZACION_EXCLUSION_02', 'exclusion', 'model', 'high', 'Consultora generalista sin práctica específica de QA/RPA', '{}'::jsonb, 'subindustries.json', 'qa-testing-automatizacion.exclusion_criteria', true, 1),
    ('a0007067-22d6-54af-85e0-b8e51148a0a9', 'ec013b35-657a-5a4d-b500-477222d724bc', 'QA_TESTING_AUTOMATIZACION_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos de QA y automatización que necesitan certificaciones', '{}'::jsonb, 'subindustries.json', 'qa-testing-automatizacion.ubits_fit_signals', true, 0),
    ('b19ab89c-1572-5d88-b7e0-70bba4ac6d7e', 'ec013b35-657a-5a4d-b500-477222d724bc', 'QA_TESTING_AUTOMATIZACION_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Demanda de upskilling en herramientas de testing', '{}'::jsonb, 'subindustries.json', 'qa-testing-automatizacion.ubits_fit_signals', true, 1)
;

INSERT INTO public.subindustry_rules (
    id, subindustry_id, rule_key, rule_type, execution_layer, priority,
    rule_text, configuration, source_document, source_section, active, sort_order
) VALUES
    ('ffd99077-11f8-507f-8b1c-60378aec9459', 'b9c5711c-21fa-51f9-8aca-30d12a012dd9', 'SEGUROS_VIDA_PERSONAS_INCLUSION_01', 'inclusion', 'model', 'high', 'Aseguradora regulada en ramos de vida, accidentes o salud grupal', '{}'::jsonb, 'subindustries.json', 'seguros-vida-personas.inclusion_criteria', true, 0),
    ('10229f1f-820f-5ad5-88f6-39d97a0ae2d1', 'b9c5711c-21fa-51f9-8aca-30d12a012dd9', 'SEGUROS_VIDA_PERSONAS_INCLUSION_02', 'inclusion', 'model', 'high', 'Opera suscripción y administración de seguros de personas', '{}'::jsonb, 'subindustries.json', 'seguros-vida-personas.inclusion_criteria', true, 1),
    ('897cf8fd-da2c-5253-ac8b-5ae5eb118b5a', 'b9c5711c-21fa-51f9-8aca-30d12a012dd9', 'SEGUROS_VIDA_PERSONAS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa de medicina prepagada sin carácter asegurador formal (→ Salud > medicina-prepagada)', '{}'::jsonb, 'subindustries.json', 'seguros-vida-personas.exclusion_criteria', true, 0),
    ('dd2fb6c7-1308-5af7-9b36-efa8a2cc280f', 'b9c5711c-21fa-51f9-8aca-30d12a012dd9', 'SEGUROS_VIDA_PERSONAS_EXCLUSION_02', 'exclusion', 'model', 'high', 'Fondo de pensiones voluntarias sin seguro de vida', '{}'::jsonb, 'subindustries.json', 'seguros-vida-personas.exclusion_criteria', true, 1),
    ('191ffe16-f06d-5383-b99d-77ad920ad008', 'b9c5711c-21fa-51f9-8aca-30d12a012dd9', 'SEGUROS_VIDA_PERSONAS_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Gran red de asesores comerciales', '{}'::jsonb, 'subindustries.json', 'seguros-vida-personas.ubits_fit_signals', true, 0),
    ('8435336a-94fb-5701-a857-3dcf17457e68', 'b9c5711c-21fa-51f9-8aca-30d12a012dd9', 'SEGUROS_VIDA_PERSONAS_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Fuerza de ventas que requiere formación en productos y cumplimiento', '{}'::jsonb, 'subindustries.json', 'seguros-vida-personas.ubits_fit_signals', true, 1),
    ('5ea12b34-d0ca-5e25-af0f-b6640666e30a', 'b9c5711c-21fa-51f9-8aca-30d12a012dd9', 'SEGUROS_VIDA_PERSONAS_FIT_SIGNAL_03', 'fit_signal', 'model', 'normal', 'Equipos de retención y servicio', '{}'::jsonb, 'subindustries.json', 'seguros-vida-personas.ubits_fit_signals', true, 2),
    ('e095a841-1985-5fb6-9239-57f6b8d02ccb', '14fdb758-d9d0-56b8-a899-4b2529e87a43', 'BROKERS_INTERMEDIARIOS_SEGUROS_INCLUSION_01', 'inclusion', 'model', 'high', 'Actúa como intermediario entre aseguradoras y clientes corporativos', '{}'::jsonb, 'subindustries.json', 'brokers-intermediarios-seguros.inclusion_criteria', true, 0),
    ('f228ebf1-c340-59f2-b4aa-f9a7cd6c7efc', '14fdb758-d9d0-56b8-a899-4b2529e87a43', 'BROKERS_INTERMEDIARIOS_SEGUROS_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene equipo comercial con escala suficiente para UBITS', '{}'::jsonb, 'subindustries.json', 'brokers-intermediarios-seguros.inclusion_criteria', true, 1),
    ('d356e90d-0023-5ed3-9f0d-fbeb08174853', '14fdb758-d9d0-56b8-a899-4b2529e87a43', 'BROKERS_INTERMEDIARIOS_SEGUROS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Aseguradora que también tiene canal directo sin ser su modelo principal', '{}'::jsonb, 'subindustries.json', 'brokers-intermediarios-seguros.exclusion_criteria', true, 0),
    ('ed500e85-f908-5d47-a998-cffd6584bcf4', '14fdb758-d9d0-56b8-a899-4b2529e87a43', 'BROKERS_INTERMEDIARIOS_SEGUROS_EXCLUSION_02', 'exclusion', 'model', 'high', 'Corredor individual sin estructura empresarial', '{}'::jsonb, 'subindustries.json', 'brokers-intermediarios-seguros.exclusion_criteria', true, 1),
    ('47cbe814-de2c-5c34-8078-c4a5897ab549', '14fdb758-d9d0-56b8-a899-4b2529e87a43', 'BROKERS_INTERMEDIARIOS_SEGUROS_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Asesores que necesitan formación en productos, regulación y técnicas de venta', '{}'::jsonb, 'subindustries.json', 'brokers-intermediarios-seguros.ubits_fit_signals', true, 0),
    ('cd65a703-ed74-571d-852d-70b57be40923', 'c4291ea6-67e1-52ff-ae79-5a67939cf448', 'FACTORING_LEASING_CREDITO_INCLUSION_01', 'inclusion', 'model', 'high', 'El producto principal es factoring, leasing o crédito empresarial', '{}'::jsonb, 'subindustries.json', 'factoring-leasing-credito.inclusion_criteria', true, 0),
    ('ecd28dc5-c735-5c76-a4f0-de09af7b21d8', 'c4291ea6-67e1-52ff-ae79-5a67939cf448', 'FACTORING_LEASING_CREDITO_INCLUSION_02', 'inclusion', 'model', 'high', 'Sus clientes son empresas que necesitan financiamiento o capital de trabajo', '{}'::jsonb, 'subindustries.json', 'factoring-leasing-credito.inclusion_criteria', true, 1),
    ('da3b7369-4fec-5f99-a17b-28c440fc770a', 'c4291ea6-67e1-52ff-ae79-5a67939cf448', 'FACTORING_LEASING_CREDITO_EXCLUSION_01', 'exclusion', 'model', 'high', 'Banco que también ofrece factoring como parte de su portafolio (→ banca-tradicional)', '{}'::jsonb, 'subindustries.json', 'factoring-leasing-credito.exclusion_criteria', true, 0),
    ('49118c43-e665-5a49-aa3c-2b252e96baa8', 'c4291ea6-67e1-52ff-ae79-5a67939cf448', 'FACTORING_LEASING_CREDITO_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos comerciales y de riesgo que necesitan formación especializada', '{}'::jsonb, 'subindustries.json', 'factoring-leasing-credito.ubits_fit_signals', true, 0),
    ('96846027-ff5f-5ed6-9b17-8f14b5b0a57d', '87822a25-bfed-5194-8931-b80e2898ea79', 'FONDOS_GESTION_ACTIVOS_INCLUSION_01', 'inclusion', 'model', 'high', 'Gestiona fondos de inversión o activos de terceros como negocio principal', '{}'::jsonb, 'subindustries.json', 'fondos-gestion-activos.inclusion_criteria', true, 0),
    ('455d4d01-1daa-5e3e-9a00-f04a100e2296', '87822a25-bfed-5194-8931-b80e2898ea79', 'FONDOS_GESTION_ACTIVOS_INCLUSION_02', 'inclusion', 'model', 'high', 'Supervisada por reguladores de valores o mercado de capitales', '{}'::jsonb, 'subindustries.json', 'fondos-gestion-activos.inclusion_criteria', true, 1),
    ('4b186c62-24b1-5cc2-afa2-000dfd205a51', '87822a25-bfed-5194-8931-b80e2898ea79', 'FONDOS_GESTION_ACTIVOS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Banco de inversión (→ banca-tradicional)', '{}'::jsonb, 'subindustries.json', 'fondos-gestion-activos.exclusion_criteria', true, 0),
    ('312427ff-f1a1-53f4-b85f-914695c1ef12', '87822a25-bfed-5194-8931-b80e2898ea79', 'FONDOS_GESTION_ACTIVOS_EXCLUSION_02', 'exclusion', 'model', 'high', 'Consultor de inversiones sin gestión de activos', '{}'::jsonb, 'subindustries.json', 'fondos-gestion-activos.exclusion_criteria', true, 1),
    ('a08e6396-c001-52ab-a4c2-a6c57c6f6032', '87822a25-bfed-5194-8931-b80e2898ea79', 'FONDOS_GESTION_ACTIVOS_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Analistas y gestores que necesitan formación continua en regulación y metodologías', '{}'::jsonb, 'subindustries.json', 'fondos-gestion-activos.ubits_fit_signals', true, 0),
    ('c2d90794-ef84-5086-9951-4993def05e31', '4668b75d-d69f-50ca-902e-d85767652d79', 'COOPERATIVAS_FINANCIERAS_INCLUSION_01', 'inclusion', 'model', 'high', 'Es una cooperativa de ahorro y crédito, caja o entidad solidaria con operación financiera', '{}'::jsonb, 'subindustries.json', 'cooperativas-financieras.inclusion_criteria', true, 0),
    ('6bebf0c8-5262-5f61-84fd-a44d217c2c68', '4668b75d-d69f-50ca-902e-d85767652d79', 'COOPERATIVAS_FINANCIERAS_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene masa crítica de empleados y operación regional', '{}'::jsonb, 'subindustries.json', 'cooperativas-financieras.inclusion_criteria', true, 1),
    ('3f55e74c-dd75-5af1-bb03-d8ea14e3cc15', '4668b75d-d69f-50ca-902e-d85767652d79', 'COOPERATIVAS_FINANCIERAS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Cooperativa de servicios no financieros (agropecuaria, transporte)', '{}'::jsonb, 'subindustries.json', 'cooperativas-financieras.exclusion_criteria', true, 0),
    ('1d8e0617-f139-5c3d-b721-257d503a69b2', '4668b75d-d69f-50ca-902e-d85767652d79', 'COOPERATIVAS_FINANCIERAS_EXCLUSION_02', 'exclusion', 'model', 'high', 'Entidad solidaria sin operación financiera formal', '{}'::jsonb, 'subindustries.json', 'cooperativas-financieras.exclusion_criteria', true, 1),
    ('2a0a6052-3448-5237-95aa-1d1250dca80e', '4668b75d-d69f-50ca-902e-d85767652d79', 'COOPERATIVAS_FINANCIERAS_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Personal numeroso que requiere capacitación en productos financieros y servicio al asociado', '{}'::jsonb, 'subindustries.json', 'cooperativas-financieras.ubits_fit_signals', true, 0),
    ('68ac7ea0-86c8-5517-8508-56baf35c27ad', 'c08be8e0-c6a9-5988-8a00-6fc666146f06', 'DISTRIBUIDORES_FARMACEUTICOS_INCLUSION_01', 'inclusion', 'model', 'high', 'Distribuye medicamentos o insumos médicos a gran escala', '{}'::jsonb, 'subindustries.json', 'distribuidores-farmaceuticos.inclusion_criteria', true, 0),
    ('502eb34b-fa20-555d-b677-54aa22a749b7', 'c08be8e0-c6a9-5988-8a00-6fc666146f06', 'DISTRIBUIDORES_FARMACEUTICOS_INCLUSION_02', 'inclusion', 'model', 'high', 'Opera entre fabricantes y canales de venta (mayorista)', '{}'::jsonb, 'subindustries.json', 'distribuidores-farmaceuticos.inclusion_criteria', true, 1),
    ('ee858630-74b4-52e8-ac23-b072adbfb4cb', 'c08be8e0-c6a9-5988-8a00-6fc666146f06', 'DISTRIBUIDORES_FARMACEUTICOS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Laboratorio farmacéutico que también distribuye (→ laboratorios-farmaceuticos si esa es la actividad principal)', '{}'::jsonb, 'subindustries.json', 'distribuidores-farmaceuticos.exclusion_criteria', true, 0),
    ('eb3312d8-275e-5d42-839c-3163c8e02a00', 'c08be8e0-c6a9-5988-8a00-6fc666146f06', 'DISTRIBUIDORES_FARMACEUTICOS_EXCLUSION_02', 'exclusion', 'model', 'high', 'Farmacia retail (→ Retail > farmacias-cadena)', '{}'::jsonb, 'subindustries.json', 'distribuidores-farmaceuticos.exclusion_criteria', true, 1),
    ('78972992-1781-5548-b0f8-a3b89fca102f', 'c08be8e0-c6a9-5988-8a00-6fc666146f06', 'DISTRIBUIDORES_FARMACEUTICOS_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos de ventas y logística que requieren formación', '{}'::jsonb, 'subindustries.json', 'distribuidores-farmaceuticos.ubits_fit_signals', true, 0),
    ('5ea51c66-72cc-57bd-b857-19ce8c94415c', 'c08be8e0-c6a9-5988-8a00-6fc666146f06', 'DISTRIBUIDORES_FARMACEUTICOS_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Cadena de frío y cumplimiento regulatorio', '{}'::jsonb, 'subindustries.json', 'distribuidores-farmaceuticos.ubits_fit_signals', true, 1),
    ('70a1adbc-e9e2-598a-b586-f13dafda6ff5', '33236dc9-8af2-542f-b88b-06b1584a01f9', 'DISPOSITIVOS_MEDICOS_MEDTECH_INCLUSION_01', 'inclusion', 'model', 'high', 'Fabrica, importa o distribuye dispositivos médicos registrados', '{}'::jsonb, 'subindustries.json', 'dispositivos-medicos-medtech.inclusion_criteria', true, 0),
    ('46a46c43-e3be-56ea-8aaf-c6bc69aab577', '33236dc9-8af2-542f-b88b-06b1584a01f9', 'DISPOSITIVOS_MEDICOS_MEDTECH_INCLUSION_02', 'inclusion', 'model', 'high', 'Requiere registro sanitario o aprobación regulatoria', '{}'::jsonb, 'subindustries.json', 'dispositivos-medicos-medtech.inclusion_criteria', true, 1),
    ('b466d20b-5762-5ada-9547-7dd74d4d771e', '33236dc9-8af2-542f-b88b-06b1584a01f9', 'DISPOSITIVOS_MEDICOS_MEDTECH_EXCLUSION_01', 'exclusion', 'model', 'high', 'Plataforma de salud digital sin dispositivo físico (→ Tecnología > healthtech-b2b)', '{}'::jsonb, 'subindustries.json', 'dispositivos-medicos-medtech.exclusion_criteria', true, 0),
    ('b85c4000-9ad3-576a-8212-9b797db6f00e', '33236dc9-8af2-542f-b88b-06b1584a01f9', 'DISPOSITIVOS_MEDICOS_MEDTECH_EXCLUSION_02', 'exclusion', 'model', 'high', 'Distribuidor generalista de insumos sin especialización médica', '{}'::jsonb, 'subindustries.json', 'dispositivos-medicos-medtech.exclusion_criteria', true, 1),
    ('83b2f65c-143d-50e5-8097-f1580b84117c', '33236dc9-8af2-542f-b88b-06b1584a01f9', 'DISPOSITIVOS_MEDICOS_MEDTECH_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos técnicos y comerciales que necesitan formación en productos médicos', '{}'::jsonb, 'subindustries.json', 'dispositivos-medicos-medtech.ubits_fit_signals', true, 0),
    ('9f32ffa6-1aff-5676-81a8-616d03608d44', '431a0c19-885d-5f59-ae46-a4e22f7e9486', 'LABORATORIOS_CLINICOS_DIAGNOSTICO_INCLUSION_01', 'inclusion', 'model', 'high', 'Provee servicios de diagnóstico clínico, imagenología o patología', '{}'::jsonb, 'subindustries.json', 'laboratorios-clinicos-diagnostico.inclusion_criteria', true, 0),
    ('90f2460e-9d0f-5de2-9b58-1c168235b81c', '431a0c19-885d-5f59-ae46-a4e22f7e9486', 'LABORATORIOS_CLINICOS_DIAGNOSTICO_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene red o múltiples puntos de toma de muestras', '{}'::jsonb, 'subindustries.json', 'laboratorios-clinicos-diagnostico.inclusion_criteria', true, 1),
    ('ad2cba74-4ec2-5891-b12d-505c3363a042', '431a0c19-885d-5f59-ae46-a4e22f7e9486', 'LABORATORIOS_CLINICOS_DIAGNOSTICO_EXCLUSION_01', 'exclusion', 'model', 'high', 'Laboratorio de una sola sede sin estructura empresarial', '{}'::jsonb, 'subindustries.json', 'laboratorios-clinicos-diagnostico.exclusion_criteria', true, 0),
    ('0d210ff0-9f26-5ff1-b5be-892f417874da', '431a0c19-885d-5f59-ae46-a4e22f7e9486', 'LABORATORIOS_CLINICOS_DIAGNOSTICO_EXCLUSION_02', 'exclusion', 'model', 'high', 'Laboratorio de investigación sin actividad clínica', '{}'::jsonb, 'subindustries.json', 'laboratorios-clinicos-diagnostico.exclusion_criteria', true, 1),
    ('1484debb-bf91-564d-8d26-d071da17b77b', '431a0c19-885d-5f59-ae46-a4e22f7e9486', 'LABORATORIOS_CLINICOS_DIAGNOSTICO_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Personal técnico y administrativo numeroso', '{}'::jsonb, 'subindustries.json', 'laboratorios-clinicos-diagnostico.ubits_fit_signals', true, 0),
    ('02b145e9-69fc-548e-b3ae-2c9bac6e1ae9', '431a0c19-885d-5f59-ae46-a4e22f7e9486', 'LABORATORIOS_CLINICOS_DIAGNOSTICO_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Protocolos de calidad y acreditación', '{}'::jsonb, 'subindustries.json', 'laboratorios-clinicos-diagnostico.ubits_fit_signals', true, 1),
    ('0e0f7b7b-715e-53a4-b1f0-bde560e06de8', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'MEDICINA_PREPAGADA_EPS_INCLUSION_01', 'inclusion', 'model', 'high', 'Intermedia o financia el acceso a servicios de salud para sus afiliados', '{}'::jsonb, 'subindustries.json', 'medicina-prepagada-eps.inclusion_criteria', true, 0),
    ('84ccaa97-73ec-509e-9abc-a2f007f3f946', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'MEDICINA_PREPAGADA_EPS_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene red de empresas cliente o empleadores como canal principal', '{}'::jsonb, 'subindustries.json', 'medicina-prepagada-eps.inclusion_criteria', true, 1),
    ('3cf6d63d-e4ea-516f-be26-c23dfbaae735', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'MEDICINA_PREPAGADA_EPS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Aseguradora de vida con seguro médico marginal (→ Servicios Financieros > seguros-vida)', '{}'::jsonb, 'subindustries.json', 'medicina-prepagada-eps.exclusion_criteria', true, 0),
    ('0f536d32-feab-530f-8611-cb89c644a02b', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'MEDICINA_PREPAGADA_EPS_EXCLUSION_02', 'exclusion', 'model', 'high', 'Red hospitalaria sin función aseguradora o de prepago', '{}'::jsonb, 'subindustries.json', 'medicina-prepagada-eps.exclusion_criteria', true, 1),
    ('cf6ddd55-2da3-50ad-b4bc-24c5aa6b6c01', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'MEDICINA_PREPAGADA_EPS_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Asesores comerciales y equipos de afiliaciones numerosos', '{}'::jsonb, 'subindustries.json', 'medicina-prepagada-eps.ubits_fit_signals', true, 0),
    ('4389ed09-cd57-5f9d-af3c-d289e1276313', '2bffda5f-45f2-5a36-84e5-5038562c6916', 'MEDICINA_PREPAGADA_EPS_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Formación en normativa de salud y productos', '{}'::jsonb, 'subindustries.json', 'medicina-prepagada-eps.ubits_fit_signals', true, 1),
    ('9bf9e838-f30f-579b-a10a-05c86be6eb4f', '24ea07e9-5a06-5236-92a3-b1f677e9e4fb', 'CRO_INVESTIGACION_CLINICA_INCLUSION_01', 'inclusion', 'model', 'high', 'Gestiona o facilita ensayos clínicos o investigación biomédica', '{}'::jsonb, 'subindustries.json', 'cro-investigacion-clinica.inclusion_criteria', true, 0)
;

INSERT INTO public.subindustry_rules (
    id, subindustry_id, rule_key, rule_type, execution_layer, priority,
    rule_text, configuration, source_document, source_section, active, sort_order
) VALUES
    ('2626f430-5a4d-5180-b98e-a9050a532734', '24ea07e9-5a06-5236-92a3-b1f677e9e4fb', 'CRO_INVESTIGACION_CLINICA_INCLUSION_02', 'inclusion', 'model', 'high', 'Sus clientes son laboratorios farmacéuticos o empresas de dispositivos médicos', '{}'::jsonb, 'subindustries.json', 'cro-investigacion-clinica.inclusion_criteria', true, 1),
    ('36209c8e-38ab-50de-9754-f216a6657a3d', '24ea07e9-5a06-5236-92a3-b1f677e9e4fb', 'CRO_INVESTIGACION_CLINICA_EXCLUSION_01', 'exclusion', 'model', 'high', 'Laboratorio farmacéutico que hace I+D internamente sin ser su servicio principal', '{}'::jsonb, 'subindustries.json', 'cro-investigacion-clinica.exclusion_criteria', true, 0),
    ('9376445c-7614-5cb1-8ac9-7478409ffd30', '24ea07e9-5a06-5236-92a3-b1f677e9e4fb', 'CRO_INVESTIGACION_CLINICA_EXCLUSION_02', 'exclusion', 'model', 'high', 'Academia o universidad con ensayos clínicos sin estructura comercial', '{}'::jsonb, 'subindustries.json', 'cro-investigacion-clinica.exclusion_criteria', true, 1),
    ('c996b902-6b01-50da-b81b-0a12b3f4a50b', '24ea07e9-5a06-5236-92a3-b1f677e9e4fb', 'CRO_INVESTIGACION_CLINICA_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos científicos y clínicos que necesitan certificaciones GCP y BPL', '{}'::jsonb, 'subindustries.json', 'cro-investigacion-clinica.ubits_fit_signals', true, 0),
    ('10d2ff08-43e5-5218-849d-623833c2f4b8', '975b1e2b-cd1f-59be-a00a-645de8d6ec34', 'EQUIPAMIENTO_HOSPITALARIO_INCLUSION_01', 'inclusion', 'model', 'high', 'Provee equipamiento o suministros a hospitales o clínicas como actividad principal', '{}'::jsonb, 'subindustries.json', 'equipamiento-hospitalario.inclusion_criteria', true, 0),
    ('27bb6c6e-b6c8-54ad-a19f-be4d4fcad89e', '975b1e2b-cd1f-59be-a00a-645de8d6ec34', 'EQUIPAMIENTO_HOSPITALARIO_INCLUSION_02', 'inclusion', 'model', 'high', 'Sus clientes son organizaciones de salud, no pacientes', '{}'::jsonb, 'subindustries.json', 'equipamiento-hospitalario.inclusion_criteria', true, 1),
    ('f9bec3d9-c435-53f4-92c6-e7e403387b66', '975b1e2b-cd1f-59be-a00a-645de8d6ec34', 'EQUIPAMIENTO_HOSPITALARIO_EXCLUSION_01', 'exclusion', 'model', 'high', 'Dispositivos médicos con registro sanitario e implantable (→ dispositivos-medicos-medtech)', '{}'::jsonb, 'subindustries.json', 'equipamiento-hospitalario.exclusion_criteria', true, 0),
    ('60c4fe01-91a8-53b3-91ad-c51b449e530c', '975b1e2b-cd1f-59be-a00a-645de8d6ec34', 'EQUIPAMIENTO_HOSPITALARIO_EXCLUSION_02', 'exclusion', 'model', 'high', 'Distribuidor generalista sin especialización en salud', '{}'::jsonb, 'subindustries.json', 'equipamiento-hospitalario.exclusion_criteria', true, 1),
    ('b1df7603-4f1e-5447-ad04-0cd6fd5dfec6', '975b1e2b-cd1f-59be-a00a-645de8d6ec34', 'EQUIPAMIENTO_HOSPITALARIO_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos comerciales técnicos especializados que necesitan formación en productos', '{}'::jsonb, 'subindustries.json', 'equipamiento-hospitalario.ubits_fit_signals', true, 0),
    ('88d2cfe4-94c3-5d87-ba72-39ca1ac4d0e7', '1779cc43-079d-5a5f-9e15-902f3cdbabae', 'UNIVERSIDADES_INSTITUTOS_PRIVADOS_INCLUSION_01', 'inclusion', 'model', 'high', 'Institución de educación superior privada con reconocimiento oficial', '{}'::jsonb, 'subindustries.json', 'universidades-institutos-privados.inclusion_criteria', true, 0),
    ('f740dd35-29d5-52e9-8394-175027200121', '1779cc43-079d-5a5f-9e15-902f3cdbabae', 'UNIVERSIDADES_INSTITUTOS_PRIVADOS_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene oferta de pregrado, posgrado o programas de educación continua', '{}'::jsonb, 'subindustries.json', 'universidades-institutos-privados.inclusion_criteria', true, 1),
    ('d9024de0-3a70-58bd-9d6e-a5512ecf1f7a', '1779cc43-079d-5a5f-9e15-902f3cdbabae', 'UNIVERSIDADES_INSTITUTOS_PRIVADOS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Colegio o institución de educación básica/media (K-12)', '{}'::jsonb, 'subindustries.json', 'universidades-institutos-privados.exclusion_criteria', true, 0),
    ('1983736b-0346-526b-9e33-4175efe4e0b9', '1779cc43-079d-5a5f-9e15-902f3cdbabae', 'UNIVERSIDADES_INSTITUTOS_PRIVADOS_EXCLUSION_02', 'exclusion', 'model', 'high', 'Academia o centro de idiomas sin carácter universitario', '{}'::jsonb, 'subindustries.json', 'universidades-institutos-privados.exclusion_criteria', true, 1),
    ('018efa04-f815-59a7-8e84-0db28418343f', '1779cc43-079d-5a5f-9e15-902f3cdbabae', 'UNIVERSIDADES_INSTITUTOS_PRIVADOS_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Docentes y administrativos que necesitan formación continua', '{}'::jsonb, 'subindustries.json', 'universidades-institutos-privados.ubits_fit_signals', true, 0),
    ('6ee758f9-57ab-5ba2-8c85-c07bdb06ae2a', '1779cc43-079d-5a5f-9e15-902f3cdbabae', 'UNIVERSIDADES_INSTITUTOS_PRIVADOS_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Oferta de educación corporativa o B2B', '{}'::jsonb, 'subindustries.json', 'universidades-institutos-privados.ubits_fit_signals', true, 1),
    ('7952bb80-065b-51ad-a5c9-cd61261f094f', '1779cc43-079d-5a5f-9e15-902f3cdbabae', 'UNIVERSIDADES_INSTITUTOS_PRIVADOS_FIT_SIGNAL_03', 'fit_signal', 'model', 'normal', 'Digitalización de programas', '{}'::jsonb, 'subindustries.json', 'universidades-institutos-privados.ubits_fit_signals', true, 2),
    ('aea509c9-76c1-5c55-94a3-7453915aff75', 'a4db23d2-6d94-5463-a171-fbee80028206', 'UNIVERSIDADES_PUBLICAS_RELEVANTES_INCLUSION_01', 'inclusion', 'model', 'high', 'Universidad pública con presupuesto autónomo', '{}'::jsonb, 'subindustries.json', 'universidades-publicas-relevantes.inclusion_criteria', true, 0),
    ('01993933-d3e1-5d36-b13f-f5c72dd59363', 'a4db23d2-6d94-5463-a171-fbee80028206', 'UNIVERSIDADES_PUBLICAS_RELEVANTES_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene oferta de educación continua, educación ejecutiva o formación para empresas', '{}'::jsonb, 'subindustries.json', 'universidades-publicas-relevantes.inclusion_criteria', true, 1),
    ('d6f84b8e-7a4a-5d3b-ab50-268bef21121b', 'a4db23d2-6d94-5463-a171-fbee80028206', 'UNIVERSIDADES_PUBLICAS_RELEVANTES_EXCLUSION_01', 'exclusion', 'model', 'high', 'Universidad pública sin ruta comercial clara para UBITS', '{}'::jsonb, 'subindustries.json', 'universidades-publicas-relevantes.exclusion_criteria', true, 0),
    ('42499372-c5ca-5dec-b8fc-f63e480e9117', 'a4db23d2-6d94-5463-a171-fbee80028206', 'UNIVERSIDADES_PUBLICAS_RELEVANTES_EXCLUSION_02', 'exclusion', 'model', 'high', 'Institución pública de educación básica o media', '{}'::jsonb, 'subindustries.json', 'universidades-publicas-relevantes.exclusion_criteria', true, 1),
    ('f6a503ba-ccc3-5066-a4b8-4b3f5d27ea4a', 'a4db23d2-6d94-5463-a171-fbee80028206', 'UNIVERSIDADES_PUBLICAS_RELEVANTES_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Programas de formación para funcionarios públicos', '{}'::jsonb, 'subindustries.json', 'universidades-publicas-relevantes.ubits_fit_signals', true, 0),
    ('77506288-b7df-5dd6-b4bb-98f605abc833', 'a4db23d2-6d94-5463-a171-fbee80028206', 'UNIVERSIDADES_PUBLICAS_RELEVANTES_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Alianzas corporativas en educación continua', '{}'::jsonb, 'subindustries.json', 'universidades-publicas-relevantes.ubits_fit_signals', true, 1),
    ('6eb1bfd4-8855-583a-9520-ec1b1d1dfec0', '0f8a58ca-4ff5-5c96-8856-15ec3b74d50c', 'ESCUELAS_NEGOCIOS_EJECUTIVA_INCLUSION_01', 'inclusion', 'model', 'high', 'Oferta principal orientada a directivos, gerentes y profesionales senior', '{}'::jsonb, 'subindustries.json', 'escuelas-negocios-ejecutiva.inclusion_criteria', true, 0),
    ('e7230514-d254-58ab-9a2e-4ba79a1d7ef7', '0f8a58ca-4ff5-5c96-8856-15ec3b74d50c', 'ESCUELAS_NEGOCIOS_EJECUTIVA_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene programas de formación ejecutiva o MBA con escala empresarial', '{}'::jsonb, 'subindustries.json', 'escuelas-negocios-ejecutiva.inclusion_criteria', true, 1),
    ('021b3109-7f39-5aca-998f-7e9b667770ba', '0f8a58ca-4ff5-5c96-8856-15ec3b74d50c', 'ESCUELAS_NEGOCIOS_EJECUTIVA_EXCLUSION_01', 'exclusion', 'model', 'high', 'Universidad con solo un programa ejecutivo marginal (→ universidades-institutos-privados)', '{}'::jsonb, 'subindustries.json', 'escuelas-negocios-ejecutiva.exclusion_criteria', true, 0),
    ('e15b62f9-33cd-5601-ab5f-3f44b2edcc5c', '0f8a58ca-4ff5-5c96-8856-15ec3b74d50c', 'ESCUELAS_NEGOCIOS_EJECUTIVA_EXCLUSION_02', 'exclusion', 'model', 'high', 'Consultor de liderazgo individual sin institución formal', '{}'::jsonb, 'subindustries.json', 'escuelas-negocios-ejecutiva.exclusion_criteria', true, 1),
    ('c86b9e45-0e4c-54eb-8ec8-30e1d19b2353', '0f8a58ca-4ff5-5c96-8856-15ec3b74d50c', 'ESCUELAS_NEGOCIOS_EJECUTIVA_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Mercado objetivo similar a UBITS', '{}'::jsonb, 'subindustries.json', 'escuelas-negocios-ejecutiva.ubits_fit_signals', true, 0),
    ('1fe16612-f747-5819-847d-50354296b783', '0f8a58ca-4ff5-5c96-8856-15ec3b74d50c', 'ESCUELAS_NEGOCIOS_EJECUTIVA_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Posible alianza o canal B2B complementario', '{}'::jsonb, 'subindustries.json', 'escuelas-negocios-ejecutiva.ubits_fit_signals', true, 1),
    ('78258f64-979f-53ef-a114-db228a737fef', '3e9f8993-6d08-5206-8f71-d69b9f99a71c', 'CERTIFICACION_PROFESIONAL_B2B_INCLUSION_01', 'inclusion', 'model', 'high', 'El producto principal es otorgar o preparar para certificaciones reconocidas', '{}'::jsonb, 'subindustries.json', 'certificacion-profesional-b2b.inclusion_criteria', true, 0),
    ('5419c03b-5f9e-56c8-939f-62d80629d874', '3e9f8993-6d08-5206-8f71-d69b9f99a71c', 'CERTIFICACION_PROFESIONAL_B2B_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene oferta B2B o empresarial para certificar equipos', '{}'::jsonb, 'subindustries.json', 'certificacion-profesional-b2b.inclusion_criteria', true, 1),
    ('49688faf-eb88-5b6b-a1ed-54d87737eb51', '3e9f8993-6d08-5206-8f71-d69b9f99a71c', 'CERTIFICACION_PROFESIONAL_B2B_EXCLUSION_01', 'exclusion', 'model', 'high', 'Academia de formación que prepara para certificaciones pero no las otorga', '{}'::jsonb, 'subindustries.json', 'certificacion-profesional-b2b.exclusion_criteria', true, 0),
    ('133bd6fb-d92a-5b3b-9c71-b4e25dd39bec', '3e9f8993-6d08-5206-8f71-d69b9f99a71c', 'CERTIFICACION_PROFESIONAL_B2B_EXCLUSION_02', 'exclusion', 'model', 'high', 'Proveedor de certificación de producto sin negocio de formación', '{}'::jsonb, 'subindustries.json', 'certificacion-profesional-b2b.exclusion_criteria', true, 1),
    ('d4467ac1-c0c1-5c77-a6da-753587b60cd2', '3e9f8993-6d08-5206-8f71-d69b9f99a71c', 'CERTIFICACION_PROFESIONAL_B2B_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Portafolio complementario a UBITS — posible alianza o coopetencia', '{}'::jsonb, 'subindustries.json', 'certificacion-profesional-b2b.ubits_fit_signals', true, 0),
    ('780a51d5-7f56-5f95-89fe-248803128d0c', '8efb5b7b-4790-570d-ade7-a44effcd5a49', 'GRUPOS_EDUCATIVOS_RED_INCLUSION_01', 'inclusion', 'model', 'high', 'Opera múltiples instituciones educativas bajo una estructura corporativa', '{}'::jsonb, 'subindustries.json', 'grupos-educativos-red.inclusion_criteria', true, 0),
    ('e0a65d8c-7d5a-59e1-ae46-18dcc372fe74', '8efb5b7b-4790-570d-ade7-a44effcd5a49', 'GRUPOS_EDUCATIVOS_RED_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene presencia regional o nacional con escala suficiente', '{}'::jsonb, 'subindustries.json', 'grupos-educativos-red.inclusion_criteria', true, 1),
    ('2b89fe61-243d-599b-a153-90419d985a18', '8efb5b7b-4790-570d-ade7-a44effcd5a49', 'GRUPOS_EDUCATIVOS_RED_EXCLUSION_01', 'exclusion', 'model', 'high', 'Universidad con una sola sede sin holding educativo (→ universidades-institutos-privados)', '{}'::jsonb, 'subindustries.json', 'grupos-educativos-red.exclusion_criteria', true, 0),
    ('9ab1b27b-23ca-52e4-92b1-003ebc807899', '8efb5b7b-4790-570d-ade7-a44effcd5a49', 'GRUPOS_EDUCATIVOS_RED_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Empleados docentes y administrativos de escala', '{}'::jsonb, 'subindustries.json', 'grupos-educativos-red.ubits_fit_signals', true, 0),
    ('392ccb7e-9a62-5b98-ab13-2a4bc31211bb', '8efb5b7b-4790-570d-ade7-a44effcd5a49', 'GRUPOS_EDUCATIVOS_RED_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Plataformas digitales que necesitan capacitación', '{}'::jsonb, 'subindustries.json', 'grupos-educativos-red.ubits_fit_signals', true, 1),
    ('b2b07725-0418-553a-8b46-e411c02bdfc5', '8efb5b7b-4790-570d-ade7-a44effcd5a49', 'GRUPOS_EDUCATIVOS_RED_FIT_SIGNAL_03', 'fit_signal', 'model', 'normal', 'Programas corporativos en expansión', '{}'::jsonb, 'subindustries.json', 'grupos-educativos-red.ubits_fit_signals', true, 2),
    ('f6cb9a11-7dd2-5493-bcd5-dc98584cf9ba', 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d', 'SUPERMERCADOS_HIPERMERCADOS_INCLUSION_01', 'inclusion', 'model', 'high', 'Opera cadena de tiendas de alimentación o conveniencia con múltiples puntos de venta', '{}'::jsonb, 'subindustries.json', 'supermercados-hipermercados.inclusion_criteria', true, 0),
    ('ccf25e37-41ca-5b55-ae38-942e2851efd6', 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d', 'SUPERMERCADOS_HIPERMERCADOS_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene estructura empresarial formal y escala corporativa', '{}'::jsonb, 'subindustries.json', 'supermercados-hipermercados.inclusion_criteria', true, 1),
    ('3e4e9433-b894-58a7-ab50-d453af7830a1', 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d', 'SUPERMERCADOS_HIPERMERCADOS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Tienda única de barrio sin red ni estructura corporativa', '{}'::jsonb, 'subindustries.json', 'supermercados-hipermercados.exclusion_criteria', true, 0),
    ('072da92e-f4c0-52d6-a160-cb474def0155', 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d', 'SUPERMERCADOS_HIPERMERCADOS_EXCLUSION_02', 'exclusion', 'model', 'high', 'Fabricante de alimentos sin cadena propia (→ fabricantes-alimentos-bebidas)', '{}'::jsonb, 'subindustries.json', 'supermercados-hipermercados.exclusion_criteria', true, 1),
    ('4d77cedc-dc03-57ef-b85c-9dcd1e61dbbd', 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d', 'SUPERMERCADOS_HIPERMERCADOS_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Alta rotación operativa', '{}'::jsonb, 'subindustries.json', 'supermercados-hipermercados.ubits_fit_signals', true, 0),
    ('7a9aa5d3-69a5-5415-ae7f-e5d723ce47e4', 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d', 'SUPERMERCADOS_HIPERMERCADOS_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Cajeros, vendedores y supervisores que necesitan formación', '{}'::jsonb, 'subindustries.json', 'supermercados-hipermercados.ubits_fit_signals', true, 1),
    ('9974d5a9-af5c-546f-81fe-19c3ee1975dd', 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d', 'SUPERMERCADOS_HIPERMERCADOS_FIT_SIGNAL_03', 'fit_signal', 'model', 'normal', 'Expansión de tiendas', '{}'::jsonb, 'subindustries.json', 'supermercados-hipermercados.ubits_fit_signals', true, 2),
    ('467f4e54-8c63-52f3-8c47-e40acf5a44af', '912a4b36-8597-5204-bb8e-814fb0769505', 'TIENDAS_DEPARTAMENTO_MODA_INCLUSION_01', 'inclusion', 'model', 'high', 'Opera cadena de tiendas especializadas o por departamento', '{}'::jsonb, 'subindustries.json', 'tiendas-departamento-moda.inclusion_criteria', true, 0),
    ('73ed82ae-7ab5-59d9-b809-66853701fc11', '912a4b36-8597-5204-bb8e-814fb0769505', 'TIENDAS_DEPARTAMENTO_MODA_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene red de puntos de venta con estructura empresarial', '{}'::jsonb, 'subindustries.json', 'tiendas-departamento-moda.inclusion_criteria', true, 1),
    ('5d2150bc-8aee-50b6-9207-79caf88d61ad', '912a4b36-8597-5204-bb8e-814fb0769505', 'TIENDAS_DEPARTAMENTO_MODA_EXCLUSION_01', 'exclusion', 'model', 'high', 'Marca D2C de una sola tienda sin red retail', '{}'::jsonb, 'subindustries.json', 'tiendas-departamento-moda.exclusion_criteria', true, 0),
    ('997a5bbc-71a8-5cbf-9b54-b5bc86cc1f85', '912a4b36-8597-5204-bb8e-814fb0769505', 'TIENDAS_DEPARTAMENTO_MODA_EXCLUSION_02', 'exclusion', 'model', 'high', 'Fabricante que solo vende en canal propio sin tiendas físicas', '{}'::jsonb, 'subindustries.json', 'tiendas-departamento-moda.exclusion_criteria', true, 1)
;

INSERT INTO public.subindustry_rules (
    id, subindustry_id, rule_key, rule_type, execution_layer, priority,
    rule_text, configuration, source_document, source_section, active, sort_order
) VALUES
    ('d0744c52-249d-5633-b5f1-9465bffbfd2a', '912a4b36-8597-5204-bb8e-814fb0769505', 'TIENDAS_DEPARTAMENTO_MODA_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Fuerza de ventas numerosa', '{}'::jsonb, 'subindustries.json', 'tiendas-departamento-moda.ubits_fit_signals', true, 0),
    ('0e40898e-9761-5cae-99b1-973d4b722680', '912a4b36-8597-5204-bb8e-814fb0769505', 'TIENDAS_DEPARTAMENTO_MODA_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Gerentes de tienda que necesitan liderazgo', '{}'::jsonb, 'subindustries.json', 'tiendas-departamento-moda.ubits_fit_signals', true, 1),
    ('8432f41d-aa81-5e5c-b1ef-5d255c6922dd', '912a4b36-8597-5204-bb8e-814fb0769505', 'TIENDAS_DEPARTAMENTO_MODA_FIT_SIGNAL_03', 'fit_signal', 'model', 'normal', 'Expansión regional', '{}'::jsonb, 'subindustries.json', 'tiendas-departamento-moda.ubits_fit_signals', true, 2),
    ('a0e3a553-a88c-5128-9acd-dc5903bfe22d', 'd49ba019-c2e4-59b5-bc58-12724ec1f152', 'FARMACIAS_CADENA_RETAIL_INCLUSION_01', 'inclusion', 'model', 'high', 'Opera cadena de farmacias o puntos de venta de salud al consumidor', '{}'::jsonb, 'subindustries.json', 'farmacias-cadena-retail.inclusion_criteria', true, 0),
    ('e0fd82c7-02b2-572a-9531-f4235e15acb3', 'd49ba019-c2e4-59b5-bc58-12724ec1f152', 'FARMACIAS_CADENA_RETAIL_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene red de tiendas con estructura corporativa', '{}'::jsonb, 'subindustries.json', 'farmacias-cadena-retail.inclusion_criteria', true, 1),
    ('7a0522c0-28c9-553b-b1fa-2728d19e1584', 'd49ba019-c2e4-59b5-bc58-12724ec1f152', 'FARMACIAS_CADENA_RETAIL_EXCLUSION_01', 'exclusion', 'model', 'high', 'Farmacia de barrio sin red ni estructura (sin escala suficiente)', '{}'::jsonb, 'subindustries.json', 'farmacias-cadena-retail.exclusion_criteria', true, 0),
    ('f75746c7-21d0-540d-be01-eff51c073f20', 'd49ba019-c2e4-59b5-bc58-12724ec1f152', 'FARMACIAS_CADENA_RETAIL_EXCLUSION_02', 'exclusion', 'model', 'high', 'Laboratorio farmacéutico sin cadena retail propia (→ Salud > laboratorios-farmaceuticos)', '{}'::jsonb, 'subindustries.json', 'farmacias-cadena-retail.exclusion_criteria', true, 1),
    ('1395a6a1-6689-505f-a9af-e890cbe17503', 'd49ba019-c2e4-59b5-bc58-12724ec1f152', 'FARMACIAS_CADENA_RETAIL_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Personal de atención al cliente y dependientes que necesitan formación', '{}'::jsonb, 'subindustries.json', 'farmacias-cadena-retail.ubits_fit_signals', true, 0),
    ('5ede6ae7-1488-5cc6-bf5d-db8ac3e999cd', 'd49ba019-c2e4-59b5-bc58-12724ec1f152', 'FARMACIAS_CADENA_RETAIL_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Expansión de puntos de venta', '{}'::jsonb, 'subindustries.json', 'farmacias-cadena-retail.ubits_fit_signals', true, 1),
    ('408cc255-f95f-5ad4-9bc8-9a12673ac629', '9d036663-b424-5989-9bfc-02c85b0c25c8', 'RETAILERS_ESPECIALIZADOS_INCLUSION_01', 'inclusion', 'model', 'high', 'Opera cadena de tiendas especializadas en una categoría', '{}'::jsonb, 'subindustries.json', 'retailers-especializados.inclusion_criteria', true, 0),
    ('1c13648e-036e-5417-a149-9ec6521f3b53', '9d036663-b424-5989-9bfc-02c85b0c25c8', 'RETAILERS_ESPECIALIZADOS_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene red de puntos de venta con estructura empresarial', '{}'::jsonb, 'subindustries.json', 'retailers-especializados.inclusion_criteria', true, 1),
    ('07ae259a-362b-52a9-8908-bda348a89d4d', '9d036663-b424-5989-9bfc-02c85b0c25c8', 'RETAILERS_ESPECIALIZADOS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Fabricante de la categoría sin tiendas propias', '{}'::jsonb, 'subindustries.json', 'retailers-especializados.exclusion_criteria', true, 0),
    ('bb78a01b-1fa0-5b21-9aa1-aac67663ce2d', '9d036663-b424-5989-9bfc-02c85b0c25c8', 'RETAILERS_ESPECIALIZADOS_EXCLUSION_02', 'exclusion', 'model', 'high', 'Tienda única especializada sin red', '{}'::jsonb, 'subindustries.json', 'retailers-especializados.exclusion_criteria', true, 1),
    ('2e68c73b-4343-5c8d-a103-00f0094ab72a', '9d036663-b424-5989-9bfc-02c85b0c25c8', 'RETAILERS_ESPECIALIZADOS_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Vendedores especializados que requieren formación técnica del producto', '{}'::jsonb, 'subindustries.json', 'retailers-especializados.ubits_fit_signals', true, 0),
    ('87d903be-cdd5-509e-95c2-f5af17a9422e', '9d036663-b424-5989-9bfc-02c85b0c25c8', 'RETAILERS_ESPECIALIZADOS_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Expansión regional', '{}'::jsonb, 'subindustries.json', 'retailers-especializados.ubits_fit_signals', true, 1),
    ('0bd10bc0-b511-55e2-8f67-f4992cee9c03', '8f893965-daf2-508f-95c7-bbc332595f3e', 'OPERADORES_OMNICANAL_INCLUSION_01', 'inclusion', 'model', 'high', 'Opera canales físicos y digitales de forma integrada, o es un marketplace con operación local', '{}'::jsonb, 'subindustries.json', 'operadores-omnicanal.inclusion_criteria', true, 0),
    ('64da5302-e639-5cdb-80e4-5781b2606c95', '8f893965-daf2-508f-95c7-bbc332595f3e', 'OPERADORES_OMNICANAL_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene estructura empresarial y escala suficiente', '{}'::jsonb, 'subindustries.json', 'operadores-omnicanal.inclusion_criteria', true, 1),
    ('063acbdc-545a-5fdd-997c-34116e5c9282', '8f893965-daf2-508f-95c7-bbc332595f3e', 'OPERADORES_OMNICANAL_EXCLUSION_01', 'exclusion', 'model', 'high', 'Tienda online pequeña sin escala corporativa', '{}'::jsonb, 'subindustries.json', 'operadores-omnicanal.exclusion_criteria', true, 0),
    ('3475e2ac-bbed-5b35-b57a-58ef53f037ae', '8f893965-daf2-508f-95c7-bbc332595f3e', 'OPERADORES_OMNICANAL_EXCLUSION_02', 'exclusion', 'model', 'high', 'Plataforma de ecommerce que habilita a terceros sin operar ventas propias (→ Tecnología > ecommerce-enablement)', '{}'::jsonb, 'subindustries.json', 'operadores-omnicanal.exclusion_criteria', true, 1),
    ('b6d373cb-ec5f-5b5b-802a-6f0f58012174', '8f893965-daf2-508f-95c7-bbc332595f3e', 'OPERADORES_OMNICANAL_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Equipos de operaciones digitales y customer success', '{}'::jsonb, 'subindustries.json', 'operadores-omnicanal.ubits_fit_signals', true, 0),
    ('008af960-3747-52c4-9e93-67f856c4ef41', '8f893965-daf2-508f-95c7-bbc332595f3e', 'OPERADORES_OMNICANAL_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Formación en herramientas omnicanal', '{}'::jsonb, 'subindustries.json', 'operadores-omnicanal.ubits_fit_signals', true, 1),
    ('1a374697-d292-5397-8a1a-aeed49481bca', '2b2ead23-b436-5b62-910e-997995ad2cd2', 'FABRICANTES_ALIMENTOS_BEBIDAS_INCLUSION_01', 'inclusion', 'model', 'high', 'Fabrica o distribuye bienes de consumo masivo de alimentos o bebidas a escala industrial', '{}'::jsonb, 'subindustries.json', 'fabricantes-alimentos-bebidas.inclusion_criteria', true, 0),
    ('24949191-1e0e-5eba-aa51-56dac84ffcab', '2b2ead23-b436-5b62-910e-997995ad2cd2', 'FABRICANTES_ALIMENTOS_BEBIDAS_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene planta productiva o red de distribución estructurada', '{}'::jsonb, 'subindustries.json', 'fabricantes-alimentos-bebidas.inclusion_criteria', true, 1),
    ('c24e7097-1073-5b09-8b95-d4a6f5904e17', '2b2ead23-b436-5b62-910e-997995ad2cd2', 'FABRICANTES_ALIMENTOS_BEBIDAS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Supermercado o retailer que vende alimentos (→ supermercados-hipermercados)', '{}'::jsonb, 'subindustries.json', 'fabricantes-alimentos-bebidas.exclusion_criteria', true, 0),
    ('59953955-893a-5ca8-b9d3-db5847d701c9', '2b2ead23-b436-5b62-910e-997995ad2cd2', 'FABRICANTES_ALIMENTOS_BEBIDAS_EXCLUSION_02', 'exclusion', 'model', 'high', 'Productor agroindustrial sin procesamiento ni marca (→ Manufactura > agroindustria-procesadora)', '{}'::jsonb, 'subindustries.json', 'fabricantes-alimentos-bebidas.exclusion_criteria', true, 1),
    ('dd292a0e-6c5c-592e-a5c5-50dc837f1819', '2b2ead23-b436-5b62-910e-997995ad2cd2', 'FABRICANTES_ALIMENTOS_BEBIDAS_EXCLUSION_03', 'exclusion', 'model', 'high', 'Restaurante o negocio de comida B2C', '{}'::jsonb, 'subindustries.json', 'fabricantes-alimentos-bebidas.exclusion_criteria', true, 2),
    ('658fb6b7-e332-5845-81c5-71eb89a69d35', '2b2ead23-b436-5b62-910e-997995ad2cd2', 'FABRICANTES_ALIMENTOS_BEBIDAS_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Fuerza comercial (vendedores de ruta, mercaderistas)', '{}'::jsonb, 'subindustries.json', 'fabricantes-alimentos-bebidas.ubits_fit_signals', true, 0),
    ('a536773a-a418-57a3-beeb-6c8e39574748', '2b2ead23-b436-5b62-910e-997995ad2cd2', 'FABRICANTES_ALIMENTOS_BEBIDAS_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Plantas con operarios y supervisores', '{}'::jsonb, 'subindustries.json', 'fabricantes-alimentos-bebidas.ubits_fit_signals', true, 1),
    ('76d86ea9-cec8-5fb5-a274-98bb3fe770a6', '2b2ead23-b436-5b62-910e-997995ad2cd2', 'FABRICANTES_ALIMENTOS_BEBIDAS_FIT_SIGNAL_03', 'fit_signal', 'model', 'normal', 'Trade marketing', '{}'::jsonb, 'subindustries.json', 'fabricantes-alimentos-bebidas.ubits_fit_signals', true, 2),
    ('33a0b46e-7b0e-543e-8ddb-6d44b351e316', '228440c9-a8d7-51b9-96cd-47bac896b0cf', 'CUIDADO_PERSONAL_HIGIENE_HOGAR_INCLUSION_01', 'inclusion', 'model', 'high', 'Fabrica o distribuye productos de cuidado personal, higiene o hogar a escala', '{}'::jsonb, 'subindustries.json', 'cuidado-personal-higiene-hogar.inclusion_criteria', true, 0),
    ('e123d2f7-a066-5aed-84e4-ba342948949d', '228440c9-a8d7-51b9-96cd-47bac896b0cf', 'CUIDADO_PERSONAL_HIGIENE_HOGAR_INCLUSION_02', 'inclusion', 'model', 'high', 'Opera canal moderno, tradicional o export con estructura empresarial', '{}'::jsonb, 'subindustries.json', 'cuidado-personal-higiene-hogar.inclusion_criteria', true, 1),
    ('871a7eb7-6fda-5035-92e8-e97dbcc1d0f5', '228440c9-a8d7-51b9-96cd-47bac896b0cf', 'CUIDADO_PERSONAL_HIGIENE_HOGAR_EXCLUSION_01', 'exclusion', 'model', 'high', 'Retailer que vende estas categorías sin fabricación propia (→ retailers-especializados o supermercados)', '{}'::jsonb, 'subindustries.json', 'cuidado-personal-higiene-hogar.exclusion_criteria', true, 0),
    ('828f7f73-8d82-5fce-b872-802a8ff5105e', '228440c9-a8d7-51b9-96cd-47bac896b0cf', 'CUIDADO_PERSONAL_HIGIENE_HOGAR_EXCLUSION_02', 'exclusion', 'model', 'high', 'Microproductor artesanal', '{}'::jsonb, 'subindustries.json', 'cuidado-personal-higiene-hogar.exclusion_criteria', true, 1),
    ('c9a4e2dc-6b90-53f4-8373-ffcb7d0f78d9', '228440c9-a8d7-51b9-96cd-47bac896b0cf', 'CUIDADO_PERSONAL_HIGIENE_HOGAR_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Fuerza comercial y de merchandising numerosa', '{}'::jsonb, 'subindustries.json', 'cuidado-personal-higiene-hogar.ubits_fit_signals', true, 0),
    ('b0750d15-6879-5505-ad85-b7314270448a', '228440c9-a8d7-51b9-96cd-47bac896b0cf', 'CUIDADO_PERSONAL_HIGIENE_HOGAR_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Expansión de portafolio y canales', '{}'::jsonb, 'subindustries.json', 'cuidado-personal-higiene-hogar.ubits_fit_signals', true, 1),
    ('cefc030d-fdf0-5760-9cb3-880c0e682371', '76d05169-addd-50f4-b0ef-67e6a0b07fc5', 'METALMECANICA_AUTOPARTES_INCLUSION_01', 'inclusion', 'model', 'high', 'Fabrica productos metalmecánicos, autopartes o componentes de precisión', '{}'::jsonb, 'subindustries.json', 'metalmecanica-autopartes.inclusion_criteria', true, 0),
    ('4c12f970-81a1-5498-87b2-26b653a958d0', '76d05169-addd-50f4-b0ef-67e6a0b07fc5', 'METALMECANICA_AUTOPARTES_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene planta productiva propia', '{}'::jsonb, 'subindustries.json', 'metalmecanica-autopartes.inclusion_criteria', true, 1),
    ('a3decf6e-021a-5fe5-906d-b7d5f9a5dc49', '76d05169-addd-50f4-b0ef-67e6a0b07fc5', 'METALMECANICA_AUTOPARTES_EXCLUSION_01', 'exclusion', 'model', 'high', 'Dealer o distribuidor de autopartes sin manufactura propia', '{}'::jsonb, 'subindustries.json', 'metalmecanica-autopartes.exclusion_criteria', true, 0),
    ('98f6f567-4fa8-5421-af8b-0177fe2198d5', '76d05169-addd-50f4-b0ef-67e6a0b07fc5', 'METALMECANICA_AUTOPARTES_EXCLUSION_02', 'exclusion', 'model', 'high', 'Taller metalmecánico artesanal sin estructura empresarial', '{}'::jsonb, 'subindustries.json', 'metalmecanica-autopartes.exclusion_criteria', true, 1),
    ('7364ee50-add2-54f7-971c-c55e055d859c', '76d05169-addd-50f4-b0ef-67e6a0b07fc5', 'METALMECANICA_AUTOPARTES_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Operarios y supervisores de planta', '{}'::jsonb, 'subindustries.json', 'metalmecanica-autopartes.ubits_fit_signals', true, 0),
    ('9c439568-59b3-5f81-a9ef-76a71dc2fdb4', '76d05169-addd-50f4-b0ef-67e6a0b07fc5', 'METALMECANICA_AUTOPARTES_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Seguridad industrial y lean manufacturing', '{}'::jsonb, 'subindustries.json', 'metalmecanica-autopartes.ubits_fit_signals', true, 1),
    ('fa785dc1-b089-58af-8429-73a14f30c211', '76d05169-addd-50f4-b0ef-67e6a0b07fc5', 'METALMECANICA_AUTOPARTES_FIT_SIGNAL_03', 'fit_signal', 'model', 'normal', 'Certificaciones ISO de calidad', '{}'::jsonb, 'subindustries.json', 'metalmecanica-autopartes.ubits_fit_signals', true, 2),
    ('716101f0-1793-5c7f-bf2a-6b22c3fafded', '55386a47-3bec-510a-91c6-ba61341f5676', 'QUIMICOS_PLASTICOS_PACKAGING_INCLUSION_01', 'inclusion', 'model', 'high', 'Fabrica insumos o materiales industriales (químicos, plásticos, packaging)', '{}'::jsonb, 'subindustries.json', 'quimicos-plasticos-packaging.inclusion_criteria', true, 0),
    ('37de8dd4-eefa-5694-9427-b758dbac7d5b', '55386a47-3bec-510a-91c6-ba61341f5676', 'QUIMICOS_PLASTICOS_PACKAGING_INCLUSION_02', 'inclusion', 'model', 'high', 'Vende principalmente a otras empresas (B2B industrial)', '{}'::jsonb, 'subindustries.json', 'quimicos-plasticos-packaging.inclusion_criteria', true, 1),
    ('906806fe-0d29-5929-be1f-18d87f1a3e6e', '55386a47-3bec-510a-91c6-ba61341f5676', 'QUIMICOS_PLASTICOS_PACKAGING_EXCLUSION_01', 'exclusion', 'model', 'high', 'Distribuidor comercial sin planta productiva', '{}'::jsonb, 'subindustries.json', 'quimicos-plasticos-packaging.exclusion_criteria', true, 0),
    ('7956195d-657f-570a-8d1d-3f14ee186a01', '55386a47-3bec-510a-91c6-ba61341f5676', 'QUIMICOS_PLASTICOS_PACKAGING_EXCLUSION_02', 'exclusion', 'model', 'high', 'Farmacéutica o laboratorio (→ Salud)', '{}'::jsonb, 'subindustries.json', 'quimicos-plasticos-packaging.exclusion_criteria', true, 1),
    ('1a70af56-8e32-50da-ad2f-d9d8c19e18c7', '55386a47-3bec-510a-91c6-ba61341f5676', 'QUIMICOS_PLASTICOS_PACKAGING_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Operarios de planta', '{}'::jsonb, 'subindustries.json', 'quimicos-plasticos-packaging.ubits_fit_signals', true, 0),
    ('97ca109c-2148-5e35-8c91-27617b2baa99', '55386a47-3bec-510a-91c6-ba61341f5676', 'QUIMICOS_PLASTICOS_PACKAGING_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Seguridad industrial y manejo de sustancias peligrosas', '{}'::jsonb, 'subindustries.json', 'quimicos-plasticos-packaging.ubits_fit_signals', true, 1),
    ('29c8dea6-db47-54db-9bc9-1f8b57f9bd63', '55386a47-3bec-510a-91c6-ba61341f5676', 'QUIMICOS_PLASTICOS_PACKAGING_FIT_SIGNAL_03', 'fit_signal', 'model', 'normal', 'ISO y certificaciones ambientales', '{}'::jsonb, 'subindustries.json', 'quimicos-plasticos-packaging.ubits_fit_signals', true, 2),
    ('f97e8b2f-892c-5fa5-b416-9b2a2cd464da', '9ff59aa5-f2b2-5271-a506-73470ba9a4d2', 'BIENES_CAPITAL_MAQUINARIA_INCLUSION_01', 'inclusion', 'model', 'high', 'Fabrica o integra maquinaria o equipos para uso industrial', '{}'::jsonb, 'subindustries.json', 'bienes-capital-maquinaria.inclusion_criteria', true, 0)
;

INSERT INTO public.subindustry_rules (
    id, subindustry_id, rule_key, rule_type, execution_layer, priority,
    rule_text, configuration, source_document, source_section, active, sort_order
) VALUES
    ('a62de067-fd3a-5ef4-b2a6-ff9836668ee7', '9ff59aa5-f2b2-5271-a506-73470ba9a4d2', 'BIENES_CAPITAL_MAQUINARIA_INCLUSION_02', 'inclusion', 'model', 'high', 'Sus clientes son otras empresas manufactureras o industriales', '{}'::jsonb, 'subindustries.json', 'bienes-capital-maquinaria.inclusion_criteria', true, 1),
    ('4caa1348-058d-55a7-b5d7-ff7ec494e744', '9ff59aa5-f2b2-5271-a506-73470ba9a4d2', 'BIENES_CAPITAL_MAQUINARIA_EXCLUSION_01', 'exclusion', 'model', 'high', 'Distribuidor de maquinaria sin fabricación o integración propia', '{}'::jsonb, 'subindustries.json', 'bienes-capital-maquinaria.exclusion_criteria', true, 0),
    ('891428cd-0155-51f0-836d-4ab47f19418e', '9ff59aa5-f2b2-5271-a506-73470ba9a4d2', 'BIENES_CAPITAL_MAQUINARIA_EXCLUSION_02', 'exclusion', 'model', 'high', 'Dispositivos médicos (→ Salud)', '{}'::jsonb, 'subindustries.json', 'bienes-capital-maquinaria.exclusion_criteria', true, 1),
    ('2d8957cb-aadb-54ce-a422-fbcc1826c0a4', '9ff59aa5-f2b2-5271-a506-73470ba9a4d2', 'BIENES_CAPITAL_MAQUINARIA_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Técnicos e ingenieros que necesitan capacitación en nuevas tecnologías', '{}'::jsonb, 'subindustries.json', 'bienes-capital-maquinaria.ubits_fit_signals', true, 0),
    ('999e1a9a-45d7-575e-b0af-e30c40070fbd', '9ff59aa5-f2b2-5271-a506-73470ba9a4d2', 'BIENES_CAPITAL_MAQUINARIA_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Industria 4.0 y automatización', '{}'::jsonb, 'subindustries.json', 'bienes-capital-maquinaria.ubits_fit_signals', true, 1),
    ('7ed6d8bf-80bd-57c8-9d64-278123eba557', '9158a6ee-d7ce-524b-a7e9-dc24f3269f92', 'MANUFACTURA_EXPORTADORA_INCLUSION_01', 'inclusion', 'model', 'high', 'Exporta parte significativa de su producción o opera en zona franca industrial', '{}'::jsonb, 'subindustries.json', 'manufactura-exportadora.inclusion_criteria', true, 0),
    ('44bfa7da-1643-5685-8ca2-b9b726dbd8bc', '9158a6ee-d7ce-524b-a7e9-dc24f3269f92', 'MANUFACTURA_EXPORTADORA_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene estándares internacionales de calidad o certificaciones de exportación', '{}'::jsonb, 'subindustries.json', 'manufactura-exportadora.inclusion_criteria', true, 1),
    ('be52d53d-0aac-5eb0-9eca-64e82a96f0a3', '9158a6ee-d7ce-524b-a7e9-dc24f3269f92', 'MANUFACTURA_EXPORTADORA_EXCLUSION_01', 'exclusion', 'model', 'high', 'Zona franca de servicios sin manufactura (→ Consultoría o Tecnología)', '{}'::jsonb, 'subindustries.json', 'manufactura-exportadora.exclusion_criteria', true, 0),
    ('e7bc9a90-6195-523d-81cc-247af546e115', '9158a6ee-d7ce-524b-a7e9-dc24f3269f92', 'MANUFACTURA_EXPORTADORA_EXCLUSION_02', 'exclusion', 'model', 'high', 'Comercializador internacional sin planta productiva', '{}'::jsonb, 'subindustries.json', 'manufactura-exportadora.exclusion_criteria', true, 1),
    ('7876b433-9cf0-5dde-b566-d00354131d09', '9158a6ee-d7ce-524b-a7e9-dc24f3269f92', 'MANUFACTURA_EXPORTADORA_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Inglés comercial y técnico', '{}'::jsonb, 'subindustries.json', 'manufactura-exportadora.ubits_fit_signals', true, 0),
    ('52d98721-3ef0-567a-a5f4-140d3301f61d', '9158a6ee-d7ce-524b-a7e9-dc24f3269f92', 'MANUFACTURA_EXPORTADORA_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Certificaciones internacionales', '{}'::jsonb, 'subindustries.json', 'manufactura-exportadora.ubits_fit_signals', true, 1),
    ('91791b63-9e36-58c6-9b2c-53cf25998d43', '9158a6ee-d7ce-524b-a7e9-dc24f3269f92', 'MANUFACTURA_EXPORTADORA_FIT_SIGNAL_03', 'fit_signal', 'model', 'normal', 'Personal numeroso con necesidad de estándares', '{}'::jsonb, 'subindustries.json', 'manufactura-exportadora.ubits_fit_signals', true, 2),
    ('c5042613-9a1d-5bb3-be13-e7732764645e', 'd6b54f2b-6de3-55de-b84d-fa894fe5e7a8', 'CONSULTORIA_ESTRATEGIA_GESTION_INCLUSION_01', 'inclusion', 'model', 'high', 'El servicio principal es consultoría de negocio, estrategia o transformación', '{}'::jsonb, 'subindustries.json', 'consultoria-estrategia-gestion.inclusion_criteria', true, 0),
    ('31ea3409-98d4-5b12-8906-b9c36509385b', 'd6b54f2b-6de3-55de-b84d-fa894fe5e7a8', 'CONSULTORIA_ESTRATEGIA_GESTION_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene equipos de consultores con escala empresarial', '{}'::jsonb, 'subindustries.json', 'consultoria-estrategia-gestion.inclusion_criteria', true, 1),
    ('78ef3cea-9d27-5b70-af01-d49ebb04249e', 'd6b54f2b-6de3-55de-b84d-fa894fe5e7a8', 'CONSULTORIA_ESTRATEGIA_GESTION_EXCLUSION_01', 'exclusion', 'model', 'high', 'Consultora de tecnología con desarrollo de software (→ Tecnología > software-factory)', '{}'::jsonb, 'subindustries.json', 'consultoria-estrategia-gestion.exclusion_criteria', true, 0),
    ('39987099-2a2f-50a5-b136-2fca33c01025', 'd6b54f2b-6de3-55de-b84d-fa894fe5e7a8', 'CONSULTORIA_ESTRATEGIA_GESTION_EXCLUSION_02', 'exclusion', 'model', 'high', 'Consultor individual sin firma', '{}'::jsonb, 'subindustries.json', 'consultoria-estrategia-gestion.exclusion_criteria', true, 1),
    ('a328f49b-e59c-529c-b98f-bdd5bb6ed400', 'd6b54f2b-6de3-55de-b84d-fa894fe5e7a8', 'CONSULTORIA_ESTRATEGIA_GESTION_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Consultores que necesitan desarrollo de habilidades de liderazgo y gestión', '{}'::jsonb, 'subindustries.json', 'consultoria-estrategia-gestion.ubits_fit_signals', true, 0),
    ('6d7c1812-7110-53df-a3c3-75eca779f883', 'd6b54f2b-6de3-55de-b84d-fa894fe5e7a8', 'CONSULTORIA_ESTRATEGIA_GESTION_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Entrenamiento en metodologías', '{}'::jsonb, 'subindustries.json', 'consultoria-estrategia-gestion.ubits_fit_signals', true, 1),
    ('8f2e3d36-571c-51b9-944a-b52d94bcc90c', 'abf86c42-cf23-532c-8343-5db4e225b57e', 'AUDITORIA_CONTABILIDAD_INCLUSION_01', 'inclusion', 'model', 'high', 'El servicio principal es auditoría, contabilidad o advisory financiero', '{}'::jsonb, 'subindustries.json', 'auditoria-contabilidad.inclusion_criteria', true, 0),
    ('edf17835-a2d2-5a34-9c99-5fbec432b6ed', 'abf86c42-cf23-532c-8343-5db4e225b57e', 'AUDITORIA_CONTABILIDAD_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene equipo de profesionales con escala empresarial', '{}'::jsonb, 'subindustries.json', 'auditoria-contabilidad.inclusion_criteria', true, 1),
    ('437e93d0-e2ff-5d25-b1ee-6d2cb41658d5', 'abf86c42-cf23-532c-8343-5db4e225b57e', 'AUDITORIA_CONTABILIDAD_EXCLUSION_01', 'exclusion', 'model', 'high', 'Contador público individual sin firma', '{}'::jsonb, 'subindustries.json', 'auditoria-contabilidad.exclusion_criteria', true, 0),
    ('e6c67d02-91a5-5bbf-b58f-38770ee8e386', 'abf86c42-cf23-532c-8343-5db4e225b57e', 'AUDITORIA_CONTABILIDAD_EXCLUSION_02', 'exclusion', 'model', 'high', 'Banco o entidad financiera con área de advisory (→ Servicios Financieros)', '{}'::jsonb, 'subindustries.json', 'auditoria-contabilidad.exclusion_criteria', true, 1),
    ('ba9a3143-2203-5849-8024-27ca1a3978f6', 'abf86c42-cf23-532c-8343-5db4e225b57e', 'AUDITORIA_CONTABILIDAD_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Formación en normativas contables, fiscales y NIIF', '{}'::jsonb, 'subindustries.json', 'auditoria-contabilidad.ubits_fit_signals', true, 0),
    ('8ceb0e92-f3c8-5b85-94e2-47708a34e7f7', 'abf86c42-cf23-532c-8343-5db4e225b57e', 'AUDITORIA_CONTABILIDAD_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Upskilling en transformación digital del área financiera', '{}'::jsonb, 'subindustries.json', 'auditoria-contabilidad.ubits_fit_signals', true, 1),
    ('03a2f9c4-14b6-5d62-ab4d-bd2fc565f554', 'dd4c52eb-81ec-5de5-97f3-6ab745bbae7c', 'SERVICIOS_LEGALES_COMPLIANCE_INCLUSION_01', 'inclusion', 'model', 'high', 'El servicio principal es asesoría legal o compliance para empresas', '{}'::jsonb, 'subindustries.json', 'servicios-legales-compliance.inclusion_criteria', true, 0),
    ('24e2b213-f23f-5117-b466-aa507f4f9366', 'dd4c52eb-81ec-5de5-97f3-6ab745bbae7c', 'SERVICIOS_LEGALES_COMPLIANCE_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene equipo de abogados con escala y clientes corporativos', '{}'::jsonb, 'subindustries.json', 'servicios-legales-compliance.inclusion_criteria', true, 1),
    ('6dca0b76-26fa-5017-ac27-68f1f3d6437d', 'dd4c52eb-81ec-5de5-97f3-6ab745bbae7c', 'SERVICIOS_LEGALES_COMPLIANCE_EXCLUSION_01', 'exclusion', 'model', 'high', 'Abogado individual o bufete unipersonal', '{}'::jsonb, 'subindustries.json', 'servicios-legales-compliance.exclusion_criteria', true, 0),
    ('44816229-8837-52f9-9773-720f9b613364', 'dd4c52eb-81ec-5de5-97f3-6ab745bbae7c', 'SERVICIOS_LEGALES_COMPLIANCE_EXCLUSION_02', 'exclusion', 'model', 'high', 'Legaltech (→ Tecnología > legaltech)', '{}'::jsonb, 'subindustries.json', 'servicios-legales-compliance.exclusion_criteria', true, 1),
    ('879269e0-016a-5339-94c5-ecf2a4ca52e8', 'dd4c52eb-81ec-5de5-97f3-6ab745bbae7c', 'SERVICIOS_LEGALES_COMPLIANCE_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Abogados y asesores que necesitan formación en nuevas regulaciones', '{}'::jsonb, 'subindustries.json', 'servicios-legales-compliance.ubits_fit_signals', true, 0),
    ('8636bacd-48b2-5e49-8f6b-e97530ab1d88', 'dd4c52eb-81ec-5de5-97f3-6ab745bbae7c', 'SERVICIOS_LEGALES_COMPLIANCE_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Compliance y anticorrupción', '{}'::jsonb, 'subindustries.json', 'servicios-legales-compliance.ubits_fit_signals', true, 1),
    ('7c35b019-be74-5da2-b3cd-0c4646b7cba9', 'fe8187a9-9e99-5f85-bf36-a1de8c0ec0c4', 'FACILITIES_SEGURIDAD_PRIVADA_INCLUSION_01', 'inclusion', 'model', 'high', 'El servicio principal es gestión de instalaciones, limpieza o seguridad para empresas', '{}'::jsonb, 'subindustries.json', 'facilities-seguridad-privada.inclusion_criteria', true, 0),
    ('72f1ca99-e889-573b-9365-26fb1f72dd66', 'fe8187a9-9e99-5f85-bf36-a1de8c0ec0c4', 'FACILITIES_SEGURIDAD_PRIVADA_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene múltiples cuentas corporativas y personal numeroso', '{}'::jsonb, 'subindustries.json', 'facilities-seguridad-privada.inclusion_criteria', true, 1),
    ('b15c872d-f225-5825-923d-b3e7e01485ee', 'fe8187a9-9e99-5f85-bf36-a1de8c0ec0c4', 'FACILITIES_SEGURIDAD_PRIVADA_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa de limpieza residencial sin escala corporativa', '{}'::jsonb, 'subindustries.json', 'facilities-seguridad-privada.exclusion_criteria', true, 0),
    ('a27a4199-57f2-528b-8b47-98d82cd65571', 'fe8187a9-9e99-5f85-bf36-a1de8c0ec0c4', 'FACILITIES_SEGURIDAD_PRIVADA_EXCLUSION_02', 'exclusion', 'model', 'high', 'Empresa de vigilancia privada para uso residencial sin clientes corporativos', '{}'::jsonb, 'subindustries.json', 'facilities-seguridad-privada.exclusion_criteria', true, 1),
    ('ac287a49-46d3-539f-9a9f-63f21c2f5ad5', 'fe8187a9-9e99-5f85-bf36-a1de8c0ec0c4', 'FACILITIES_SEGURIDAD_PRIVADA_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Personal operativo numeroso con alta rotación', '{}'::jsonb, 'subindustries.json', 'facilities-seguridad-privada.ubits_fit_signals', true, 0),
    ('0d70b004-7f09-528c-8487-67480fc0291c', 'fe8187a9-9e99-5f85-bf36-a1de8c0ec0c4', 'FACILITIES_SEGURIDAD_PRIVADA_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Supervisores que necesitan formación', '{}'::jsonb, 'subindustries.json', 'facilities-seguridad-privada.ubits_fit_signals', true, 1),
    ('99e6b082-a694-5f7d-9136-a611d0cdbd48', 'fe8187a9-9e99-5f85-bf36-a1de8c0ec0c4', 'FACILITIES_SEGURIDAD_PRIVADA_FIT_SIGNAL_03', 'fit_signal', 'model', 'normal', 'Cumplimiento laboral y SST', '{}'::jsonb, 'subindustries.json', 'facilities-seguridad-privada.ubits_fit_signals', true, 2),
    ('4cc166d1-bde0-5a74-866b-524bbb160b9c', '6c83d574-3ca3-5579-bf8e-9c450c4f43c7', 'INVESTIGACION_MERCADOS_INTELIGENCIA_INCLUSION_01', 'inclusion', 'model', 'high', 'El producto principal son estudios de mercado, datos o inteligencia comercial', '{}'::jsonb, 'subindustries.json', 'investigacion-mercados-inteligencia.inclusion_criteria', true, 0),
    ('281ccb0e-d8e3-50e2-8178-82e8dbaaa224', '6c83d574-3ca3-5579-bf8e-9c450c4f43c7', 'INVESTIGACION_MERCADOS_INTELIGENCIA_INCLUSION_02', 'inclusion', 'model', 'high', 'Sus clientes son empresas que toman decisiones con base en sus datos', '{}'::jsonb, 'subindustries.json', 'investigacion-mercados-inteligencia.inclusion_criteria', true, 1),
    ('2b46d156-1e6b-5d00-b91c-0b217436b0ed', '6c83d574-3ca3-5579-bf8e-9c450c4f43c7', 'INVESTIGACION_MERCADOS_INTELIGENCIA_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa de data analytics con plataforma propia (→ Tecnología > data-analytics-bi)', '{}'::jsonb, 'subindustries.json', 'investigacion-mercados-inteligencia.exclusion_criteria', true, 0),
    ('9a49e525-c34e-5725-a494-9ebf47076c4e', '6c83d574-3ca3-5579-bf8e-9c450c4f43c7', 'INVESTIGACION_MERCADOS_INTELIGENCIA_EXCLUSION_02', 'exclusion', 'model', 'high', 'Consultora estratégica que hace investigación como parte de consultoría', '{}'::jsonb, 'subindustries.json', 'investigacion-mercados-inteligencia.exclusion_criteria', true, 1),
    ('4088f3c3-d287-5ea0-a199-61234b7ece2e', '6c83d574-3ca3-5579-bf8e-9c450c4f43c7', 'INVESTIGACION_MERCADOS_INTELIGENCIA_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Analistas e investigadores que necesitan formación en metodologías y herramientas', '{}'::jsonb, 'subindustries.json', 'investigacion-mercados-inteligencia.ubits_fit_signals', true, 0),
    ('2217d3ce-991a-5237-8e2f-8f72bcc6f305', 'c92627a7-95c6-542f-bb35-f88d401e53c4', 'CADENA_FRIO_FARMACEUTICA_INCLUSION_01', 'inclusion', 'model', 'high', 'Especializado en transporte o almacenamiento refrigerado o de productos regulados', '{}'::jsonb, 'subindustries.json', 'cadena-frio-farmaceutica.inclusion_criteria', true, 0),
    ('0140d5dc-2ed5-5435-bf73-34153c9390df', 'c92627a7-95c6-542f-bb35-f88d401e53c4', 'CADENA_FRIO_FARMACEUTICA_INCLUSION_02', 'inclusion', 'model', 'high', 'Cumple normativas específicas de cadena de frío o farmacéutica', '{}'::jsonb, 'subindustries.json', 'cadena-frio-farmaceutica.inclusion_criteria', true, 1),
    ('97ed2e97-dec9-5436-acc0-7aec2830f5df', 'c92627a7-95c6-542f-bb35-f88d401e53c4', 'CADENA_FRIO_FARMACEUTICA_EXCLUSION_01', 'exclusion', 'model', 'high', 'Operador general con algún servicio refrigerado sin especialización', '{}'::jsonb, 'subindustries.json', 'cadena-frio-farmaceutica.exclusion_criteria', true, 0),
    ('32e066a9-ebb8-5e04-9e42-53cf8feda665', 'c92627a7-95c6-542f-bb35-f88d401e53c4', 'CADENA_FRIO_FARMACEUTICA_EXCLUSION_02', 'exclusion', 'model', 'high', 'Distribuidora farmacéutica que gestiona su propia cadena de frío (→ Salud > distribuidores-farmaceuticos)', '{}'::jsonb, 'subindustries.json', 'cadena-frio-farmaceutica.exclusion_criteria', true, 1),
    ('815d5bbc-4814-5377-a67c-fce486594aaa', 'c92627a7-95c6-542f-bb35-f88d401e53c4', 'CADENA_FRIO_FARMACEUTICA_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Normativas BPD y calidad que requieren formación especializada', '{}'::jsonb, 'subindustries.json', 'cadena-frio-farmaceutica.ubits_fit_signals', true, 0),
    ('9dd153c5-d584-5ba4-89df-530490edf142', 'ae3d1714-e36a-549c-986e-fc53ffa63d80', 'OPERADORES_PORTUARIOS_AEROPORTUARIOS_INCLUSION_01', 'inclusion', 'model', 'high', 'Opera servicios en puerto o aeropuerto para carga y comercio exterior', '{}'::jsonb, 'subindustries.json', 'operadores-portuarios-aeroportuarios.inclusion_criteria', true, 0),
    ('9d07a784-fea1-548d-a508-f3e947a3045f', 'ae3d1714-e36a-549c-986e-fc53ffa63d80', 'OPERADORES_PORTUARIOS_AEROPORTUARIOS_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene concesión, contrato de operación o instalación propia', '{}'::jsonb, 'subindustries.json', 'operadores-portuarios-aeroportuarios.inclusion_criteria', true, 1),
    ('3be6c36b-3ac3-526d-bdf6-acfd9f7d84b0', 'ae3d1714-e36a-549c-986e-fc53ffa63d80', 'OPERADORES_PORTUARIOS_AEROPORTUARIOS_EXCLUSION_01', 'exclusion', 'model', 'high', 'Freight forwarder sin operación portuaria propia (→ freight-forwarders-aduana)', '{}'::jsonb, 'subindustries.json', 'operadores-portuarios-aeroportuarios.exclusion_criteria', true, 0)
;

INSERT INTO public.subindustry_rules (
    id, subindustry_id, rule_key, rule_type, execution_layer, priority,
    rule_text, configuration, source_document, source_section, active, sort_order
) VALUES
    ('da9e3bda-2517-5cd1-89ca-ef6de973816e', 'ae3d1714-e36a-549c-986e-fc53ffa63d80', 'OPERADORES_PORTUARIOS_AEROPORTUARIOS_EXCLUSION_02', 'exclusion', 'model', 'high', 'Puerto o aeropuerto operado directamente por el Estado sin empresa privada', '{}'::jsonb, 'subindustries.json', 'operadores-portuarios-aeroportuarios.exclusion_criteria', true, 1),
    ('8ccd7ad2-1283-56b8-8eeb-73c11abbfb4f', 'ae3d1714-e36a-549c-986e-fc53ffa63d80', 'OPERADORES_PORTUARIOS_AEROPORTUARIOS_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Personal operativo de manejo de carga', '{}'::jsonb, 'subindustries.json', 'operadores-portuarios-aeroportuarios.ubits_fit_signals', true, 0),
    ('c2d25211-65e1-521f-9221-6da8bdfacf68', 'ae3d1714-e36a-549c-986e-fc53ffa63d80', 'OPERADORES_PORTUARIOS_AEROPORTUARIOS_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Normas de seguridad portuaria/aeroportuaria', '{}'::jsonb, 'subindustries.json', 'operadores-portuarios-aeroportuarios.ubits_fit_signals', true, 1),
    ('2957f109-30a2-54a2-b2f3-d905910880f9', 'e729fcea-2082-55b8-a945-8ed65adac821', 'LOGISTICA_MINERIA_ENERGIA_INCLUSION_01', 'inclusion', 'model', 'high', 'Especializado en logística para operaciones mineras, petroleras o energéticas', '{}'::jsonb, 'subindustries.json', 'logistica-mineria-energia.inclusion_criteria', true, 0),
    ('c3ce2f55-17bf-52d5-8378-e83f0f419065', 'e729fcea-2082-55b8-a945-8ed65adac821', 'LOGISTICA_MINERIA_ENERGIA_INCLUSION_02', 'inclusion', 'model', 'high', 'Opera en zonas remotas o con materiales peligrosos bajo regulaciones especiales', '{}'::jsonb, 'subindustries.json', 'logistica-mineria-energia.inclusion_criteria', true, 1),
    ('d2b0ced6-8efb-5082-9ff9-1b72db1005b6', 'e729fcea-2082-55b8-a945-8ed65adac821', 'LOGISTICA_MINERIA_ENERGIA_EXCLUSION_01', 'exclusion', 'model', 'high', 'Empresa minera o petrolera que gestiona su propia logística (→ Manufactura > energia-mineria-servicios)', '{}'::jsonb, 'subindustries.json', 'logistica-mineria-energia.exclusion_criteria', true, 0),
    ('0a7886df-3d33-520e-a8f0-39086b3c20ce', 'e729fcea-2082-55b8-a945-8ed65adac821', 'LOGISTICA_MINERIA_ENERGIA_EXCLUSION_02', 'exclusion', 'model', 'high', 'Operador logístico general sin especialización en estos sectores', '{}'::jsonb, 'subindustries.json', 'logistica-mineria-energia.exclusion_criteria', true, 1),
    ('a1957ad7-8723-56bc-9f3d-5afaac1076f8', 'e729fcea-2082-55b8-a945-8ed65adac821', 'LOGISTICA_MINERIA_ENERGIA_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'HSE y manejo de materiales peligrosos', '{}'::jsonb, 'subindustries.json', 'logistica-mineria-energia.ubits_fit_signals', true, 0),
    ('4727de16-b1fe-5481-b3ee-b5d74fe29b36', 'e729fcea-2082-55b8-a945-8ed65adac821', 'LOGISTICA_MINERIA_ENERGIA_FIT_SIGNAL_02', 'fit_signal', 'model', 'normal', 'Personal en campo con necesidad de formación especializada', '{}'::jsonb, 'subindustries.json', 'logistica-mineria-energia.ubits_fit_signals', true, 1),
    ('98c24c03-d0c3-5257-989a-42720e76d313', '7564d31e-3d32-5c3e-b795-81093419f83a', 'COURIER_MENSAJERIA_EMPRESARIAL_INCLUSION_01', 'inclusion', 'model', 'high', 'El servicio principal es courier, mensajería o entrega urgente para clientes corporativos', '{}'::jsonb, 'subindustries.json', 'courier-mensajeria-empresarial.inclusion_criteria', true, 0),
    ('86af2b57-07fb-5d72-91c5-ebb004e53627', '7564d31e-3d32-5c3e-b795-81093419f83a', 'COURIER_MENSAJERIA_EMPRESARIAL_INCLUSION_02', 'inclusion', 'model', 'high', 'Tiene red de distribución y escala empresarial', '{}'::jsonb, 'subindustries.json', 'courier-mensajeria-empresarial.inclusion_criteria', true, 1),
    ('e04f06fd-34e2-5b9b-98c1-2ac0aaf8734e', '7564d31e-3d32-5c3e-b795-81093419f83a', 'COURIER_MENSAJERIA_EMPRESARIAL_EXCLUSION_01', 'exclusion', 'model', 'high', 'Servicio de delivery de comida B2C sin componente empresarial', '{}'::jsonb, 'subindustries.json', 'courier-mensajeria-empresarial.exclusion_criteria', true, 0),
    ('937c95d1-5259-5144-9799-63678a110a4d', '7564d31e-3d32-5c3e-b795-81093419f83a', 'COURIER_MENSAJERIA_EMPRESARIAL_EXCLUSION_02', 'exclusion', 'model', 'high', 'Servicio de mensajería de un solo mensajero sin estructura', '{}'::jsonb, 'subindustries.json', 'courier-mensajeria-empresarial.exclusion_criteria', true, 1),
    ('176a2630-2a66-564b-9fc8-dd9a9923242c', '7564d31e-3d32-5c3e-b795-81093419f83a', 'COURIER_MENSAJERIA_EMPRESARIAL_FIT_SIGNAL_01', 'fit_signal', 'model', 'normal', 'Repartidores y operativos que necesitan formación en servicio al cliente y seguridad vial', '{}'::jsonb, 'subindustries.json', 'courier-mensajeria-empresarial.ubits_fit_signals', true, 0)
;

-- ============================================================
-- ASSERTIONS: validate before publish
-- ============================================================
do $$
declare
    v_version_id          uuid;
    v_industry_count      integer;
    v_sub_count           integer;
    v_tech_count          integer;
    v_alias_count         integer;
    v_term_count          integer;
    v_irule_count         integer;
    v_srule_count         integer;
    v_null_geo_count      integer;
    v_restricted_geo_count integer;
begin

    -- Obtain catalog_version_id
    v_version_id := 'e4675daf-65a2-5e26-8640-58f1aeaee5ed';

    -- 1. Exactly one draft version
    select count(*) into v_industry_count
    from public.industry_catalog_versions
    where id = v_version_id and status = 'draft';
    if v_industry_count <> 1 then
        raise exception 'ASSERTION FAILED: expected 1 draft version, found %', v_industry_count;
    end if;

    -- 2. Exactly 8 industries
    select count(*) into v_industry_count
    from public.industries where catalog_version_id = v_version_id;
    if v_industry_count <> 8 then
        raise exception 'ASSERTION FAILED: expected 8 industries, found %', v_industry_count;
    end if;

    -- 3. Exactly 73 subindustries
    select count(*) into v_sub_count
    from public.subindustries where catalog_version_id = v_version_id;
    if v_sub_count <> 73 then
        raise exception 'ASSERTION FAILED: expected 73 subindustries, found %', v_sub_count;
    end if;

    -- 4. Exactly 20 subindustries for Tecnología
    select count(*) into v_tech_count
    from public.subindustries s
    join public.industries i on i.id = s.industry_id
    where s.catalog_version_id = v_version_id and i.slug = 'tecnologia';
    if v_tech_count <> 20 then
        raise exception 'ASSERTION FAILED: expected 20 Tecnología subindustries, found %', v_tech_count;
    end if;

    -- 5. Exactly 127 aliases
    select count(*) into v_alias_count
    from public.subindustry_aliases a
    join public.subindustries s on s.id = a.subindustry_id
    where s.catalog_version_id = v_version_id;
    if v_alias_count <> 127 then
        raise exception 'ASSERTION FAILED: expected 127 aliases, found %', v_alias_count;
    end if;

    -- 6. Exactly 228 search terms
    select count(*) into v_term_count
    from public.subindustry_search_terms t
    join public.subindustries s on s.id = t.subindustry_id
    where s.catalog_version_id = v_version_id;
    if v_term_count <> 228 then
        raise exception 'ASSERTION FAILED: expected 228 search terms, found %', v_term_count;
    end if;

    -- 7. Exactly 42 industry rules
    select count(*) into v_irule_count
    from public.industry_rules where catalog_version_id = v_version_id;
    if v_irule_count <> 42 then
        raise exception 'ASSERTION FAILED: expected 42 industry rules, found %', v_irule_count;
    end if;

    -- 8. Exactly 364 subindustry rules
    select count(*) into v_srule_count
    from public.subindustry_rules r
    join public.subindustries s on s.id = r.subindustry_id
    where s.catalog_version_id = v_version_id;
    if v_srule_count <> 364 then
        raise exception 'ASSERTION FAILED: expected 364 subindustry rules, found %', v_srule_count;
    end if;

    -- 9. Exactly 69 subindustries with NULL applicable_countries
    select count(*) into v_null_geo_count
    from public.subindustries
    where catalog_version_id = v_version_id and applicable_countries is null;
    if v_null_geo_count <> 69 then
        raise exception 'ASSERTION FAILED: expected 69 subindustries with NULL geo, found %', v_null_geo_count;
    end if;

    -- 10. Exactly 4 subindustries with geographic restrictions
    select count(*) into v_restricted_geo_count
    from public.subindustries
    where catalog_version_id = v_version_id and applicable_countries is not null;
    if v_restricted_geo_count <> 4 then
        raise exception 'ASSERTION FAILED: expected 4 geo-restricted subindustries, found %', v_restricted_geo_count;
    end if;

    -- 11. Each active industry has at least one active subindustry
    if exists (
        select 1 from public.industries i
        where i.catalog_version_id = v_version_id and i.active = true
          and not exists (
              select 1 from public.subindustries s
              where s.industry_id = i.id and s.active = true
          )
    ) then
        raise exception 'ASSERTION FAILED: at least one active industry has no active subindustries';
    end if;

    -- 12. CRM boundary exclusion rule present in software-empresarial
    if not exists (
        select 1 from public.subindustry_rules r
        where r.subindustry_id = '3107711d-2a6c-557e-9fd2-4f49e16df9e2'
          and r.rule_type = 'exclusion'
          and lower(r.rule_text) like '%crm%'
    ) then
        raise exception 'ASSERTION FAILED: CRM exclusion rule missing from software-empresarial';
    end if;

    -- 13. CRM boundary exclusion rule present in martech-salestech
    if not exists (
        select 1 from public.subindustry_rules r
        where r.subindustry_id = '1a00c933-fc42-5767-bc47-dd0f9be5c9fd'
          and r.rule_type = 'exclusion'
          and lower(r.rule_text) like '%erp%'
    ) then
        raise exception 'ASSERTION FAILED: ERP exclusion rule missing from martech-salestech';
    end if;

    -- 14. Govtech exclusion rule for government entities present
    if not exists (
        select 1 from public.subindustry_rules r
        where r.subindustry_id = '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828'
          and r.rule_type = 'exclusion'
          and (lower(r.rule_text) like '%gubernamental%' or lower(r.rule_text) like '%gobierno%' or lower(r.rule_text) like '%ministerio%')
    ) then
        raise exception 'ASSERTION FAILED: government exclusion rule missing from govtech';
    end if;

    -- 15. Brasil aliases for medicina-prepagada-eps present
    if not exists (
        select 1 from public.subindustry_aliases a
        where a.subindustry_id = '2bffda5f-45f2-5a36-84e5-5038562c6916'
          and a.country_code = 'BR'
    ) then
        raise exception 'ASSERTION FAILED: Brasil aliases for medicina-prepagada-eps missing';
    end if;

    -- 16. No duplicate UUIDs
    if exists (
        select id, count(*) from public.subindustries
        where catalog_version_id = v_version_id
        group by id having count(*) > 1
    ) then
        raise exception 'ASSERTION FAILED: duplicate UUIDs in subindustries';
    end if;

    -- 17. No empty applicable_countries arrays
    if exists (
        select 1 from public.subindustries
        where catalog_version_id = v_version_id
          and applicable_countries is not null
          and array_length(applicable_countries, 1) is null
    ) then
        raise exception 'ASSERTION FAILED: empty applicable_countries array found';
    end if;

    -- 18. All industry_rules have JSON object configuration
    if exists (
        select 1 from public.industry_rules
        where catalog_version_id = v_version_id
          and jsonb_typeof(configuration) <> 'object'
    ) then
        raise exception 'ASSERTION FAILED: non-object configuration in industry_rules';
    end if;

    raise notice 'All pre-publish assertions PASSED (18/18)';
end;
$$ language plpgsql;

-- ============================================================
-- PUBLISH: invoke function (draft → published)
-- ============================================================
select public.publish_industry_catalog_version('e4675daf-65a2-5e26-8640-58f1aeaee5ed');

-- ============================================================
-- ASSERTIONS: validate after publish
-- ============================================================
do $$
declare
    v_version_id   uuid;
    v_status       text;
    v_pub_at       timestamptz;
    v_pub_count    integer;
    v_catalog_rows integer;
    v_irules_rows  integer;
    v_alias_rows   integer;
    v_term_rows    integer;
    v_srule_rows   integer;
begin
    v_version_id := 'e4675daf-65a2-5e26-8640-58f1aeaee5ed';

    -- 1. Status is published
    select status, published_at into v_status, v_pub_at
    from public.industry_catalog_versions where id = v_version_id;
    if v_status <> 'published' then
        raise exception 'POST-PUBLISH FAILED: status is % instead of published', v_status;
    end if;
    if v_pub_at is null then
        raise exception 'POST-PUBLISH FAILED: published_at is NULL';
    end if;

    -- 2. Only one published version
    select count(*) into v_pub_count
    from public.industry_catalog_versions where status = 'published';
    if v_pub_count <> 1 then
        raise exception 'POST-PUBLISH FAILED: % published versions found (expected 1)', v_pub_count;
    end if;

    -- 3. active_industry_catalog has 73 rows (one per subindustry)
    select count(*) into v_catalog_rows from public.active_industry_catalog;
    if v_catalog_rows <> 73 then
        raise exception 'VIEW ASSERTION FAILED: active_industry_catalog has % rows (expected 73)', v_catalog_rows;
    end if;

    -- 4. active_industry_rules has 42 rows
    select count(*) into v_irules_rows from public.active_industry_rules;
    if v_irules_rows <> 42 then
        raise exception 'VIEW ASSERTION FAILED: active_industry_rules has % rows (expected 42)', v_irules_rows;
    end if;

    -- 5. active_subindustry_aliases has 127 rows
    select count(*) into v_alias_rows from public.active_subindustry_aliases;
    if v_alias_rows <> 127 then
        raise exception 'VIEW ASSERTION FAILED: active_subindustry_aliases has % rows (expected 127)', v_alias_rows;
    end if;

    -- 6. active_subindustry_search_terms has 228 rows
    select count(*) into v_term_rows from public.active_subindustry_search_terms;
    if v_term_rows <> 228 then
        raise exception 'VIEW ASSERTION FAILED: active_subindustry_search_terms has % rows (expected 228)', v_term_rows;
    end if;

    -- 7. active_subindustry_rules has 364 rows
    select count(*) into v_srule_rows from public.active_subindustry_rules;
    if v_srule_rows <> 364 then
        raise exception 'VIEW ASSERTION FAILED: active_subindustry_rules has % rows (expected 364)', v_srule_rows;
    end if;

    raise notice 'All post-publish assertions PASSED (7/7)';
    raise notice 'Catalog v1.0.0 published successfully.';
end;
$$ language plpgsql;

commit;

-- End of migration 060_seed_industry_catalog_v1.sql
