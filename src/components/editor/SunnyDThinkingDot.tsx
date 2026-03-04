"use client";

import { AnimatePresence, motion } from "framer-motion";

export interface SunnyDThinkingDotProps {
  top: number;
  visible: boolean;
}

export function SunnyDThinkingDot({ top, visible }: SunnyDThinkingDotProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
          className="sunnyd-thinking-dot"
          style={{
            position: "absolute",
            left: -28,
            top,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "rgba(45, 106, 79, 0.85)",
            boxShadow: "0 0 0 0 rgba(45, 106, 79, 0.4)",
            pointerEvents: "none",
          }}
        />
      )}
    </AnimatePresence>
  );
}
