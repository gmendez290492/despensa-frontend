import type { NextRequest } from "next/server";
import { PROBLEM_TYPES, ProblemDetailError, problemTypeUri } from "@/lib/api/problem";
import { unwrap } from "@/lib/api/server-client";
import { handleAuthenticated } from "@/lib/bff/authenticated-route";
import { getCorrelationId, handleError } from "@/lib/bff/http";
import { createProductSchema, productSearchSchema } from "@/lib/pantry/schemas";

/**
 * `GET /api/bff/products?q=&category_id=` → `200 ProductResponse[]`.
 * Solo se reenvían los parámetros conocidos y validados (allowlist): cualquier
 * otro parámetro del navegador se descarta.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  const search = request.nextUrl.searchParams;
  const parsed = productSearchSchema.safeParse({
    q: search.get("q") ?? undefined,
    category_id: search.get("category_id") ?? undefined,
  });
  if (!parsed.success) {
    return handleError(
      new ProblemDetailError({
        type: problemTypeUri(PROBLEM_TYPES.invalidRequest),
        title: "Bad Request",
        status: 400,
        detail: "Parámetros de búsqueda inválidos.",
        correlation_id: correlationId,
      }),
      correlationId,
    );
  }
  const query = parsed.data;
  return handleAuthenticated(request, (client, ctx) =>
    unwrap(client.GET("/api/v1/products", { params: { query } }), ctx.correlationId),
  );
}

/** `POST /api/bff/products` → `201 ProductResponse`. */
export async function POST(request: NextRequest) {
  return handleAuthenticated(
    request,
    (client, { correlationId, body }) =>
      unwrap(client.POST("/api/v1/products", { body }), correlationId),
    { mutation: true, body: createProductSchema, successStatus: 201 },
  );
}
