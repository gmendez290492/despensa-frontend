import type { FormEvent } from "react";

/**
 * Envuelve el `onSubmit` de un formulario de auth para que no haga nada
 * mientras no hay conexión.
 *
 * @remarks
 * El botón de envío usa `aria-disabled="true"` sin conexión en lugar de
 * `disabled`. Así sigue recibiendo foco y el lector de pantalla lee la pista
 * enlazada con `aria-describedby`. Como `aria-disabled` no bloquea nada por sí
 * mismo, el bloqueo va aquí. También cubre el envío implícito con Enter, que
 * `disabled` impedía. Se corta **antes** de validar: sin conexión no tiene
 * sentido mostrar errores de campo ni mover el foco al primer campo inválido.
 *
 * @param offline - `true` si el dispositivo no tiene conexión (`useIsOffline`).
 * @param submit - Handler de React Hook Form (`handleSubmit(...)`).
 * @returns Handler para `<form onSubmit>`.
 *
 * @example
 * ```tsx
 * <form onSubmit={blockSubmitWhileOffline(offline, onSubmit)} noValidate>
 * ```
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guía `custom-button-actions`.
 */
export function blockSubmitWhileOffline(
  offline: boolean,
  submit: (event: FormEvent<HTMLFormElement>) => Promise<void> | void,
): (event: FormEvent<HTMLFormElement>) => void {
  return (event) => {
    if (offline) {
      event.preventDefault();
      return;
    }
    void submit(event);
  };
}
