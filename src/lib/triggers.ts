/**
 * Trigger logic and debounce helpers for AI features.
 */

export function createDebouncedTrigger(
  fn: (signal: AbortSignal) => Promise<void>,
  delay: number
) {
  let timer: ReturnType<typeof setTimeout>;
  let controller: AbortController;

  return () => {
    clearTimeout(timer);
    controller?.abort();
    controller = new AbortController();
    timer = setTimeout(() => fn(controller.signal), delay);
  };
}

export function shouldTriggerGhostText(
  wordCount: number,
  isSelecting: boolean,
  lastCharIsSlash: boolean,
  cursorInHeading: boolean
): boolean {
  if (wordCount < 30) return false;
  if (isSelecting) return false;
  if (lastCharIsSlash) return false;
  if (cursorInHeading) return false;
  return true;
}

export function shouldTriggerAnalysis(
  wordCount: number,
  lastAnalysisWordCount: number
): boolean {
  return wordCount > 150 && wordCount - lastAnalysisWordCount >= 50;
}

export function shouldTriggerTypeDetection(
  wordCount: number,
  hasDetected: boolean
): boolean {
  return wordCount >= 60 && !hasDetected;
}

/** Re-run type detection when headings (H1/H2) change context */
export function shouldRetriggerTypeDetectionForHeadings(
  prevHeadingsSignature: string,
  currentHeadingsSignature: string
): boolean {
  return prevHeadingsSignature !== currentHeadingsSignature && currentHeadingsSignature.length > 0;
}
