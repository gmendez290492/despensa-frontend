import { describe, expect, it } from "vitest";
import {
  loginSchema,
  registerRequestSchema,
  registerSchema,
  toRegisterPayload,
} from "@/lib/auth/schemas";

const validRegister = {
  full_name: "Ana López",
  email: "ana@example.com",
  password: "supersecreta",
  confirm_password: "supersecreta",
  timezone: "America/Mexico_City",
  alert_days_before: 5,
};

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
}

describe("loginSchema", () => {
  it("acepta credenciales válidas y normaliza espacios del email", () => {
    const result = loginSchema.parse({ email: "  ana@example.com ", password: "x" });
    expect(result.email).toBe("ana@example.com");
  });

  it("rechaza email inválido y contraseña vacía con mensajes en español", () => {
    const result = loginSchema.safeParse({ email: "no-es-email", password: "" });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message);
    expect(messages).toContain("Introduce un correo electrónico válido.");
    expect(messages).toContain("La contraseña es obligatoria.");
  });
});

describe("registerSchema", () => {
  it("acepta un registro válido", () => {
    expect(registerSchema.safeParse(validRegister).success).toBe(true);
  });

  it("marca confirm_password cuando las contraseñas no coinciden", () => {
    const result = registerSchema.safeParse({ ...validRegister, confirm_password: "otra-cosa" });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("confirm_password");
    expect(result.error!.issues[0]!.message).toBe("Las contraseñas no coinciden.");
  });

  it.each([
    ["full_name", { full_name: "A" }],
    ["full_name", { full_name: "A".repeat(121) }],
    ["password", { password: "1234567", confirm_password: "1234567" }],
    ["password", { password: "a".repeat(129), confirm_password: "a".repeat(129) }],
    ["alert_days_before", { alert_days_before: 0 }],
    ["alert_days_before", { alert_days_before: 31 }],
    ["alert_days_before", { alert_days_before: 2.5 }],
    ["timezone", { timezone: "Marte/Olympus" }],
  ])("rechaza %s fuera de rango (%o)", (field, override) => {
    const result = registerSchema.safeParse({ ...validRegister, ...override });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain(field);
  });

  it("acepta los límites del rango", () => {
    for (const days of [1, 30]) {
      expect(registerSchema.safeParse({ ...validRegister, alert_days_before: days }).success).toBe(
        true,
      );
    }
  });

  it("aplica defaults de timezone (UTC) y alert_days_before (3)", () => {
    const parsed = registerSchema.parse({
      full_name: "Ana",
      email: "ana@example.com",
      password: "supersecreta",
      confirm_password: "supersecreta",
    });
    expect(parsed.timezone).toBe("UTC");
    expect(parsed.alert_days_before).toBe(3);
  });
});

describe("registerRequestSchema / toRegisterPayload", () => {
  it("elimina confirm_password del payload hacia el BFF", () => {
    const payload = toRegisterPayload(registerSchema.parse(validRegister));
    expect(payload).not.toHaveProperty("confirm_password");
    expect(registerRequestSchema.parse(payload)).toEqual(payload);
  });
});
