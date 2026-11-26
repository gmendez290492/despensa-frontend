# Contexto del Contrato Backend (`Despensa API`) y Mapeo con Google Stitch

Referencia canónica para desarrolladores y subagentes de `despensa-frontend`. El esquema OpenAPI 3.1 completo vive en `docs/openapi.json` y genera `src/lib/api/schema.d.ts` mediante `pnpm generate:api`.

---

## 1. Conexión, Seguridad BFF y Cabeceras

| Parámetro | Valor / Regla |
| :--- | :--- |
| **Backend URL (Local)** | `http://localhost:8000` (`BACKEND_API_URL`) |
| **Prefijo REST** | `/api/v1` |
| **Puente en Cliente** | `/api/bff/*` (Next.js Route Handlers con cookies `HttpOnly`) |
| **Header de Sesión hacia FastAPI** | `Authorization: Bearer <access_token>` |
| **Header de Trazabilidad** | `X-Correlation-ID: <uuid>` (enviado y devuelto en todas las respuestas y errores) |
| **Healthchecks** | `GET /health/live` (`200`), `GET /health/ready` (`200` o `503`) |

> **Importante sobre rotación de Refresh Tokens:** `POST /api/v1/auth/refresh` rota e invalida inmediatamente el `refresh_token` usado. Si dos peticiones concurrentes envían el mismo `refresh_token`, FastAPI detecta posible robo y revoca toda la familia de sesión. El BFF **debe serializar el refresco con un mutex**.

---

## 2. Catálogo de Endpoints REST (`/api/v1`)

### 2.1 Identidad y Autenticación (`users`)
- `POST /api/v1/auth/register` *(Pública, rate-limited)* → Body: `{ email, password (8-128), full_name (2-120), timezone="UTC", alert_days_before=3 (1-30) }` → `201 UserResponse`.
- `POST /api/v1/auth/login` *(Pública, rate-limited)* → Body: `{ email, password }` → `200 TokenResponse` (`access_token`, `refresh_token`, `token_type`, `expires_in`).
- `POST /api/v1/auth/refresh` *(Pública)* → Body: `{ refresh_token }` → `200 TokenResponse`.
- `POST /api/v1/auth/logout` *(Pública)* → Body: `{ refresh_token }` → `204 No Content`.
- `GET /api/v1/users/me` *(Bearer)* → `200 UserResponse` (`id`, `email`, `full_name`, `timezone`, `alert_days_before`, `created_at`).

### 2.2 Hogares, Ubicaciones, Catálogo y Lotes FEFO (`pantry`)
- `GET /api/v1/pantries` *(Bearer)* → `200 PantryResponse[]` (`id`, `name`, `invite_code`, `created_at`).
- `POST /api/v1/pantries` *(Bearer)* → Body: `{ name (2-100) }` → `201 PantryResponse` (crea ubicación inicial por defecto y asigna rol `owner`).
- `POST /api/v1/pantries/join` *(Bearer)* → Body: `{ invite_code (6-32) }` → `200 PantryResponse`.
- `GET /api/v1/pantries/{pantry_id}/locations` *(Bearer, protegido IDOR)* → `200 LocationResponse[]`.
- `POST /api/v1/pantries/{pantry_id}/locations` *(Bearer, protegido IDOR)* → Body: `{ name (2-64), description? }` → `201 LocationResponse`.
- `GET /api/v1/categories` *(Pública)* → `200 CategoryResponse[]` (`id`, `name`, `icon`).
- `GET /api/v1/products` *(Pública)* → Query opcional: `?category_id=<uuid>&q=<texto|barcode>` → `200 ProductResponse[]`.
- `POST /api/v1/products` *(Bearer)* → Body: `{ category_id, name (2-120), barcode?, base_unit_code, estimated_shelf_life_days=7 }` → `201 ProductResponse`.
- `GET /api/v1/pantries/{pantry_id}/batches` *(Bearer, protegido IDOR)* → `200 FoodBatchResponse[]` ordenados por **FEFO** (`dias_para_vencer`, `semaforo`: `"ÓPTIMO" | "PRECAUCIÓN" | "CRÍTICO" | "VENCIDO"`, cantidades como `string` decimal).
- `POST /api/v1/pantries/{pantry_id}/batches` *(Bearer, protegido IDOR)* → Body: `{ location_id, product_id, unit_code, quantity (>0), expiration_date (YYYY-MM-DD), purchase_date?, unit_cost? }` → `201 FoodBatchResponse`.
- `POST /api/v1/pantries/{pantry_id}/consume` *(Bearer, protegido IDOR)* → Body: `{ product_id, quantity (>0), notes? }` → `200 ConsumeResultResponse` (`requested_quantity`, `consumed_quantity`, `remaining_stock`, `batches_affected[]`).

### 2.3 Semillas Canónicas en Base de Datos
- **Unidades válidas (`unit_code`):** `g`, `kg`, `ml`, `l`, `pza`.
- **Categorías iniciales (`icon`):** `Lácteos y Huevos` (`dairy`), `Proteínas y Carnes` (`meat`), `Frutas y Verduras` (`produce`), `Granos y Cereales` (`grain`), `Despensa Seca` (`pantry`), `Bebidas` (`beverage`), `Condimentos y Salsas` (`spice`).

