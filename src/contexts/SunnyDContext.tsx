"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { SunnyDLevel } from "@/lib/sunnyd";
import { isEnabled } from "@/lib/sunnyd";

interface SunnyDContextValue {
  level: SunnyDLevel;
  setLevel: (level: SunnyDLevel) => void;
  isEnabled: (feature: keyof typeof import("@/lib/sunnyd").FEATURE_FLAGS) => boolean;
}

const SunnyDContext = createContext<SunnyDContextValue | null>(null);

export function SunnyDProvider({ children }: { children: React.ReactNode }) {
  const [level, setLevelState] = useState<SunnyDLevel>(2);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("sunnyd_level");
    const n = stored ? parseInt(stored, 10) : NaN;
    if (!isNaN(n) && n >= 0 && n <= 3) {
      setLevelState(n as SunnyDLevel);
    } else if (stored !== null) {
      localStorage.removeItem("sunnyd_level");
    }
  }, []);

  const setLevel = useCallback((newLevel: SunnyDLevel) => {
    setLevelState(newLevel);
    if (typeof window !== "undefined") {
      localStorage.setItem("sunnyd_level", String(newLevel));
    }
  }, []);

  const checkEnabled = useCallback(
    (feature: keyof typeof import("@/lib/sunnyd").FEATURE_FLAGS) =>
      isEnabled(feature, level),
    [level]
  );

  return (
    <SunnyDContext.Provider
      value={{ level, setLevel, isEnabled: checkEnabled }}
    >
      {children}
    </SunnyDContext.Provider>
  );
}

export function useSunnyD() {
  const ctx = useContext(SunnyDContext);
  if (!ctx) {
    throw new Error("useSunnyD must be used within SunnyDProvider");
  }
  return ctx;
}
