import { describe, expect, it } from "vitest";
import {
  ProblemDetailError,
  isProblemDetail,
  parseProblemResponse,
  problemSlug,
  toProblemDetailError,
} from "@/lib/api/problem";

describe("ProblemDetailError", () => {
  it("parsea un problem+json de FastAPI preservando todos los campos", async () => {
    const body = {
      type: "https://despensa.api/errors/email-already-exists",
      title: "Email Already Exists",
      status: 409,
      detail: "El correo ya está registrado.",
      instance: "/api/v1/auth/register",
      correlation_id: "corr-from-body",
    };
    const response = new Response(JSON.stringify(body), {
      status: 409,
      headers: {
        "Content-Type": "application/problem+json",
        "X-Correlation-ID": "corr-from-header",
      },
    });

    const error = await parseProblemResponse(response);
    expect(error).toBeInstanceOf(ProblemDetailError);
    expect(error).toBeInstanceOf(Error);
    expect(error.errorType).toBe("email-already-exists");
    expect(error.is("email-already-exists")).toBe(true);
    expect(error.status).toBe(409);
    expect(error.message).toBe("El correo ya está registrado.");
    expect(error.correlation_id).toBe("corr-from-body");
    expect(error.toJSON()).toEqual(body);
  });

  it("usa el X-Correlation-ID de la cabecera si el cuerpo no lo trae", async () => {
    const response = new Response(
      JSON.stringify({
        type: "https://despensa.api/errors/rate-limit-exceeded",
        title: "Too Many Requests",
        status: 429,
      }),
      { status: 429, headers: { "X-Correlation-ID": "corr-header" } },
    );
    const error = await parseProblemResponse(response);
    expect(error.errorType).toBe("rate-limit-exceeded");
    expect(error.correlation_id).toBe("corr-header");
  });

  it("normaliza el 422 HTTPValidationError de FastAPI", () => {
    const error = toProblemDetailError(
      {
        detail: [
          { type: "string_too_short", loc: ["body", "password"], msg: "Too short", input: "1" },
          { type: "missing", loc: ["body", "full_name"], msg: "Field required" },
        ],
      },
      422,
      "corr-1",
    );
    expect(error.errorType).toBe("validation-error");
    expect(error.status).toBe(422);
    expect(error.detail).toBe("Too short");
    expect(error.errors).toEqual([
      { loc: ["body", "password"], msg: "Too short", type: "string_too_short" },
      { loc: ["body", "full_name"], msg: "Field required", type: "missing" },
    ]);
    expect(error.correlation_id).toBe("corr-1");
  });

  it("tolera cuerpos vacíos, texto plano y { detail: string }", async () => {
    const empty = await parseProblemResponse(new Response(null, { status: 502 }));
    expect(empty.status).toBe(502);
    expect(empty.errorType).toBe("unknown-error");
    expect(empty.title).toBe("Bad Gateway");

    const text = await parseProblemResponse(new Response("Gateway down", { status: 503 }));
    expect(text.detail).toBe("Gateway down");

    const detail = toProblemDetailError({ detail: "Not Found" }, 404);
    expect(detail.detail).toBe("Not Found");
    expect(detail.status).toBe(404);
  });

  it("problemSlug e isProblemDetail", () => {
    expect(problemSlug("https://despensa.api/errors/invalid-credentials")).toBe(
      "invalid-credentials",
    );
    expect(problemSlug("invalid-token")).toBe("invalid-token");
    expect(isProblemDetail({ type: "x", title: "y", status: 400 })).toBe(true);
    expect(isProblemDetail({ detail: "x" })).toBe(false);
  });
});
