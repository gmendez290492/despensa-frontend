import { ShieldCheck, Sparkles, WifiOff } from "lucide-react";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl rounded-2xl border border-outline-variant/50 bg-surface-lowest p-8 shadow-sm sm:p-12">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary-fixed px-3 py-1 text-xs font-semibold tracking-wider text-primary uppercase">
          Despensa PWA · Next.js 16 + React 19
        </span>

        <h1 className="mt-6 font-display text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
          Control inteligente de tu despensa, con o sin conexión.
        </h1>

        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          Base arquitectónica inicial lista: Server Components (BFF), contratos
          OpenAPI 3.1 estrictos, gestión de estado por capas con{" "}
          <strong className="font-semibold text-foreground">Zustand</strong> y{" "}
          <strong className="font-semibold text-foreground">
            TanStack Query
          </strong>
          , persistencia local en{" "}
          <strong className="font-semibold text-foreground">IndexedDB</strong> y
          Service Worker con{" "}
          <strong className="font-semibold text-foreground">Serwist</strong>.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl bg-surface-low p-4">
            <ShieldCheck className="h-5 w-5 text-primary-container" />
            <h2 className="mt-2 text-sm font-semibold text-foreground">
              BFF + Cookies HttpOnly
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Rotación segura de JWT contra FastAPI sin exponer tokens en JS.
            </p>
          </div>

          <div className="rounded-xl bg-surface-low p-4">
            <WifiOff className="h-5 w-5 text-secondary" />
            <h2 className="mt-2 text-sm font-semibold text-foreground">
              Cola Offline Outbox
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Lectura y registro de lotes en pasillos sin señal vía Dexie.
            </p>
          </div>

          <div className="rounded-xl bg-surface-low p-4">
            <Sparkles className="h-5 w-5 text-primary-container" />
            <h2 className="mt-2 text-sm font-semibold text-foreground">
              Diseño Google Stitch
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Tokens semánticos FEFO, Newsreader y Manrope listos para UI.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
