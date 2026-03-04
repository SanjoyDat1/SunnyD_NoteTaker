"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { GhostTextExtension } from "@/extensions/GhostTextExtension";
import { SlashCommandExtension } from "@/extensions/SlashCommandExtension";
import { PatternDetectorExtension } from "@/extensions/PatternDetectorExtension";
import { SunnyDCardExtension } from "@/extensions/SunnyDCardExtension";
import { QuestionAnswerBlockExtension } from "@/extensions/QuestionAnswerBlockExtension";
import { SunnyDScanExtension } from "@/extensions/SunnyDScanExtension";
import { useGhostText } from "@/hooks/useGhostText";
import { usePatternTriggers } from "@/hooks/usePatternTriggers";
import { useMarginInsights } from "@/hooks/useMarginInsights";
import { useSelectionToolbar } from "@/hooks/useSelectionToolbar";
import { useSlashCommand } from "@/hooks/useSlashCommand";
import { SelectionToolbar } from "./SelectionToolbar";
import { SunnyDResultPanel } from "./SunnyDResultPanel";
import { SlashCommandPicker } from "./SlashCommandPicker";
import { NoteTypeBadge } from "./NoteTypeBadge";
import { LevelSelector } from "./LevelSelector";
import { QuestionAnswerPrompts } from "./QuestionAnswerPrompts";
import { QuestionClickMenu } from "./QuestionClickMenu";
import { StructureSuggestion } from "./StructureSuggestion";
import { MarginInsightsOverlay } from "./MarginInsightsOverlay";
import { ProposalMarker } from "./ProposalMarker";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { SunnyDThinkingDot } from "./SunnyDThinkingDot";
import { useProactiveInsertions } from "@/hooks/useProactiveInsertions";
import { useNoteType } from "@/hooks/useNoteType";
import { useProposals, type Proposal } from "@/hooks/useProposals";
import { useConnection } from "@/hooks/useConnection";
import { useSunnyD } from "@/contexts/SunnyDContext";
import { SUNNYD, SUNNYD_STATUS } from "@/lib/sunnyd";
import { useSunnyDScanner } from "@/hooks/useSunnyDScanner";
import { useNotes } from "@/contexts/NotesContext";
import {
  findActionItemsSectionPos,
  getDocEndPos,
  findSafeInsertionPoint,
  wrapInSunnyDCard,
} from "@/lib/context";
import { escapeHtml } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function NoteEditor() {
  const {
    activeNote,
    updateNote,
    createNote,
  } = useNotes();

  const [hasTyped, setHasTyped] = useState(false);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [slashLoading, setSlashLoading] = useState(false);
  const [patternLoading, setPatternLoading] = useState(false);
  const [marginLoading, setMarginLoading] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [actionItemsToast, setActionItemsToast] = useState<string | null>(
    null
  );
  const [thinkingDotTop, setThinkingDotTop] = useState<number | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const editorContentRef = useRef<HTMLDivElement>(null);
  const onGhostAcceptedRef = useRef<() => void>(() => {});
  const [questionClickMenu, setQuestionClickMenu] = useState<{
    question: import("@/extensions/PatternDetectorExtension").DetectedQuestion;
    x: number;
    y: number;
  } | null>(null);
  const patternTriggersRef = useRef<{
    addActionItemToList: (text: string, from: number, to: number) => void;
    answerQuestion: (q: import("@/extensions/PatternDetectorExtension").DetectedQuestion) => void;
    showQuestionMenu: (q: import("@/extensions/PatternDetectorExtension").DetectedQuestion, e: MouseEvent) => void;
  }>({
    addActionItemToList: () => {},
    answerQuestion: () => {},
    showQuestionMenu: () => {},
  });
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slashStateChangeRef = useRef<(state: { open: boolean; query: string; from: number; to: number }) => void>();
  const editorContextRef = useRef({ noteType: "GENERAL" });

  const ghostTextExtensions = useMemo(
    () => [
      GhostTextExtension.configure({
        onGhostAccepted: () => onGhostAcceptedRef.current?.(),
      }),
      SlashCommandExtension.configure({
        onStateChange: (state) => slashStateChangeRef.current?.(state),
      }),
      PatternDetectorExtension.configure({
        onActionItemClick: (text, from, to) =>
          patternTriggersRef.current?.addActionItemToList?.(text, from, to),
        onQuestionClick: (q, e) => patternTriggersRef.current?.showQuestionMenu?.(q, e),
      }),
    ],
    []
  );

  const handlePaste = useCallback((view: import("@tiptap/pm/view").EditorView, event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return false;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file) {
          fileToDataUrl(file).then((src) => {
            const { schema } = view.state;
            const node = schema.nodes.image?.create({ src });
            if (node) {
              const tr = view.state.tr.replaceSelectionWith(node);
              view.dispatch(tr);
            }
          });
        }
        return true;
      }
    }
    return false;
  }, []);

  const handleDrop = useCallback((view: import("@tiptap/pm/view").EditorView, event: DragEvent, _slice: import("@tiptap/pm/model").Slice) => {
    const files = event.dataTransfer?.files;
    if (!files?.length) return false;
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) {
        event.preventDefault();
        const pos = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        if (pos) {
          fileToDataUrl(file).then((src) => {
            const { schema } = view.state;
            const node = schema.nodes.image?.create({ src });
            if (node) {
              const tr = view.state.tr.insert(pos.pos, node);
              view.dispatch(tr);
            }
          });
        }
        return true;
      }
    }
    return false;
  }, []);

  const editor = useEditor(
    {
      immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: SUNNYD.welcomeHint,
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      SunnyDCardExtension,
      QuestionAnswerBlockExtension.configure({
        noteType: () => editorContextRef.current.noteType ?? "GENERAL",
      }),
      SunnyDScanExtension,
      ...ghostTextExtensions,
    ],
    editorProps: {
      attributes: {
        class:
          "prose prose-lg max-w-none focus:outline-none font-serif min-h-[calc(100vh-140px)] pl-10 pr-4 py-6",
      },
      handlePaste(view, event) {
        return handlePaste(view, event as ClipboardEvent);
      },
      handleDrop(view, event, slice) {
        return handleDrop(view, event as DragEvent, slice);
      },
    },
    content: activeNote?.content ?? "",
    onUpdate: ({ editor }) => {
      setHasTyped(true);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null;
        if (activeNote) {
          const html = editor.getHTML();
          updateNote(activeNote.id, { content: html });
        }
      }, 500);
    },
  },
  [activeNote?.id]
  );

  const { level, isEnabled: sunnyDEnabled } = useSunnyD();
  const { startScanIfAllowed, startScanForNewContent, settleOn, setActing, clearActing } =
    useSunnyDScanner(editor);
  const noteType = useNoteType(editor);
  useEffect(() => {
    editorContextRef.current = { noteType };
  }, [noteType]);

  const {
    slashState,
    slashPosition,
    executeSlashCommand,
  } = useSlashCommand(
    editor,
    editorContainerRef,
    noteType,
    setSlashLoading,
    slashStateChangeRef
  );

  const {
    status: ghostStatus,
    needsVerifyStatistic,
    onGhostAccepted,
  } = useGhostText(editor, noteType, slashState.open);

  const {
    proposals,
    loading: proposalsLoading,
    applyProposal: applyProposalBase,
    dismissProposal,
  } = useProposals(editor, noteType);
  const applyProposal = useCallback(
    async (p: Proposal) => {
      await applyProposalBase(p);
      settleOn(p.targetText);
    },
    [applyProposalBase, settleOn]
  );

  const { connection, loading: connectionLoading } = useConnection(editor);
  useEffect(() => {
    onGhostAcceptedRef.current = onGhostAccepted;
    return () => {
      onGhostAcceptedRef.current = () => {};
    };
  }, [onGhostAccepted]);

  const {
    visible: toolbarVisible,
    position: toolbarPosition,
    runAction: runSelectionAction,
    resultPanel,
    applyResult,
    discardResult,
    copyResult,
    loadingAction: selectionLoadingAction,
    loadingRange: selectionLoadingRange,
  } = useSelectionToolbar(
    editor,
    editorContainerRef,
    noteType,
    setSelectionLoading,
    {
      onActionItemsAdded: (count) => {
        setActionItemsToast(`SunnyD added ${count} action item${count !== 1 ? "s" : ""} ↓`);
        setTimeout(() => setActionItemsToast(null), 3000);
      },
      scrollContainerRef,
    }
  );

  const handleThinkingChange = useCallback(
    (position: { from: number; to: number } | null) => {
      if (!position) {
        setThinkingDotTop(null);
        return;
      }
      if (!editor?.view) {
        setThinkingDotTop(null);
        return;
      }
      try {
        const coords = editor.view.coordsAtPos(position.from);
        const scrollEl = scrollContainerRef.current;
        if (scrollEl) {
          const rect = scrollEl.getBoundingClientRect();
          setThinkingDotTop(coords.top - rect.top + scrollEl.scrollTop);
        } else {
          setThinkingDotTop(coords.top);
        }
      } catch {
        setThinkingDotTop(null);
      }
    },
    [editor]
  );

  const {
    confirmedQuestions,
    answeringQuestion,
    showStructureSuggestion,
    dismissStructureSuggestion,
    answerQuestion,
    dismissQuestion,
    runStructureSuggestion,
    addActionItemToList,
  } = usePatternTriggers(
    editor,
    editorContainerRef,
    noteType,
    setPatternLoading,
    {
      onAnswerInsert: (questionText) => {
        settleOn(questionText);
        setTimeout(() => startScanForNewContent(), 200);
      },
      onThinkingChange: handleThinkingChange,
    }
  );

  useEffect(() => {
    patternTriggersRef.current = {
      addActionItemToList,
      answerQuestion,
      showQuestionMenu: (q, e) =>
        setQuestionClickMenu({ question: q, x: e.clientX, y: e.clientY }),
    };
  }, [addActionItemToList, answerQuestion]);

  const { insights: marginInsights, loading: marginInsightsLoading } =
    useMarginInsights(editor, noteType, setMarginLoading);
  const prevMarginLoadingRef = useRef(false);
  useEffect(() => {
    if (prevMarginLoadingRef.current && !marginInsightsLoading && marginInsights.length > 0) {
      startScanIfAllowed();
      marginInsights.forEach((i) => settleOn(i.anchorText));
    }
    prevMarginLoadingRef.current = marginInsightsLoading;
  }, [marginInsights, marginInsightsLoading, settleOn, startScanIfAllowed]);

  const prevProposalsLoadingRef = useRef(false);
  useEffect(() => {
    if (prevProposalsLoadingRef.current && !proposalsLoading && proposals.length > 0) {
      startScanIfAllowed();
    }
    prevProposalsLoadingRef.current = proposalsLoading;
  }, [proposalsLoading, proposals, startScanIfAllowed]);

  /* Blinking acting highlight when SunnyD is processing selection */
  useEffect(() => {
    if (selectionLoadingAction && selectionLoadingRange) {
      setActing(selectionLoadingRange.from, selectionLoadingRange.to);
    } else {
      clearActing();
    }
  }, [selectionLoadingAction, selectionLoadingRange, setActing, clearActing]);

  useProactiveInsertions(editor, noteType, {
    settleOn,
    startScan: startScanForNewContent,
    onThinkingChange: handleThinkingChange,
  });

  const addQuestionToNotes = useCallback(
    (insight: { from: number; to: number; insight: string; anchorText?: string }) => {
      if (!editor) return;
      const rawPos = editor.state.doc.resolve(insight.to).after();
      const insertPos = findSafeInsertionPoint(editor, rawPos);
      const safe = escapeHtml(insight.insight);
      const cardHtml = wrapInSunnyDCard(
        `<p class="sunnyd-crafting">${safe}</p>`
      );
      editor
        .chain()
        .insertContentAt(insertPos, cardHtml, {
          parseOptions: { preserveWhitespace: "full" },
        })
        .setMeta("addToHistory", true)
        .focus()
        .run();
      if (insight.anchorText) settleOn(insight.anchorText);
    },
    [editor, settleOn]
  );

  /* Initial scan when note loads with content (SunnyD level 2+) */
  useEffect(() => {
    if (!editor || !activeNote || level < 2) return;
    const wordCount = editor.state.doc.textContent.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 5) return;
    const t = setTimeout(() => startScanIfAllowed(), 3000);
    return () => clearTimeout(t);
  }, [activeNote?.id, editor, level, startScanIfAllowed]);

  useEffect(() => {
    if (!editor || !sunnyDEnabled("meetingMode") || noteType !== "MEETING") return;
    if (findActionItemsSectionPos(editor) !== null) return;
    const wordCount = editor.state.doc.textContent.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 10) return;
    const docEnd = getDocEndPos(editor);
    editor
      .chain()
      .insertContentAt(docEnd, "\n<h2>Action Items</h2>", {
        parseOptions: { preserveWhitespace: "full" },
      })
      .setMeta("addToHistory", true)
      .run();
  }, [editor, noteType, level]);

  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest(".sunnyd-quiz-reveal");
      if (btn) {
        const card = btn.closest(".sunnyd-card");
        const answer = card?.querySelector(".sunnyd-quiz-a");
        if (answer instanceof HTMLElement) {
          answer.style.display = "block";
          btn.textContent = "✓ Revealed";
          (btn as HTMLButtonElement).disabled = true;
        }
      }
    };
    scrollEl.addEventListener("click", onClick);
    return () => scrollEl.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) setIsDraggingFile(true);
    };
    const onDragLeave = () => setIsDraggingFile(false);
    const onDrop = () => setIsDraggingFile(false);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, []);

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (activeNote) updateNote(activeNote.id, { title: value });
    },
    [activeNote, updateNote]
  );

  const wordCount = editor?.state.doc.textContent.trim().split(/\s+/).filter(Boolean).length ?? 0;
  const readMinutes = wordCount === 0 ? 0 : Math.max(1, Math.round(wordCount / 200));

  const statusBarText =
    level === 0
      ? ""
      : proposalsLoading
        ? SUNNYD_STATUS.generatingProposal
        : connectionLoading
          ? SUNNYD_STATUS.findingConnections
          : marginLoading
            ? SUNNYD_STATUS.readingDoc
            : selectionLoading || slashLoading || patternLoading
              ? SUNNYD_STATUS.working
              : ghostStatus === "pending"
                ? SUNNYD_STATUS.ghostPending
                : ghostStatus === "ready"
                  ? needsVerifyStatistic
                    ? SUNNYD_STATUS.verifyNumber
                    : SUNNYD_STATUS.ghostPending
                  : SUNNYD_STATUS.idle;

  const isLoading =
    ghostStatus === "pending" ||
    selectionLoading ||
    slashLoading ||
    patternLoading ||
    marginLoading;
  const statusBarColor =
    ghostStatus === "ready" && !isLoading ? "text-accent" : "text-text-muted";

  if (!activeNote) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <button
          type="button"
          onClick={createNote}
          className="px-6 py-3 rounded-xl bg-accent/10 text-accent font-sans font-medium hover:bg-accent/20 transition-colors"
        >
          Create your first note
        </button>
      </div>
    );
  }

  return (
    <div
      ref={editorContainerRef}
      className="flex flex-col h-full min-h-0 w-full relative"
    >
      {/* Title bar */}
      <div className="flex items-center justify-between h-14 px-6 border-b border-border shrink-0 bg-surface/80 backdrop-blur-sm">
        <input
          type="text"
          value={activeNote.title}
          onChange={handleTitleChange}
          className="min-w-0 flex-1 font-sans text-xl font-semibold bg-transparent text-text placeholder:text-text-muted focus:outline-none truncate"
          placeholder="Untitled Note"
        />
        <div className="flex items-center gap-3">
          <LevelSelector />
          {level === 0 && (
            <span className="text-[11px] font-sans text-text-muted italic">
              SunnyD off · click 2 or 3 to enable
            </span>
          )}
          <AnimatePresence mode="wait">
            {sunnyDEnabled("noteTypeDetection") && (
              <NoteTypeBadge noteType={noteType} />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Editor — flex-1 min-h-0 ensures proper scroll: overflow-auto scrolls when content exceeds viewport */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex justify-center relative bg-bg"
      >
        {isDraggingFile && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-accent/5 backdrop-blur-[2px] pointer-events-none">
            <div className="rounded-xl border-2 border-dashed border-accent px-8 py-4 text-accent font-sans text-sm font-medium">
              Drop image to insert
            </div>
          </div>
        )}
        <div
          ref={editorContentRef}
          className="w-full max-w-[720px] min-w-0 bg-surface min-h-full relative shadow-sm overflow-x-hidden"
        >
          {thinkingDotTop != null && level > 0 && (
            <SunnyDThinkingDot top={thinkingDotTop} visible={true} />
          )}
          <EditorContent editor={editor} />
          {sunnyDEnabled("questionDetector") && (
            <>
              <QuestionAnswerPrompts
                editor={editor}
                containerRef={editorContentRef}
                questions={confirmedQuestions}
                answeringQuestion={answeringQuestion}
                onAnswer={answerQuestion}
              />
              {questionClickMenu && (
                <QuestionClickMenu
                  question={questionClickMenu.question}
                  x={questionClickMenu.x}
                  y={questionClickMenu.y}
                  containerRef={editorContentRef}
                  onAnswer={(q) => {
                    answerQuestion(q);
                    setQuestionClickMenu(null);
                  }}
                  onDismiss={(q) => {
                    dismissQuestion(q);
                    setQuestionClickMenu(null);
                  }}
                  onClose={() => setQuestionClickMenu(null)}
                />
              )}
            </>
          )}
          {sunnyDEnabled("proposalMarkers") && (
          <ProposalMarker
            editor={editor}
            containerRef={editorContentRef}
            proposals={proposals}
            onApply={applyProposal}
            onDismiss={dismissProposal}
          />
          )}
          {sunnyDEnabled("marginInsights") && (
          <MarginInsightsOverlay
            editor={editor}
            containerRef={editorContentRef}
            insights={marginInsights}
            loading={marginInsightsLoading}
            onAddQuestionToNotes={addQuestionToNotes}
          />
          )}
          {sunnyDEnabled("connectionSurfacing") && (
          <ConnectionIndicator connection={connection} />
          )}
        </div>
      </div>

      {sunnyDEnabled("structureSuggestion") && (
      <StructureSuggestion
        visible={showStructureSuggestion}
        onAccept={runStructureSuggestion}
        onDismiss={dismissStructureSuggestion}
      />
      )}

      <SelectionToolbar
        visible={toolbarVisible && !selectionLoading}
        position={toolbarPosition}
        loadingAction={selectionLoadingAction}
        onAction={runSelectionAction}
      />

      {sunnyDEnabled("selectionToolbar") && (
        <SunnyDResultPanel
          visible={resultPanel.visible}
          label={resultPanel.label}
          content={resultPanel.content}
          streaming={resultPanel.streaming}
          originalText={resultPanel.originalText}
          showDiff={resultPanel.showDiff}
          position={resultPanel.position}
          onApply={applyResult}
          onDiscard={discardResult}
          onCopy={copyResult}
        />
      )}

      <AnimatePresence>
        {actionItemsToast && (
          <motion.div
            key="action-items-toast"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="fixed bottom-16 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-surface px-4 py-2.5 text-sm font-sans text-text shadow-lg ring-1 ring-border"
          >
            {actionItemsToast}
          </motion.div>
        )}
      </AnimatePresence>

      <SlashCommandPicker
        visible={(slashState?.open ?? false) && !slashLoading}
        query={slashState?.query ?? ""}
        position={slashPosition}
        onSelect={executeSlashCommand}
        onClose={() => editor?.commands.closeSlashMenu?.()}
      />

      <div
        className={`absolute bottom-4 left-6 right-6 flex justify-between items-center text-[12px] font-sans ${
          level === 0 ? "text-text-muted" : statusBarColor
        } ${isLoading ? "animate-ai-pulse" : ""}`}
      >
        <span className="text-text-muted">
          {wordCount} words · {readMinutes} min read
        </span>
        {level > 0 && <span className={statusBarColor}>{statusBarText}</span>}
      </div>

      {level > 0 && !hasTyped && (!editor || editor.isEmpty) && (
        <p className="absolute bottom-12 left-1/2 -translate-x-1/2 text-xs font-sans text-text-muted">
          {SUNNYD.welcomeHint}
        </p>
      )}
    </div>
  );
}
