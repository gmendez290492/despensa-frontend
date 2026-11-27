import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  onSuccess?: (data: unknown) => void;
  onError?: (error: unknown) => void;
};
const mutate = vi.fn<(values: unknown, options?: MutateOptions) => void>();

vi.mock("@/features/auth/client", () => ({
  useLoginMutation: () => ({ mutate, isPending: false, isSuccess: false }),
}));

const { LoginForm } = await import("@/features/auth/components/login-form");

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText(/correo electrónico/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^contraseña$/i), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /iniciar sesión/i }));
}

describe("LoginForm", () => {
  beforeEach(() => {
    mutate.mockReset();
    replace.mockReset();
    refresh.mockReset();
    searchParams = new URLSearchParams();
    useUiStore.setState({ connectionStatus: "online" });
  });

  it("expone atributos de autofill y validación nativa (Modern Web Guidance)", () => {
    render(<LoginForm />);
    const email = screen.getByLabelText(/correo electrónico/i);
    const password = screen.getByLabelText(/^contraseña$/i);

    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(email).toHaveAttribute("enterkeyhint", "next");
    expect(email).toBeRequired();
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).toHaveAttribute("enterkeyhint", "done");
    expect(password).toBeRequired();
    // `false` explícito antes de interactuar (no ausente).
    expect(email).toHaveAttribute("aria-invalid", "false");
    expect(password).toHaveAttribute("aria-invalid", "false");
    expect(email).not.toHaveAttribute("aria-describedby");
  });

  it("valida campos vacíos sin llamar a la API", async () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: /iniciar sesión/i }));

    expect(await screen.findByText("El correo electrónico es obligatorio.")).toBeInTheDocument();
    expect(screen.getByText("La contraseña es obligatoria.")).toBeInTheDocument();
    expect(screen.getByLabelText(/correo electrónico/i)).toHaveAttribute("aria-invalid", "true");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("muestra el banner de credenciales inválidas (401 invalid-credentials)", async () => {
    mutate.mockImplementation((_values, options) => {
      options?.onError?.(
        new ProblemDetailError({
          type: problemTypeUri("invalid-credentials"),
          title: "Invalid Credentials",
          status: 401,
          correlation_id: "corr-1",
        }),
      );
    });

    render(<LoginForm />);
    fillAndSubmit("ana@despensa-qa.com", "incorrecta");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Correo o contraseña incorrectos/);
    expect(mutate).toHaveBeenCalledWith(
      { email: "ana@despensa-qa.com", password: "incorrecta" },
      expect.any(Object),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("muestra el ID de correlación en errores inesperados", async () => {
    mutate.mockImplementation((_values, options) => {
      options?.onError?.(
        new ProblemDetailError({
          type: problemTypeUri("unknown-error"),
          title: "Internal Server Error",
          status: 500,
          correlation_id: "corr-xyz",
        }),
      );
    });

    render(<LoginForm />);
    fillAndSubmit("ana@despensa-qa.com", "secreta123");

    expect(await screen.findByText(/corr-xyz/)).toBeInTheDocument();
  });

  it("redirige a `next` saneado tras iniciar sesión", async () => {
    searchParams = new URLSearchParams({ next: "/inventario?semaforo=critico" });
    mutate.mockImplementation((_values, options) => options?.onSuccess?.({}));

    render(<LoginForm />);
    fillAndSubmit("ana@despensa-qa.com", "secreta123");

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/inventario?semaforo=critico"));
    expect(refresh).toHaveBeenCalled();
  });

  it("sin conexión marca el envío aria-disabled (enfocable, con pista) y no envía", async () => {
    render(<LoginForm />);
    act(() => useUiStore.setState({ connectionStatus: "offline" }));

    const submit = screen.getByRole("button", { name: /iniciar sesión/i });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).toBeEnabled();
    expect(submit).toHaveAccessibleDescription("Necesitas conexión para iniciar sesión.");
    submit.focus();
    expect(submit).toHaveFocus();

    fillAndSubmit("ana@despensa-qa.com", "secreta123");
    // Ni valida ni envía: sin errores de campo y sin mutación.
    await waitFor(() => expect(mutate).not.toHaveBeenCalled());
    expect(screen.getByLabelText(/correo electrónico/i)).toHaveAttribute("aria-invalid", "false");

    act(() => useUiStore.setState({ connectionStatus: "online" }));
    expect(submit).not.toHaveAttribute("aria-disabled");
    expect(submit).not.toHaveAccessibleDescription();
    fireEvent.click(submit);
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  });

  it("sin conexión tampoco valida: enviar vacío no muestra errores", async () => {
    render(<LoginForm />);
    act(() => useUiStore.setState({ connectionStatus: "offline" }));
    fireEvent.submit(screen.getByRole("form", { name: "Iniciar sesión" }));
    await waitFor(() => expect(mutate).not.toHaveBeenCalled());
    expect(screen.getByLabelText(/correo electrónico/i)).toHaveAttribute("aria-invalid", "false");
  });
});
