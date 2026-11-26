import createClient from "openapi-fetch";
import type { paths } from "@/lib/api/schema";

const defaultBaseUrl =
  typeof window === "undefined"
    ? (process.env.BACKEND_API_URL ?? "http://localhost:8000")
    : "/api/bff";

export function createApiClient(baseUrl: string = defaultBaseUrl) {
  return createClient<paths>({
    baseUrl,
    headers: {
      Accept: "application/json, application/problem+json",
    },
  });
}

export const apiClient = createApiClient();
