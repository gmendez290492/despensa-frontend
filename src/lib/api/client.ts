import createClient from "openapi-fetch";
import type { paths } from "@/lib/api/schema";

const defaultBaseUrl =
  typeof window === "undefined"
    ? (process.env.BACKEND_API_URL ?? "http://localhost:8000")
    : "/api/bff";

/**
 * Cliente `openapi-fetch` tipado con `paths` de `schema.d.ts`. En el navegador
 * apunta a `/api/bff`; en el servidor, a `BACKEND_API_URL`.
 *
 * @param baseUrl - URL base; por defecto según el entorno.
 * @returns Cliente con métodos `GET`/`POST`/… tipados por ruta.
 */
export function createApiClient(baseUrl: string = defaultBaseUrl) {
  return createClient<paths>({
    baseUrl,
    headers: {
      Accept: "application/json, application/problem+json",
    },
  });
}

/** Instancia por defecto de {@link createApiClient}. */
export const apiClient = createApiClient();
