"use client";

import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delayMs` has
 * passed without `value` changing again. Use this to gate expensive
 * side-effects (network calls, heavy filtering) off of fast-changing input
 * like a text field's onChange, without touching the input's own state —
 * the input stays instantly responsive; only the *effect* driven by it waits.
 */
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
