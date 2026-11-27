"use client";

import { CircleCheck, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** API de {@link useStatusAnnouncer}. */
export interface StatusAnnouncer {
  /** Muestra (aviso visible persistente) y anuncia cortésmente un resultado de acción. */
  announce: (message: string) => void;
  /**
   * Anuncia cortésmente **solo a lectores de pantalla**, sin aviso visible.
   * Para cambios cuyo resultado ya se ve en la página (recuentos al filtrar,
   * hogar activo).
   */
  speak: (message: string) => void;
  /** Oculta el aviso visible actual (devolviendo el foco si estaba en él). */
  clear: () => void;
}

const StatusAnnouncerContext = createContext<StatusAnnouncer | null>(null);

/** Mensaje con número de secuencia: cada anuncio monta un nodo nuevo. */
interface Utterance {
  text: string;
  seq: number;
}

/** Variable CSS con la altura del aviso visible (la lee `scroll-padding-bottom` en `globals.css`). */
export const STATUS_TOAST_SIZE_VAR = "--status-toast-block-size";

/**
 * Devuelve el foco a `target` si sigue en el documento y es enfocable; si no,
 * al `<main>` de la página (con `tabindex="-1"` si no lo tenía), para que el
 * foco nunca caiga a `<body>` (WCAG 2.4.3).
 */
function restoreFocus(target: HTMLElement | null): void {
  if (target?.isConnected) {
    target.focus();
    if (document.activeElement === target) return;
  }
  const main = document.querySelector<HTMLElement>("main");
  if (!main) return;
  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  main.focus({ preventScroll: true });
}

/**
 * Proveedor de los avisos del shell autenticado: un contenedor
 * `role="region" aria-label="Avisos"` con una región `role="status"` que existe
 * desde la carga y en la que se escriben los resultados de acciones
 * ("Consumiste 1 l de Leche"), más una segunda región de estado oculta para
 * anuncios solo para lectores de pantalla ({@link StatusAnnouncer.speak}).
 *
 * @remarks
 * - Las regiones vivas están montadas (vacías) desde el inicio: los lectores
 *   solo anuncian cambios en regiones que ya existían.
 * - Cada anuncio monta un `<span>` nuevo (`key` = secuencia) dentro de la
 *   región: es una inserción en el árbol de accesibilidad, así que un texto
 *   idéntico al anterior se vuelve a anunciar (vaciar y reescribir en el mismo
 *   *tick* lo agruparía React y no se anunciaría).
 * - El aviso visible persiste hasta que se descarta o lo reemplaza otro. Al
 *   cerrarlo con el foco dentro, el foco vuelve a donde estaba al anunciarse;
 *   si ese elemento ya no existe (p. ej. la tarjeta del lote agotado), al
 *   `<main>`.
 * - Mientras hay aviso, su altura (medida con `ResizeObserver`) se suma al
 *   `scroll-padding-bottom` del documento: el navegador desplaza el elemento
 *   enfocado por encima del aviso y de la barra inferior (WCAG 2.4.11).
 * - No usa `popover` ni `ariaNotify()` (Baseline *newly available*; el
 *   objetivo es *widely available*): fallback de la guía con región viva.
 * - Quien llama debe cerrar antes cualquier `<dialog>` modal: con el modal
 *   abierto el resto de la página es inerte y el anuncio se perdería.
 *
 * @param props.children - Árbol autenticado.
 * @returns El proveedor con las regiones de aviso.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guía `persistent-toast-notifications` (contenedor `region`, foco al descartar, fallback con región viva).
 */
export function StatusAnnouncerProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Utterance | null>(null);
  const [spoken, setSpoken] = useState<Utterance | null>(null);
  const seq = useRef(0);
  const toastRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const announce = useCallback((text: string) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !toastRef.current?.contains(active)) {
      returnFocusRef.current = active;
    }
    seq.current += 1;
    setToast({ text, seq: seq.current });
  }, []);

  const speak = useCallback((text: string) => {
    seq.current += 1;
    setSpoken({ text, seq: seq.current });
  }, []);

  const clear = useCallback(() => {
    const hadFocus = toastRef.current?.contains(document.activeElement) ?? false;
    // Antes de desmontar el botón "Cerrar aviso": si no, el foco cae a <body>.
    if (hadFocus) restoreFocus(returnFocusRef.current);
    returnFocusRef.current = null;
    setToast(null);
  }, []);

  const value = useMemo(() => ({ announce, speak, clear }), [announce, speak, clear]);
  const visible = toast !== null;

  useEffect(() => {
    const element = toastRef.current;
    if (!visible || !element) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty(STATUS_TOAST_SIZE_VAR, `${element.getBoundingClientRect().height}px`);
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(STATUS_TOAST_SIZE_VAR);
    };
  }, [visible]);

  return (
    <StatusAnnouncerContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Avisos"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-40 flex justify-center px-4"
      >
        <div
          ref={toastRef}
          data-visible={visible || undefined}
          className={
            visible
              ? "status-toast pointer-events-auto flex w-full max-w-[24.875rem] items-start gap-2 rounded-[4px] bg-primary px-3.5 py-2.5 text-sm text-primary-foreground shadow-ambient"
              : "status-toast sr-only"
          }
        >
          {visible ? <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2.2} /> : null}
          <p role="status" className="min-w-0 flex-1 font-medium">
            {toast ? <span key={toast.seq}>{toast.text}</span> : null}
          </p>
          {visible ? (
            <button
              type="button"
              onClick={clear}
              aria-label="Cerrar aviso"
              className="-my-2 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-primary-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      <p role="status" className="sr-only" data-testid="sr-announcer">
        {spoken ? <span key={spoken.seq}>{spoken.text}</span> : null}
      </p>
    </StatusAnnouncerContext.Provider>
  );
}

