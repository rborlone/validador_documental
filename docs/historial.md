# Historial del proyecto

Registro de lo construido, las decisiones y lo aprendido con documentos reales. Las decisiones de arquitectura formales están en [adr/](adr/).

## 2026-10-24 · MVP

**Pedido:** playground en React para subir varios documentos; BFF en NestJS; core en Python con Tesseract e IA que valide tipo según template, vigencia, autenticidad y totales (facturas y órdenes de compra); procesamiento asíncrono con RabbitMQ; notificación al terminar; buenas prácticas para AKS.

**Decisiones:**
- **IA:** Claude (Anthropic API), solo como respaldo de las reglas (ADR-0005).
- **Tipos iniciales:** factura SII, orden de compra, certificado de vigencia, cédula y contrato.
- **Firma:** queda fuera del MVP (`NOT_IMPLEMENTED`).
- **Base de datos:** PostgreSQL con JSONB en vez de NoSQL (ADR-0001).
- **BFF:** a pedido del usuario, el BFF quedó **solo como puente** y se creó **documents-service** como dueño del documento (ADR-0003).
- **Mensajería:** outbox transaccional + RabbitMQ con colas quorum (ADR-0002); notificaciones por SSE con fanout por réplica (ADR-0004).
- **Despliegue:** charts de Helm por servicio, KEDA para el worker, Workload Identity y Key Vault.

**Construcción:**
- Contratos primero (`contracts/`). Luego tres agentes en paralelo (validador, servicios NestJS y front) y la integración con docker-compose.
- **Verificación de punta a punta:**
  - 7 documentos de ejemplo con el veredicto esperado.
  - Persistencia en la cola con el validador detenido.
  - Vista previa en iframe (ajuste de `frame-ancestors` en el BFF).

## 2026-10-24 · Primera orden de compra real (Oracle Analytics Publisher)

Clasificó bien, pero no extrajo 6 campos obligatorios, y el IVA se leyó como `19` (el "19 %"), aceptado con 95 % de confianza.

**Causas y correcciones (generales, sirven para todos los templates):**
1. El PDF posiciona palabras y líneas dentro de un mismo span **sin espacios** (`FECHA07-AGO-2026`). Ahora se corta cuando hay salto de línea base, un hueco o un retroceso.
2. **Valor en la línea siguiente** a la etiqueta: se creó la macro `<<SEP>>`.
3. **Montos `$58,816.00`** (coma de miles): `<<AMOUNT>>` y `parse_amount` los aceptan, y `<<AMOUNT>>` ya no toma porcentajes.
4. **Fechas `07-AGO-2026`.**

**Lección:** los templates por reglas son frágiles ante formatos nuevos. Cada formato real nuevo debe sumar un test con texto anonimizado. La IA de respaldo cubre lo que falte.

## 2026-10-24 · Certificados de accidentabilidad, carpeta tributaria y F30

El usuario subió certificados de Mutual de Seguridad, IST, ACHS e ISL y una carpeta tributaria del SII. Se agregaron los tipos `certificado_accidentabilidad`, `carpeta_tributaria` y `certificado_f30`, **solo identificación y extracción** (sin regla de vigencia, a pedido del usuario).

**Hallazgos:**
- **Archivos concatenados.** Los PDFs descargados (con nombre UUID) traían el mismo PDF concatenado 2 o 4 veces, y salían con riesgo alto por "actualizaciones incrementales". Se comprobó que los originales en el disco del usuario ya venían así: el problema está en el sistema de origen. El validador ahora lo detecta (`pdf.repeated_copies`, peso 0).
- **Escaneos con texto encima.** Un certificado ACHS escaneado con nombre, RUT y horas hombre escritos encima no pasaba por OCR. Ahora una página casi toda imagen pasa por OCR, y las cifras escritas encima generan la señal `pdf.text_over_scan`.
- **RUT del ISL leído por OCR sin guion** (`Ru 765227224`): se agregó un patrón tolerante (el dígito verificador sigue validándose).
- **F30 / F30-1:** sin un ejemplo real; los patrones están pendientes de ajustar.

## 2026-10-24 · Uso de IA visible

- **Pregunta del usuario:** ¿todo pasa por la IA?
- **Respuesta:** no. Claude se llama solo para clasificar con baja confianza, completar campos obligatorios o dar una opinión visual cuando ya hay una señal de riesgo.
- **Cambios:**
  - Cada llamada queda en `result.llmCalls` (contrato ampliado) y en la sección "Uso de IA" del detalle.
  - Corregido un bug: la señal informativa de peso 0 disparaba llamadas de revisión visual innecesarias.
- **Probado con la API real.**

## 2026-10-25 · Motor standalone y validación sin base de datos

- Se creó `deploy/standalone/doc-validator/` (solo RabbitMQ + Azurite + doc-validator, con el cliente de ejemplo `enviar.py`). Probado: factura válida → VALID, total alterado → INVALID, en menos de 1 s.
- **Pregunta del usuario:** ¿cómo validar sin base de datos y sin guardar el archivo? Propuesta: `POST /validate` síncrono en el validador (todo en memoria) para documentos livianos, y la vía asíncrona por cola para los grandes.
- **Preocupación del usuario:** que un archivo grande deje el validador pegado.
  - **Hoy hay:** límite de 20 MB, de 20 páginas, timeout de 300 s en el consumidor y de 60 s (+2 reintentos) para Claude.
  - **Falta:** timeout de Tesseract por página; límite de píxeles por página (una página enorme a 300 dpi puede agotar la memoria). Además, el timeout de 300 s no detiene el hilo de OCR, que sigue corriendo.
  - **Mediciones:** escaneo real de 2 páginas = 2,7 s (1,4 s por página en un Mac). 20 páginas densas ≈ 30 s sin IA, y de 2 a 4 veces más en un pod con medio CPU.
- **Propuesta (sin implementar, el usuario pausó aquí):**
  1. Rechazo en la puerta por tamaño (Ingress/APIM y endpoint) → `413`.
  2. Revisión previa de páginas y píxeles por página (bajar DPI o rechazar) → `422`.
  3. Presupuesto de tiempo por documento, con timeout de Tesseract por página → `504`.
  4. Pipeline en un **proceso aparte** que se pueda matar al vencer el plazo.
  5. Cupo de documentos simultáneos por pod → `429`/`503` con `Retry-After`.
  - El modo síncrono aceptaría solo documentos livianos (propuesta: hasta 5 MB y 5 páginas, sin confirmar); el resto, por cola.
  - Las capas 2, 3 y 4 también protegen el modo cola actual.

## Pendientes y propuestas

| Tema | Estado |
|---|---|
| Guardar el texto completo de cada documento en Markdown (en Blob) y una tabla `document_fields` para consultas | Propuesto, sin decidir |
| Pedirle a Claude los campos opcionales faltantes cuando el documento viene de OCR (p. ej. las tasas en certificados escaneados) | Propuesto, sin decidir |
| Catálogo de tipos publicado por el validador (hoy la lista está repetida en 5 servicios) | Brecha conocida |
| Exponer documents-service a otros sistemas: API Management + Entra ID + webhooks + tenant | Brecha conocida |
| Validación de firma (PAdES y firma visual) | Funcionalidad futura |
| Ajustar el F30 con documentos reales | Pendiente de ejemplos |
| Probar los charts en un AKS real; CI/CD en Azure DevOps | Pendiente |
| Límites contra archivos que traban el validador (capas 2–4) y `POST /validate` síncrono (capas 1 y 5) | Propuesto, sin implementar |
| El repositorio no tiene commits; el usuario creará un repositorio nuevo en GitHub | Pendiente |
