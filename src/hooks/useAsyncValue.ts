import { useEffect, useState } from "react";

/**
 * Loads a value for `key` and returns it once the load for the *current* key has
 * finished: `pending` until then, so a result for an earlier key never shows.
 * Unlike resetting state at the start of an effect, this needs no extra render.
 * `load` is not a dependency: the key identifies the request. Long loads can
 * check `stale()` and stop early once the key has changed.
 */
export function useAsyncValue<K, T>(key: K, load: (key: K, stale: () => boolean) => Promise<T> | T) {
  const [result, setResult] = useState<{ key: K; value?: T; error?: unknown } | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => load(key, () => cancelled))
      .then(
        (value) => !cancelled && setResult({ key, value }),
        (error: unknown) => !cancelled && setResult({ key, error }),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = result && Object.is(result.key, key) ? result : null;
  return { value: current?.value, error: current?.error, pending: !current };
}
