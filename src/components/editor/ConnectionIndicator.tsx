"use client";

import { useState } from "react";
import type { ConnectionResult } from "@/hooks/useConnection";
import { SUNNYD } from "@/lib/sunnyd";

export interface ConnectionIndicatorProps {
  connection: ConnectionResult | null;
}

export function ConnectionIndicator({ connection }: ConnectionIndicatorProps) {
  const [hovered, setHovered] = useState(false);

  if (!connection?.hasConnection || !connection.insight) return null;

  return (
    <div
      className="absolute right-3 top-24 z-10"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="flex h-5 w-5 cursor-default items-center justify-center rounded text-sunnyd-accent text-sm hover:text-sunnyd-accent/90">
        ✦
      </span>
      {hovered && (
        <div className="absolute right-full top-0 z-50 mr-1 w-64 max-h-[40vh] overflow-y-auto rounded-lg border border-border bg-surface p-3 shadow-lg">
          <p className="mb-1.5 text-[10px] font-sans uppercase tracking-wide text-text-muted">
            {SUNNYD.foundConnection}
          </p>
          <p className="text-xs font-sans text-text leading-relaxed break-words">
            {connection.insight}
          </p>
        </div>
      )}
    </div>
  );
}
