/**
 * Doble de `next/headers` para probar Route Handlers / session.ts fuera del
 * runtime de Next. Uso:
 *
 *   const jar = vi.hoisted(() => createCookieJarState());
 *   vi.mock("next/headers", () => nextHeadersMock(jar));
 */
export interface CookieSet {
  name: string;
  value: string;
  options: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
    path?: string;
    maxAge?: number;
  };
}

export interface CookieJarState {
  values: Map<string, string>;
  sets: CookieSet[];
  requestHeaders: Headers;
  reset(initial?: Record<string, string>): void;
}

export function createCookieJarState(): CookieJarState {
  const state: CookieJarState = {
    values: new Map(),
    sets: [],
    requestHeaders: new Headers(),
    reset(initial = {}) {
      state.values = new Map(Object.entries(initial));
      state.sets = [];
      state.requestHeaders = new Headers();
    },
  };
  return state;
}

export function nextHeadersMock(state: CookieJarState) {
  return {
    cookies: async () => ({
      get: (name: string) =>
        state.values.has(name) ? { name, value: state.values.get(name)! } : undefined,
      set: (name: string, value: string, options: CookieSet["options"] = {}) => {
        state.sets.push({ name, value, options });
        if (options.maxAge === 0) state.values.delete(name);
        else state.values.set(name, value);
      },
    }),
    headers: async () => state.requestHeaders,
  };
}
