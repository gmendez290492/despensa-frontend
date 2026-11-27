import { z } from "zod";

/**
 * Esquemas Zod v4 del dominio `pantry`, compartidos por el BFF (validación
 * defensiva antes de llamar a FastAPI) y los formularios cliente (RHF).
 * Replican los límites de `docs/openapi.json` / Pydantic del backend.
 */

/** Unidades canónicas del catálogo (`docs/BACKEND_API_CONTEXT.md §2.3`). */
export const UNIT_CODES = ["g", "kg", "ml", "l", "pza"] as const;

/** Unión de {@link UNIT_CODES}. */
export type UnitCode = (typeof UNIT_CODES)[number];

// Numeric(10, 3) en PostgreSQL: hasta 7 enteros y 3 decimales.
const DECIMAL_PATTERN = /^\d{1,7}(\.\d{1,3})?$/;

/**
 * Cantidad decimal positiva como `string` (FastAPI usa `Decimal`; nunca se
 * envía un `number` para no perder precisión). Acepta coma decimal.
 */
export const quantitySchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim().replace(",", "."))
  .refine((value) => DECIMAL_PATTERN.test(value), {
    message: "Introduce una cantidad válida (máx. 3 decimales).",
  })
  .refine((value) => Number(value) > 0, { message: "La cantidad debe ser mayor que 0." })
  // Normaliza "001.50" → "1.5" para comparar e idempotencia estable.
  .transform((value) => {
    const [int = "0", frac = ""] = value.split(".");
    const cleanInt = int.replace(/^0+(?=\d)/, "");
    const cleanFrac = frac.replace(/0+$/, "");
    return cleanFrac ? `${cleanInt}.${cleanFrac}` : cleanInt;
  });

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label} debe tener al menos ${min} caracteres.`)
    .max(max, `${label} admite como máximo ${max} caracteres.`);

/** `POST /pantries` → `{ name (2-100) }`. */
export const createPantrySchema = z.object({ name: trimmed(2, 100, "El nombre") });

/** `POST /pantries/join` → `{ invite_code (6-32) }`. */
export const joinPantrySchema = z.object({
  invite_code: trimmed(6, 32, "El código")
    .regex(/^[A-Za-z0-9_-]+$/, "El código solo admite letras, números, guiones y guiones bajos."),
});

/** `POST /pantries/{id}/locations` → `{ name (2-64), description? (≤255) }`. */
export const createLocationSchema = z.object({
  name: trimmed(2, 64, "El nombre"),
  description: z.string().trim().max(255).nullish(),
});

const isoDate = z.iso.date({ message: "Usa el formato AAAA-MM-DD." });

/** `POST /pantries/{id}/batches`. */
export const createBatchSchema = z
  .object({
    location_id: z.guid(),
    product_id: z.guid(),
    unit_code: z.enum(UNIT_CODES),
    quantity: quantitySchema,
    expiration_date: isoDate,
    purchase_date: isoDate.optional(),
    unit_cost: z
      .union([z.string(), z.number()])
      // Numeric(10, 2): hasta 8 enteros y 2 decimales; acepta coma decimal.
      .transform((value) => String(value).trim().replace(",", "."))
      .refine((value) => /^\d{1,8}(\.\d{1,2})?$/.test(value), "Coste inválido.")
      .nullish(),
  })
  .refine(
    (value) => !value.purchase_date || value.expiration_date >= value.purchase_date,
    { message: "La caducidad no puede ser anterior a la compra.", path: ["expiration_date"] },
  );

/** `POST /pantries/{id}/consume` → `{ product_id, quantity (>0), notes? (≤255) }`. */
export const consumeSchema = z.object({
  product_id: z.guid(),
  quantity: quantitySchema,
  notes: z.string().trim().max(255).nullish(),
});

/** Entrada de {@link consumeSchema} (antes de normalizar). */
export type ConsumeInput = z.input<typeof consumeSchema>;
/** Payload normalizado de {@link consumeSchema} (cantidad como `string`). */
export type ConsumePayload = z.output<typeof consumeSchema>;
/** Payload de {@link createPantrySchema}. */
export type CreatePantryInput = z.output<typeof createPantrySchema>;
/** Payload de {@link joinPantrySchema}. */
export type JoinPantryInput = z.output<typeof joinPantrySchema>;
/** Payload de {@link createLocationSchema}. */
export type CreateLocationInput = z.output<typeof createLocationSchema>;
/** Payload de {@link createBatchSchema}. */
export type CreateBatchInput = z.output<typeof createBatchSchema>;

/**
 * Query de `GET /products` (`q` texto, `category_id`). Un `q` vacío se omite
 * para no pedir el catálogo entero con un filtro vacío.
 */
export const productSearchSchema = z.object({
  q: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => (value ? value : undefined)),
  category_id: z.guid().optional(),
});

/** `POST /products` → `{ category_id, name (2-120), barcode?, base_unit_code, estimated_shelf_life_days }`. */
export const createProductSchema = z.object({
  category_id: z.guid(),
  name: trimmed(2, 120, "El nombre"),
  barcode: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(
      z
        .string()
        .regex(/^[0-9A-Za-z-]{1,64}$/, "Código de barras inválido.")
        .nullable(),
    )
    .nullish(),
  base_unit_code: z.enum(UNIT_CODES),
  estimated_shelf_life_days: z.number().int().min(1).max(3650).default(7),
});

/** Payload de {@link createProductSchema}. */
export type CreateProductInput = z.output<typeof createProductSchema>;
