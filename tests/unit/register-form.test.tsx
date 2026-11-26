import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProblemDetailError, problemTypeUri } from "@/lib/api/problem";
import { useUiStore } from "@/stores/ui-store";

const replace = vi.fn();
const refresh = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => searchParams,
}));

type MutateOptions = {
  onSuccess?: (data: { authenticated: boolean }) => void;
  onError?: (error: unknown) => void;
};
const mutate = vi.fn<(values: unknown, options?: MutateOptions) => void>();

vi.mock("@/features/auth/client", () => ({
  useRegisterMutation: () => ({ mutate, isPending: false, isSuccess: false }),
}));

const { RegisterForm } = await import("@/features/auth/components/register-form");

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillValidForm(overrides: { confirm?: string } = {}) {
  fill(/nombre completo/i, "Ana García");
  fill(/correo electrónico/i, "ana@despensa-qa.com");
  fill(/^contraseña$/i, "PanDeMasaMadre$24");
  fill(/confirmar contraseña/i, overrides.confirm ?? "PanDeMasaMadre$24");
}

describe("RegisterForm", () => {
  beforeEach(() => {
    mutate.mockReset();
    replace.mockReset();
    refresh.mockReset();
    searchParams = new URLSearchParams();
    useUiStore.setState({ connectionStatus: "online" });
  });

  it("expone atributos de autofill de registro (Modern Web Guidance)", () => {
    render(<RegisterForm />);
    const name = screen.getByLabelText(/nombre completo/i);
    const email = screen.getByLabelText(/correo electrónico/i);
    const password = screen.getByLabelText(/^contraseña$/i);
    const confirm = screen.getByLabelText(/confirmar contraseña/i);

    expect(name).toHaveAttribute("autocomplete", "name");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(confirm).toHaveAttribute("autocomplete", "new-password");
    for (const field of [name, email, password, confirm]) {
      expect(field).toBeRequired();
      expect(field).toHaveAttribute("aria-invalid", "false");
    }
    expect(password).toHaveAttribute("minlength", "8");
  });

  it("rellena la zona horaria detectada en cliente", async () => {
    render(<RegisterForm />);
    expect(await screen.findByText("(detectada automáticamente)")).toBeInTheDocument();
  });

  it("marca error si las contraseñas no coinciden", async () => {
    render(<RegisterForm />);
    fillValidForm({ confirm: "OtraDistinta$99" });
    fireEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));

    expect(await screen.findByText("Las contraseñas no coinciden.")).toBeInTheDocument();
    expect(screen.getByLabelText(/confirmar contraseña/i)).toHaveAttribute("aria-invalid", "true");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("muestra error inline con link a /login si el correo ya existe (409)", async () => {
    searchParams = new URLSearchParams({ next: "/inventario" });
    mutate.mockImplementation((_values, options) => {
      options?.onError?.(
        new ProblemDetailError({
          type: problemTypeUri("email-already-exists"),
          title: "Email Already Exists",
          status: 409,
        }),
      );
    });

    render(<RegisterForm />);
    await screen.findByText("(detectada automáticamente)");
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));

    expect(await screen.findByText(/Este correo ya está registrado/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /quieres iniciar sesión/i })).toHaveAttribute(
      "href",
      "/login?next=%2Finventario",
    );
    expect(screen.getByLabelText(/correo electrónico/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const payload = mutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      full_name: "Ana García",
      email: "ana@despensa-qa.com",
      alert_days_before: 3,
    });
    expect(typeof payload.timezone).toBe("string");
    expect(payload.timezone).not.toBe("");
  });

  it("mapea errores 422 de FastAPI (loc body.email) al campo", async () => {
    mutate.mockImplementation((_values, options) => {
      options?.onError?.(
        new ProblemDetailError({
          type: problemTypeUri("validation-error"),
          title: "Validation Error",
          status: 422,
          errors: [{ loc: ["body", "full_name"], msg: "Nombre no permitido" }],
        }),
      );
    });

    render(<RegisterForm />);
    await screen.findByText("(detectada automáticamente)");
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));

    expect(await screen.findByText("Nombre no permitido")).toBeInTheDocument();
    expect(screen.getByLabelText(/nombre completo/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("si el auto-login falla, envía a /login con aviso de cuenta creada", async () => {
    mutate.mockImplementation((_values, options) => options?.onSuccess?.({ authenticated: false }));

    render(<RegisterForm />);
    await screen.findByText("(detectada automáticamente)");
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?registered=1"));
  });
});