### 2.4 Notificaciones (`notifications`)
- `GET /api/v1/notifications` *(Bearer)* → Query: `?unread_only=false&limit=50&offset=0` → `200 NotificationListResponse` (`items[]`, `total`, `unread_count`). Tipos: `EXPIRATION_CRITICAL`, `EXPIRATION_ALERT`, `EXPIRATION_SPOILED`.
- `PATCH /api/v1/notifications/{notification_id}/read` *(Bearer)* → `200 { marked_count, success }`.
- `PATCH /api/v1/notifications/read-all` *(Bearer)* → `200 { marked_count, success }`.
- `POST /api/v1/notifications/scan` *(Bearer)* → `200 { scanned_pantries, evaluated_batches, alerts_generated, emails_sent }`.

### 2.5 Recetas y Scoring Anti-Desperdicio (`recipes`)
- `GET /api/v1/recipes` *(Pública)* → Query: `?limit=50&offset=0` → `200 RecipeListResponse`.
- `GET /api/v1/recipes/recommended` *(Bearer)* → Query: `?limit=10` → `200 RecommendationResponse` (`match_percentage`, `urgency_score`, `expiring_ingredients[]`, `missing_ingredients[]`, `can_cook_now`).
- `GET /api/v1/recipes/{recipe_id}` *(Pública)* → `200 RecipeRead`.

---

## 3. Catálogo de Errores RFC 7807 (`application/problem+json`)

Estructura estándar devuelta por FastAPI en errores de dominio:
```json
{
  "type": "https://despensa.api/errors/<error_type>",
  "title": "Title",
  "status": 400,
  "detail": "Descripción legible",
  "instance": "/api/v1/...",
  "correlation_id": "uuid"
}
```

| `error_type` | HTTP | Significado |
| :--- | :---: | :--- |
| `invalid-credentials` | `401` | Email o contraseña incorrectos |
| `invalid-token` | `401` | Token expirado, inválido o revocado |
| `email-already-exists` | `409` | Correo ya registrado |
| `rate-limit-exceeded` | `429` | Demasiados intentos en `/auth/*` |
| `pantry-access-denied` | `403` | Usuario no pertenece a la despensa (escudo IDOR) |
| `pantry-not-found` / `location-not-found` / `product-not-found` | `404` | Recurso inexistente |
| `invalid-invite-code` | `404` | Código de invitación inválido |
| `already-pantry-member` | `409` | El usuario ya es miembro de esa despensa |
| `unit-not-found` | `400` | `unit_code` fuera del catálogo (`g, kg, ml, l, pza`) |
| `insufficient-stock` | `400` | Stock insuficiente al consumir (clave en conflictos offline) |
| `notification-not-found` / `recipe-not-found` | `404` | ID no encontrado |

---

## 4. Mapeo con Google Stitch (`Project ID: 1951021510829166998`)

| Pantalla en Stitch | Screen ID | Endpoints Asociados |
| :--- | :--- | :--- |
| **Home Dashboard** | `7888102e6f53468e9258286b534611ae` | `GET /users/me`, `GET /pantries`, `GET /pantries/{id}/batches`, `GET /notifications?unread_only=true`, `GET /recipes/recommended?limit=3` |
| **Pantry Inventory** | `bcc49240c9a6408e8d2a1583fe082fd0` | `GET /pantries/{id}/locations`, `GET /pantries/{id}/batches`, `POST /pantries/{id}/consume` |
| **Flujo 1: Hub Entrada Agregar Producto** | `f8feeea9718f470eac8844b59e70792f` | Hub hacia Escáner, Código Manual o Producto Fresco |
| **Barcode & Shelf Scanner** | `750771d22b144ef68a46083fc9dd6a22` | `GET /products?q=<barcode>` |
| **Escaneo Continuo por Lote** | `0a9db6d0f6244850a673b7be975cb235` | `GET /products?q=<barcode>` + cola `continuousScanQueue` en Zustand |
| **Ingreso Manual de Código** | `a18187a171e144a1884889089b156e40` | `GET /products?q=<barcode>` |
| **Barcode Item Confirmation** | `ac5c823f13294ee8b29d1b8b9bba6f6b` | Confirmación de `ProductResponse` |
| **Código Desconocido / Nuevo Producto** | `452d98a90d2645cd94681e1a7e759721` | `GET /categories`, `POST /products` |
| **Registro de Producto Fresco** | `eeb2144fbae948a2a2d0254c34508679` | `GET /categories`, `GET /products?category_id=...`, `POST /products` |
| **Flujo 2: Revisión y Clasificación de Lote** | `eb6562235c824a92bc354a33c98e4cc9` | `GET /pantries/{id}/locations`, `unit_code`, `quantity` |
| **Flujo 3: Configuración de Caducidad y Alertas** | `8e7ddf95224042a793be39386f63bf17` | Cálculo sugerido con `estimated_shelf_life_days` → `expiration_date` |
| **Flujo 4: Resumen y Confirmación Consolidada** | `a09f07265e774b8d9386397806359952` | `POST /pantries/{id}/batches` (o encolado en `offlineDb.outboxQueue`) |
| **Producto Guardado con Éxito** | `76c02babcfd4458588d46cf8c992275f` | Renderiza `FoodBatchResponse` (`semaforo`, `dias_para_vencer`) |
