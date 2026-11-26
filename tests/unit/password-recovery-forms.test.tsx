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
const forgotMutate = vi.fn<(values: unknown, options?: MutateOptions) => void>();
const resetMutate = vi.fn<(values: unknown, options?: MutateOptions) => void>();

vi.mock("@/features/auth/client", () => ({
  useForgotPasswordMutation: () => ({ mutate: forgotMutate, isPending: false, isSuccess: false }),
  useResetPasswordMutation: () => ({ mutate: resetMutate, isPending: false, isSuccess: false }),
}));

const { ForgotPasswordForm } = await import("@/features/auth/components/forgot-password-form");
const { ResetPasswordForm } = await import("@/features/auth/components/reset-password-form");

const TOKEN = "t".repeat(43);

beforeEach(() => {
  forgotMutate.mockReset();
  resetMutate.mockReset();
  replace.mockReset();
  refresh.mockReset();
  searchParams = new URLSearchParams();
  useUiStore.setState({ connectionStatus: "online" });
  window.history.replaceState(null, "", "/");
});

describe("ForgotPasswordForm", () => {
  it("usa autofill de usuario y muestra el mensaje genérico tras el envío", async () => {
    render(<ForgotPasswordForm />);
    const email = screen.getByLabelText(/correo electrónico/i);
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(email).toBeRequired();

    fireEvent.change(email, { target: { value: " Ana@Example.com " } });
    fireEvent.click(screen.getByRole("button", { name: /enviar enlace/i }));

    await waitFor(() => expect(forgotMutate).toHaveBeenCalledTimes(1));
    expect(forgotMutate.mock.calls[0]![0]).toEqual({ email: "Ana@Example.com" });
    act(() => forgotMutate.mock.calls[0]![1]!.onSuccess!({ detail: "Si existe una cuenta..." }));
    expect(await screen.findByText(/si existe una cuenta/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /volver a iniciar sesión/i })).toHaveAttribute("href", "/login");
  });

  it("un 429 indica cuánto esperar", async () => {
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText(/correo electrónico/i), { target: { value: "ana@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar enlace/i }));
    await waitFor(() => expect(forgotMutate).toHaveBeenCalled());
    act(() =>
      forgotMutate.mock.calls[0]![1]!.onError!(
        new ProblemDetailError({
          type: problemTypeUri("rate-limit-exceeded"),
          title: "Too Many Requests",
          status: 429,
          retry_after: 120,
        }),
      ),
    );
    expect(await screen.findByText(/2 minutos/)).toBeInTheDocument();
  });
});

describe("ResetPasswordForm", () => {
  it("sin token muestra el aviso de enlace inválido y ofrece pedir otro", () => {
    render(<ResetPasswordForm />);
    expect(screen.getByText(/enlace no válido/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /solicitar un enlace nuevo/i })).toHaveAttribute(
      "href",
      "/recuperar-contrasena",
    );
  });

  it("quita el token de la URL, envía la nueva contraseña y va a /login?reset=1", async () => {
    searchParams = new URLSearchParams({ token: TOKEN });
    window.history.replaceState(null, "", `/reset-password?token=${TOKEN}`);
    render(<ResetPasswordForm />);
    expect(window.location.search).toBe("");

    const password = screen.getByLabelText(/contraseña nueva/i);
    expect(password).toHaveAttribute("autocomplete", "new-password");
    fireEvent.change(password, { target: { value: "otra-clave-segura" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar contraseña nueva/i }));

    await waitFor(() => expect(resetMutate).toHaveBeenCalledTimes(1));
    expect(resetMutate.mock.calls[0]![0]).toEqual({ token: TOKEN, new_password: "otra-clave-segura" });
    act(() => resetMutate.mock.calls[0]![1]!.onSuccess!(undefined));
    expect(replace).toHaveBeenCalledWith("/login?reset=1");
  });

  it("400 invalid-reset-token cambia a la vista de enlace inválido", async () => {
    searchParams = new URLSearchParams({ token: TOKEN });
    render(<ResetPasswordForm />);
    fireEvent.change(screen.getByLabelText(/contraseña nueva/i), { target: { value: "otra-clave-segura" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar contraseña nueva/i }));
    await waitFor(() => expect(resetMutate).toHaveBeenCalled());
    act(() =>
      resetMutate.mock.calls[0]![1]!.onError!(
        new ProblemDetailError({
          type: problemTypeUri("invalid-reset-token"),
          title: "Bad Request",
          status: 400,
        }),
      ),
    );
    expect(await screen.findByRole("link", { name: /solicitar un enlace nuevo/i })).toBeInTheDocument();
  });
});
