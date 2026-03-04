"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSunnyD } from "@/contexts/SunnyDContext";

const MAIN_ACTIONS = [
  { id: "enhance", icon: "✦", label: "Enhance" },
  { id: "distill", icon: "◈", label: "Distill" },
  { id: "expand", icon: "↔", label: "Expand" },
] as const;

const MORE_ACTIONS = [
  { id: "bullets", icon: "≡", label: "Bullets" },
  { id: "simplify", icon: "◻", label: "Simplify" },
  { id: "rephrase", icon: "↺", label: "Rephrase" },
  { id: "extract-actions", icon: "✓", label: "Extract Actions" },
] as const;

const CLIPBOARD_ACTIONS = [
  { id: "copy", icon: "⎘", label: "Copy" },
  { id: "cut", icon: "✂", label: "Cut" },
] as const;

export interface SelectionToolbarProps {
  visible: boolean;
  position: { x: number; y: number; above: boolean };
  loadingAction: string | null;
  onAction: (action: string) => void;
}

export function SelectionToolbar({
  visible,
  position,
  loadingAction,
  onAction,
}: SelectionToolbarProps) {
  const { isEnabled } = useSunnyD();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const aiEnabled = isEnabled("selectionToolbar");
  const mainItems = aiEnabled ? MAIN_ACTIONS : CLIPBOARD_ACTIONS;

  useEffect(() => {
    if (!moreOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [moreOpen]);

  if (!visible) return null;

  return (
    <motion.div
      className="sunnyd-toolbar"
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        transform: "translate(-50%, 0)",
        zIndex: 100,
      }}
    >
      {mainItems.map(({ id, icon, label }) => (
        <button
          key={id}
          type="button"
          className={`sunnyd-toolbar-btn ${loadingAction === id ? "loading" : ""}`}
          onClick={() => onAction(id)}
        >
          <span>{icon}</span>
          <span>{label}</span>
        </button>
      ))}

      {aiEnabled && (
        <>
          <div className="sunnyd-toolbar-divider" />
          <div ref={moreRef} style={{ position: "relative" }}>
            <button
              type="button"
              className={`sunnyd-toolbar-btn ${loadingAction?.startsWith("more-") ? "loading" : ""}`}
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen}
            >
              <span>⋯</span>
              <span>More</span>
              <span style={{ marginLeft: 2 }}>▾</span>
            </button>
            <AnimatePresence>
              {moreOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: "100%",
                    transform: "translate(-50%, 0)",
                    marginBottom: 4,
                    background: "#1a1a18",
                    borderRadius: 8,
                    padding: 4,
                    boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
                    zIndex: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  {MORE_ACTIONS.map(({ id, icon, label }) => (
                    <button
                      key={id}
                      type="button"
                      className="sunnyd-toolbar-btn"
                      onClick={() => {
                        setMoreOpen(false);
                        onAction(id);
                      }}
                    >
                      <span>{icon}</span>
                      <span>{label}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </motion.div>
  );
}