/**
 * Acceso a los avisos del shell.
 *
 * @returns {@link StatusAnnouncer}. Fuera del proveedor devuelve una
 *   implementación vacía (p. ej. en tests de componentes aislados).
 */
export function useStatusAnnouncer(): StatusAnnouncer {
  return useContext(StatusAnnouncerContext) ?? NOOP_ANNOUNCER;
}

/**
 * Anuncia `message` (solo a lectores de pantalla) cuando cambia `key`, nunca
 * al montar ni cuando solo cambia el mensaje. Así un recuento se anuncia una
 * vez al cambiar los filtros, y no en cada *refetch* o consumo que lo altere
 * (una región `role="status"` sobre el recuento visible lo anunciaría 2–3
 * veces por consumo).
 *
 * @param key - Identidad del estado elegido por el usuario (filtros, hogar).
 * @param message - Texto a anunciar; se lee el valor vigente al vencer la espera.
 * @param delayMs - Espera para agrupar cambios rápidos (teclear, flechas en un
 *   `<select>`) en un solo anuncio.
 *
 * @remarks Mantén el foco en el control que provocó el cambio; el anuncio
 * nombra el resultado, no el mecanismo.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guía `dynamic-sort` ("Announce the change once").
 */
export function useAnnounceOnChange(key: string, message: string, delayMs = 500): void {
  const { speak } = useStatusAnnouncer();
  const messageRef = useRef(message);
  const previousKey = useRef<string | null>(null);

  useEffect(() => {
    messageRef.current = message;
  });

  useEffect(() => {
    if (previousKey.current === null || previousKey.current === key) {
      previousKey.current = key;
      return;
    }
    previousKey.current = key;
    const timer = setTimeout(() => speak(messageRef.current), delayMs);
    return () => clearTimeout(timer);
  }, [key, delayMs, speak]);
}

const NOOP_ANNOUNCER: StatusAnnouncer = { announce: () => {}, speak: () => {}, clear: () => {} };
