"use client";

import { FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";

interface AuthState {
  authenticated: boolean;
  passwordRequired: boolean;
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not check authentication");
        return (await response.json()) as AuthState;
      })
      .then((next) => {
        if (active) setState(next);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Could not load ORA");
          setState({ authenticated: false, passwordRequired: true });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth", { method: "DELETE" });
    setPassword("");
    setState({ authenticated: false, passwordRequired: true });
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Sign-in failed");
      setPassword("");
      setState({ authenticated: true, passwordRequired: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!state) {
    return (
      <main className="grid h-dvh place-items-center bg-zinc-950 text-zinc-400 light:bg-[#f8f5f0] light:text-[#6b6255]">
        <div className="flex items-center gap-3 text-sm">
          <span className="thinking-dot" />
          Loading ORA…
        </div>
      </main>
    );
  }

  if (!state.authenticated) {
    return (
      <main className="grid h-dvh place-items-center bg-zinc-950 p-6 light:bg-[#f8f5f0]">
        <form
          onSubmit={signIn}
          className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl light:border-[#e5ded1] light:bg-white"
        >
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-400">ORA</p>
            <h1 className="mt-2 text-xl font-semibold text-zinc-100 light:text-[#2b2620]">Unlock your coding agent</h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500 light:text-[#8a7f6d]">
              Enter the password configured for this deployment.
            </p>
          </div>
          <label htmlFor="ora-password" className="mb-2 block text-xs font-medium text-zinc-400 light:text-[#6b6255]">
            Password
          </label>
          <input
            id="ora-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="input-field w-full px-3 py-2.5"
          />
          {error && <p className="mt-2 text-sm text-red-400 light:text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={!password || submitting}
            className="mt-4 w-full rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Unlocking…" : "Unlock ORA"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <>
      {children}
      {state.passwordRequired && (
        <button
          type="button"
          onClick={signOut}
          className="fixed bottom-3 right-3 z-[80] rounded-lg border border-zinc-700 bg-zinc-900/90 px-2.5 py-1.5 text-[11px] text-zinc-500 shadow-lg backdrop-blur hover:text-zinc-200 light:border-[#ddd3bd] light:bg-white/90 light:text-[#8a7f6d] light:hover:text-[#2b2620]"
        >
          Sign out
        </button>
      )}
    </>
  );
}
