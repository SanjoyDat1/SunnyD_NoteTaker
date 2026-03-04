import type { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    setGhostText: {
      setGhostText: (text: string) => ReturnType;
    };
    clearGhostText: {
      clearGhostText: () => ReturnType;
    };
    insertGhostText: {
      insertGhostText: () => ReturnType;
    };
  }
}

export const ghostTextPluginKey = new PluginKey<{ ghostText: string }>(
  "ghostText"
);

/** Read current ghost text from editor state (for status bar, etc.) */
export function getGhostTextFromEditor(editor: Editor): string {
  const pluginState = ghostTextPluginKey.getState(editor.state);
  return pluginState?.ghostText ?? "";
}

export interface GhostTextOptions {
  /** Called when user accepts the full ghost suggestion (Tab) */
  onGhostAccepted?: () => void;
}

/**
 * Tiptap extension for inline ghost text completions.
 * Displays suggested text at the cursor; Tab accepts all, ArrowRight accepts one word, Escape dismisses.
 */
export const GhostTextExtension = Extension.create<GhostTextOptions>({
  name: "ghostText",

  addOptions() {
    return {
      onGhostAccepted: undefined,
    };
  },

  addCommands() {
    return {
      setGhostText:
        (text: string) =>
        ({ tr, state }) => {
          tr.setMeta(ghostTextPluginKey, { ghostText: text });
          return true;
        },

      clearGhostText:
        () =>
        ({ tr }) => {
          tr.setMeta(ghostTextPluginKey, { ghostText: "" });
          return true;
        },

      insertGhostText:
        () =>
        ({ chain, state }) => {
          const pluginState = ghostTextPluginKey.getState(state);
          const ghostText = pluginState?.ghostText ?? "";
          if (!ghostText.trim()) return false;
          return chain().insertContent(ghostText).clearGhostText().run();
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const inserted = this.editor.commands.insertGhostText();
        if (inserted) this.options.onGhostAccepted?.();
        return inserted;
      },

      ArrowRight: () => {
        const pluginState = ghostTextPluginKey.getState(this.editor.state);
        const ghostText = pluginState?.ghostText ?? "";
        if (!ghostText.trim()) return false;

        const match = ghostText.match(/^(\S+\s*)/);
        const firstWord = match ? match[1] : ghostText;
        const rest = ghostText.slice(firstWord.length);

        if (rest) {
          this.editor
            .chain()
            .insertContent(firstWord)
            .setGhostText(rest)
            .run();
        } else {
          this.editor.chain().insertContent(firstWord).clearGhostText().run();
          this.options.onGhostAccepted?.(); // Cooldown after full accept
        }
        return true;
      },

      Escape: () => {
        const pluginState = ghostTextPluginKey.getState(this.editor.state);
        if (pluginState?.ghostText) {
          this.editor.commands.clearGhostText();
          return true;
        }
        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: ghostTextPluginKey,
        state: {
          init: () => ({ ghostText: "" }),
          apply: (tr, value) => {
            const meta = tr.getMeta(ghostTextPluginKey);
            if (meta !== undefined) {
              return { ghostText: meta.ghostText ?? "" };
            }
            return value;
          },
        },
        props: {
          decorations: (state) => {
            const pluginState = ghostTextPluginKey.getState(state);
            const ghostText = pluginState?.ghostText ?? "";
            const { from, to, empty } = state.selection;

            if (!ghostText.trim() || !empty) {
              return DecorationSet.empty;
            }

            const widget = Decoration.widget(
              from,
              () => {
                const span = document.createElement("span");
                span.className = "ghost-text";
                span.style.cssText =
                  "color: var(--ghost); font-style: italic; pointer-events: none; user-select: none;";
                span.textContent = ghostText;
                return span;
              },
              { key: `ghost-${ghostText.slice(0, 20)}`, side: 1 }
            );

            return DecorationSet.create(state.doc, [widget]);
          },
        },
      }),
    ];
  },
});

export default GhostTextExtension;
