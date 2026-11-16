"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getErrorMessage } from "@/lib/business/rpc";

export function useAsyncData<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);

  useEffect(() => {
    loaderRef.current = loader;
  });

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loaderRef.current());
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to load data."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}

/** Runs an async action with shared busy / error / success state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const run = useCallback(async <T,>(action: () => Promise<T>, successMessage?: string): Promise<T | undefined> => {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await action();
      if (successMessage) setSuccess(successMessage);
      return result;
    } catch (caught) {
      setError(getErrorMessage(caught));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, success, run, setError, setSuccess };
}
