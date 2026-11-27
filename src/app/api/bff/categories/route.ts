import type { NextRequest } from "next/server";
import { createBackendClient, unwrap } from "@/lib/api/server-client";
import { getCorrelationId, handleError, jsonResponse } from "@/lib/bff/http";

/** `GET /api/bff/categories` → `200 CategoryResponse[]` (catálogo público). */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const data = await unwrap(
      createBackendClient({ correlationId }).GET("/api/v1/categories"),
      correlationId,
    );
    return jsonResponse(data, correlationId);
  } catch (error) {
    return handleError(error, correlationId);
  }
}
