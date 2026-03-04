"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";

interface ApiHealthContextValue {
  isHealthy: () => boolean;
}

const ApiHealthContext = createContext<ApiHealthContextValue | null>(null);

export function ApiHealthProvider({ children }: { children: ReactNode }) {
  const healthyRef = useRef(true);

  useEffect(() => {
    fetch("/api/ai/ping")
      .then((r) => {
        if (!r.ok) {
          healthyRef.current = false;
          console.warn("[SunnyD] API unavailable — AI features disabled");
        }
      })
      .catch(() => {
        healthyRef.current = false;
        console.warn("[SunnyD] API unavailable — AI features disabled");
      });
  }, []);

  const isHealthy = useCallback(() => healthyRef.current, []);

  return (
    <ApiHealthContext.Provider value={{ isHealthy }}>
      {children}
    </ApiHealthContext.Provider>
  );
}

export function useApiHealth(): ApiHealthContextValue {
  const ctx = useContext(ApiHealthContext);
  return ctx ?? { isHealthy: () => true };
}
