"use client";

import { Globe } from "lucide-react";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from "react";
import { FieldError, inputBaseClass, Label } from "@/components/ui/text-field";
import { DEFAULT_TIMEZONE, detectTimeZone } from "@/lib/auth/schemas";
import { cn } from "@/lib/utils";

const subscribeNoop = () => () => {};

/**
 * Zona horaria del navegador. En el servidor (y durante la hidratación)
 * devuelve `null` para no provocar mismatch de HTML.
 */
export function useDetectedTimeZone(): string | null {
  return useSyncExternalStore(subscribeNoop, detectTimeZone, () => null);
}

function listTimeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  const set = new Set(zones);
  set.add(DEFAULT_TIMEZONE);
  if (current) set.add(current);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Props de {@link TimeZoneField} (controlado; pensado para `Controller` de React Hook Form). */
export interface TimeZoneFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** `true` si el valor proviene de la detección automática. */
  autoDetected: boolean;
  error?: string;
  /**
   * Ref para React Hook Form (`field.ref` del Controller): al fallar la
   * validación, RHF llama a `focus()`, que enfoca el `<select>` si está
   * abierto o, si no, el botón "Cambiar".
   */
  ref?: Ref<{ focus: () => void }>;
}

/**
 * Fila de solo lectura con la zona detectada + botón "Cambiar" que despliega
 * un `<select>` nativo (accesible por teclado y lectores de pantalla).
 */
export function TimeZoneField({ id, value, onChange, autoDetected, error, ref }: TimeZoneFieldProps) {
  const [editing, setEditing] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => (selectRef.current ?? toggleRef.current)?.focus(),
    }),
    [],
  );
  const zones = useMemo(() => (editing ? listTimeZones(value) : []), [editing, value]);
  const selectId = `${id}-select`;
  const errorId = `${id}-error`;

  useEffect(() => {
    if (editing) selectRef.current?.focus();
  }, [editing]);

  return (
    <div className="space-y-2">
      <div className="flex min-h-11 items-center justify-between rounded-[4px] border border-border-sand bg-surface-lowest p-3">
        <div className="flex min-w-0 items-center gap-2.5 pr-2">
          <Globe aria-hidden="true" className="size-4 shrink-0 text-primary-container" strokeWidth={1.8} />
          <div className="min-w-0">
            <p id={id} className="truncate text-[0.8125rem] font-semibold text-foreground">
              <span className="sr-only">Zona horaria: </span>
              {value || "Detectando zona horaria…"}
            </p>
            {value ? (
              <p className="text-xs text-muted-foreground">
                {autoDetected ? "(detectada automáticamente)" : "(elegida manualmente)"}
              </p>
            ) : null}
          </div>
        </div>
        <button
          ref={toggleRef}
          type="button"
          aria-describedby={error && !editing ? errorId : undefined}
          onClick={() => setEditing((current) => !current)}
          aria-expanded={editing}
          aria-controls={editing ? selectId : undefined}
          className="inline-flex min-h-11 shrink-0 items-center rounded-[4px] px-2 text-[0.8125rem] font-semibold text-primary-container hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container"
        >
          {editing ? "Listo" : "Cambiar"}
          <span className="sr-only"> zona horaria</span>
        </button>
      </div>

      {editing ? (
        <div className="space-y-1.5">
          <Label htmlFor={selectId}>Zona horaria</Label>
          <select
            ref={selectRef}
            id={selectId}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className={cn(inputBaseClass, "appearance-auto")}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}
