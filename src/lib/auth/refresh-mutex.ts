/**
 * Mutex de refresco por clave (refresh_token).
 *
 * FastAPI rota e invalida el refresh_token en cada uso y revoca toda la
 * familia de sesión si detecta reuso. Por eso:
 *
 * 1. Las llamadas concurrentes con el mismo token comparten UNA promesa en
 *    vuelo (solo se ejecuta un `POST /auth/refresh`).
 * 2. Tras resolverse, el resultado se conserva durante `graceMs` (5 s por
 *    defecto): peticiones que el navegador ya había despachado con la cookie
 *    antigua (antes de recibir el `Set-Cookie` nuevo) obtienen el mismo par
 *    rotado en vez de reutilizar el token revocado. Compromiso: durante esa
 *    ventana, quien presente el token viejo recibe el par nuevo; por eso es
 *    corta y se desaloja con un timer.
 *
 * Las claves se derivan con `hashKey` (en el servidor, SHA-256) para no
 * retener tokens en claro en memoria. Módulo isomórfico: el hash se inyecta.
 *
 * Limitación: el estado vive en memoria del proceso Node. En despliegues con
 * varias instancias se necesitaría un almacén compartido (p. ej. Redis).
 */
/** Opciones de {@link createRefreshMutex}. */
export interface RefreshMutexOptions {
  /** Ventana durante la que se reutiliza un resultado ya resuelto. */
  graceMs?: number;
  now?: () => number;
  /** Deriva la clave interna a partir del token (p. ej. SHA-256). */
  hashKey?: (key: string) => string;
}

/** Mutex devuelto por {@link createRefreshMutex}. */
export interface RefreshMutex<T> {
  run(key: string, task: () => Promise<T>): Promise<T>;
  forget(key: string): void;
  /** Número de refrescos en vuelo (útil para tests/diagnóstico). */
  readonly inFlightCount: number;
  /** Número de resultados retenidos en la ventana de gracia. */
  readonly settledCount: number;
}

/** Ventana de gracia por defecto (ms) durante la que se reutiliza un refresco resuelto. */
export const DEFAULT_REFRESH_GRACE_MS = 5_000;

type Timer = ReturnType<typeof setTimeout>;

/**
 * Crea un mutex de refresco por clave (ver bloque de módulo).
 *
 * @param options - {@link RefreshMutexOptions}.
 * @returns Un {@link RefreshMutex}; `run(key, task)` comparte la promesa en vuelo
 *   y el resultado durante `graceMs`.
 *
 * @example
 * ```ts
 * const mutex = createRefreshMutex<TokenResponse>({ hashKey: hashRefreshToken });
 * const tokens = await mutex.run(refreshToken, () => callFastApiRefresh(refreshToken));
 * ```
 */
export function createRefreshMutex<T>(
  options: RefreshMutexOptions = {},
): RefreshMutex<T> {
  const graceMs = options.graceMs ?? DEFAULT_REFRESH_GRACE_MS;
  const now = options.now ?? Date.now;
  const hashKey = options.hashKey ?? ((key: string) => key);
  const inFlight = new Map<string, Promise<T>>();
  const settled = new Map<string, { value: T; expiresAt: number; timer: Timer }>();

  const evict = (id: string) => {
    const entry = settled.get(id);
    if (entry) clearTimeout(entry.timer);
    settled.delete(id);
  };

  return {
    run(key, task) {
      const id = hashKey(key);
      const cached = settled.get(id);
      if (cached) {
        // Respaldo por si el timer se retrasa (o `now` está simulado).
        if (cached.expiresAt > now()) return Promise.resolve(cached.value);
        evict(id);
      }

      const pending = inFlight.get(id);
      if (pending) return pending;

      const promise = (async () => {
        try {
          const value = await task();
          if (graceMs > 0) {
            evict(id);
            const timer = setTimeout(() => settled.delete(id), graceMs);
            // No mantener vivo el proceso Node solo por este timer.
            (timer as { unref?: () => void }).unref?.();
            settled.set(id, { value, expiresAt: now() + graceMs, timer });
          }
          return value;
        } finally {
          inFlight.delete(id);
        }
      })();

      inFlight.set(id, promise);
      return promise;
    },
    forget(key) {
      const id = hashKey(key);
      inFlight.delete(id);
      evict(id);
    },
    get inFlightCount() {
      return inFlight.size;
    },
    get settledCount() {
      return settled.size;
    },
  };
}
