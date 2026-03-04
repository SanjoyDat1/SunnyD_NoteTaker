"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { SunnyDScanKey } from "@/extensions/SunnyDScanExtension";

const SCAN_COOLDOWN_MS = 15_000;
const IDLE_BEFORE_SCAN_MS = 2500;
/** Time between moving highlight to next segment — keeps it flowing */
const SEGMENT_STAGGER_MS = 140;
const SETTLE_PULSE_MS = 200;
const SETTLE_INTERVAL_MS = 300;

/**
 * SunnyD scanner: decoration-based moving highlight (paragraph-by-paragraph).
 * Uses ProseMirror decorations for guaranteed visibility.
 */
export function useSunnyDScanner(editor: Editor | null) {
  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);
  const pendingSettleRef = useRef<string | null>(null);
  const scanDoneRef = useRef(false);
  const lastScanTimeRef = useRef<number>(0);
  const lastInteractionRef = useRef<number>(Date.now());

  const canScan = useCallback(() => {
    return Date.now() - lastScanTimeRef.current > SCAN_COOLDOWN_MS;
  }, []);

  const shouldScan = useCallback(() => {
    return (
      canScan() &&
      Date.now() - lastInteractionRef.current > IDLE_BEFORE_SCAN_MS
    );
  }, [canScan]);

  const cancelScan = useCallback(() => {
    timeoutsRef.current.forEach((t) => clearTimeout(t));
    timeoutsRef.current = [];
    if (editor?.view) {
      editor.view.dispatch(
        editor.view.state.tr.setMeta(SunnyDScanKey, { type: "CLEAR" })
      );
    }
    pendingSettleRef.current = null;
  }, [editor]);

  const setActing = useCallback(
    (from: number, to: number) => {
      if (!editor?.view) return;
      editor.view.dispatch(
        editor.view.state.tr.setMeta(SunnyDScanKey, {
          type: "SET_ACTING",
          from,
          to,
        })
      );
    },
    [editor]
  );

  const clearActing = useCallback(() => {
    if (!editor?.view) return;
    editor.view.dispatch(
      editor.view.state.tr.setMeta(SunnyDScanKey, { type: "CLEAR_ACTING" })
    );
  }, [editor]);

  const settleOn = useCallback(
    (anchorText: string) => {
      if (!editor?.view) return;

      if (!scanDoneRef.current) {
        pendingSettleRef.current = anchorText;
        return;
      }

      const doc = editor.state.doc;
      const slice = anchorText.slice(0, 20);
      let targetFrom = 0;
      let targetTo = 0;
      let found = false;

      doc.descendants((node, pos) => {
        if (found) return false;
        if (node.isBlock && node.textContent.includes(slice)) {
          targetFrom = pos + 1;
          targetTo = pos + node.nodeSize - 1;
          found = true;
          return false;
        }
        return true;
      });

      if (!found || targetFrom >= targetTo) return;

      [0, SETTLE_INTERVAL_MS, 2 * SETTLE_INTERVAL_MS].forEach((delay) => {
        const t = setTimeout(() => {
          editor.view?.dispatch(
            editor.view.state.tr.setMeta(SunnyDScanKey, {
              type: "SET_HIGHLIGHT",
              from: targetFrom,
              to: targetTo,
            })
          );
          const clear = setTimeout(() => {
            editor.view?.dispatch(
              editor.view.state.tr.setMeta(SunnyDScanKey, { type: "CLEAR" })
            );
          }, SETTLE_PULSE_MS);
          timeoutsRef.current.push(clear);
        }, delay);
        timeoutsRef.current.push(t);
      });
    },
    [editor]
  );

  const startScan = useCallback(
    (
      onComplete?: (settleOnText?: string) => void,
      opts?: { skipIdleCheck?: boolean; onSegment?: (from: number, to: number) => void }
    ) => {
      if (!editor?.view) return;
      if (opts?.skipIdleCheck ? !canScan() : !shouldScan()) return;

      cancelScan();
      lastScanTimeRef.current = Date.now();
      scanDoneRef.current = false;

      const doc = editor.state.doc;
      const segments: { from: number; to: number }[] = [];

      doc.descendants((node, pos) => {
        if (node.isBlock && node.textContent.trim().length > 0) {
          segments.push({ from: pos + 1, to: pos + node.nodeSize - 1 });
        }
      });

      if (segments.length === 0) {
        scanDoneRef.current = true;
        onComplete?.();
        return;
      }

      segments.forEach((seg, i) => {
        const t = setTimeout(() => {
          opts?.onSegment?.(seg.from, seg.to);
          editor.view?.dispatch(
            editor.view.state.tr.setMeta(SunnyDScanKey, {
              type: "SET_HIGHLIGHT",
              from: seg.from,
              to: seg.to,
            })
          );
        }, i * SEGMENT_STAGGER_MS);
        timeoutsRef.current.push(t);
      });

      const totalMs = segments.length * SEGMENT_STAGGER_MS + 100;
      const doneTimeout = setTimeout(() => {
        scanDoneRef.current = true;
        editor.view?.dispatch(
          editor.view.state.tr.setMeta(SunnyDScanKey, { type: "CLEAR" })
        );
        if (pendingSettleRef.current) {
          const anchor = pendingSettleRef.current;
          pendingSettleRef.current = null;
          onComplete?.(anchor);
          settleOn(anchor);
        } else {
          onComplete?.();
        }
      }, totalMs);
      timeoutsRef.current.push(doneTimeout);
    },
    [editor, cancelScan, settleOn, shouldScan, canScan]
  );

  const startScanIfAllowed = useCallback(
    (onComplete?: (settleOnText?: string) => void) => {
      if (shouldScan()) startScan(onComplete);
    },
    [startScan, shouldScan]
  );

  const startScanForNewContent = useCallback(
    (
      onComplete?: (settleOnText?: string) => void,
      opts?: { onSegment?: (from: number, to: number) => void }
    ) => {
      // Skip both idle and cooldown when content just changed (e.g. answer inserted)
      if (!editor?.view) return;
      cancelScan();
      lastScanTimeRef.current = Date.now();
      scanDoneRef.current = false;
      const doc = editor.state.doc;
      const segments: { from: number; to: number }[] = [];
      doc.descendants((node, pos) => {
        if (node.isBlock && node.textContent.trim().length > 0) {
          segments.push({ from: pos + 1, to: pos + node.nodeSize - 1 });
        }
      });
      if (segments.length === 0) {
        scanDoneRef.current = true;
        onComplete?.();
        return;
      }
      segments.forEach((seg, i) => {
        const t = setTimeout(() => {
          opts?.onSegment?.(seg.from, seg.to);
          editor.view?.dispatch(
            editor.view.state.tr.setMeta(SunnyDScanKey, {
              type: "SET_HIGHLIGHT",
              from: seg.from,
              to: seg.to,
            })
          );
        }, i * SEGMENT_STAGGER_MS);
        timeoutsRef.current.push(t);
      });
      const totalMs = segments.length * SEGMENT_STAGGER_MS + 100;
      const doneTimeout = setTimeout(() => {
        scanDoneRef.current = true;
        editor.view?.dispatch(
          editor.view.state.tr.setMeta(SunnyDScanKey, { type: "CLEAR" })
        );
        if (pendingSettleRef.current) {
          const anchor = pendingSettleRef.current;
          pendingSettleRef.current = null;
          onComplete?.(anchor);
          settleOn(anchor);
        } else {
          onComplete?.();
        }
      }, totalMs);
      timeoutsRef.current.push(doneTimeout);
    },
    [editor, cancelScan, settleOn]
  );

  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      lastInteractionRef.current = Date.now();
      cancelScan();
    };
    const onFocus = () => {
      lastInteractionRef.current = Date.now();
    };
    editor.on("update", onUpdate);
    editor.on("focus", onFocus);
    const dom = editor.view.dom;
    const onKeydown = () => {
      lastInteractionRef.current = Date.now();
      cancelScan();
    };
    dom.addEventListener("keydown", onKeydown);
    return () => {
      editor.off("update", onUpdate);
      editor.off("focus", onFocus);
      dom.removeEventListener("keydown", onKeydown);
    };
  }, [editor, cancelScan]);

  return {
    startScan,
    startScanIfAllowed,
    startScanForNewContent,
    settleOn,
    cancelScan,
    setActing,
    clearActing,
    canScan,
    shouldScan,
    scanDoneRef,
    pendingSettleRef,
  };
}
