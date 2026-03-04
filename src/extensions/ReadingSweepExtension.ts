import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const readingSweepPluginKey = new PluginKey<{
  sweeping: boolean;
  from: number;
  to: number;
}>("readingSweep");

/** Map character offset in doc.textContent to document position */
function textOffsetToDocPos(
  doc: import("@tiptap/pm/model").Node,
  targetOffset: number
): number | null {
  let offset = 0;
  let result: number | null = null;
  doc.descendants((node, pos) => {
    if (result !== null) return false;
    if (node.isText && node.text) {
      const len = node.text.length;
      if (offset + len > targetOffset) {
        result = pos + 1 + (targetOffset - offset);
        return false;
      }
      offset += len;
    }
    return true;
  });
  return result;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    readingSweep: {
      startReadingSweep: () => ReturnType;
      cancelReadingSweep: () => ReturnType;
    };
  }
}

const TOTAL_SCAN_MS = 2200;
const NUM_STEPS = 50;
const CHUNK_CHARS = 24;

/**
 * Word-by-word reading sweep: SunnyD highlights text as it "reads" through the doc.
 */
export const ReadingSweepExtension = Extension.create({
  name: "readingSweep",

  addCommands() {
    return {
      startReadingSweep:
        () =>
        ({ tr, state }) => {
          tr.setMeta(readingSweepPluginKey, { start: true });
          return true;
        },
      cancelReadingSweep:
        () =>
        ({ tr }) => {
          tr.setMeta(readingSweepPluginKey, { cancel: true });
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    let tickTimer: ReturnType<typeof setTimeout> | null = null;

    return [
      new Plugin({
        key: readingSweepPluginKey,
        state: {
          init: () => ({ sweeping: false, from: 0, to: 0 }),
          apply: (tr, value, _oldState, newState) => {
            const meta = tr.getMeta(readingSweepPluginKey) as
              | { start?: boolean; cancel?: boolean; advance?: { from: number; to: number } }
              | undefined;

            if (meta?.cancel) {
              return { sweeping: false, from: 0, to: 0 };
            }

            if (meta?.start) {
              const doc = newState.doc;
              const totalChars = doc.textContent.length;
              if (totalChars === 0) return value;
              return {
                sweeping: true,
                from: 0,
                to: Math.min(CHUNK_CHARS, totalChars),
              };
            }

            if (meta?.advance) {
              return {
                sweeping: true,
                from: meta.advance.from,
                to: meta.advance.to,
              };
            }

            if (tr.docChanged && value.sweeping) {
              return { sweeping: false, from: 0, to: 0 };
            }

            return value;
          },
        },
        props: {
          decorations: (state) => {
            const pluginState = readingSweepPluginKey.getState(state);
            if (!pluginState?.sweeping || pluginState.from >= pluginState.to) {
              return DecorationSet.empty;
            }
            const doc = state.doc;
            const fromPos = textOffsetToDocPos(doc, pluginState.from);
            const toPos = textOffsetToDocPos(doc, pluginState.to);
            if (fromPos === null || toPos === null || fromPos >= toPos) {
              return DecorationSet.empty;
            }
            return DecorationSet.create(doc, [
              Decoration.inline(fromPos, toPos, {
                class: "sunnyd-word-active",
              }),
            ]);
          },
        },
        view: (editorView) => {
          let stepIndex = 0;
          let totalChars = 0;

          const scheduleTick = () => {
            if (tickTimer) clearTimeout(tickTimer);
            const tickMs = Math.min(TOTAL_SCAN_MS / NUM_STEPS, 60);
            tickTimer = setTimeout(() => {
              tickTimer = null;
              const { state } = editorView;
              const pluginState = readingSweepPluginKey.getState(state);
              if (!pluginState?.sweeping) return;

              const doc = state.doc;
              totalChars = doc.textContent.length;
              if (totalChars === 0) {
                editorView.dispatch(
                  state.tr.setMeta(readingSweepPluginKey, { cancel: true })
                );
                return;
              }

              stepIndex += 1;
              const stepSize = totalChars / NUM_STEPS;
              const charOffset = Math.floor(stepIndex * stepSize);
              const chunkEnd = Math.min(charOffset + CHUNK_CHARS, totalChars);

              if (charOffset >= totalChars || stepIndex >= NUM_STEPS) {
                editorView.dispatch(
                  state.tr.setMeta(readingSweepPluginKey, { cancel: true })
                );
                return;
              }

              editorView.dispatch(
                state.tr.setMeta(readingSweepPluginKey, {
                  advance: {
                    from: charOffset,
                    to: chunkEnd,
                  },
                })
              );

              scheduleTick();
            }, tickMs);
          };

          return {
            update: (view, prevState) => {
              const pluginState = readingSweepPluginKey.getState(view.state);
              const prevPluginState = readingSweepPluginKey.getState(prevState);
              if (pluginState?.sweeping && !prevPluginState?.sweeping) {
                stepIndex = 0;
                scheduleTick();
              }
              if (!pluginState?.sweeping && tickTimer) {
                clearTimeout(tickTimer);
                tickTimer = null;
              }
            },
            destroy: () => {
              if (tickTimer) clearTimeout(tickTimer);
            },
          };
        },
      }),
    ];
  },
});
