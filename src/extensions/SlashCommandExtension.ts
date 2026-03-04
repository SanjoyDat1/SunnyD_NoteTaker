import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    slashCommand: {
      closeSlashMenu: () => ReturnType;
      deleteSlashLine: () => ReturnType;
    };
  }
}

export interface SlashState {
  open: boolean;
  query: string;
  from: number;
  to: number;
}

export const slashCommandPluginKey = new PluginKey<SlashState>("slashCommand");

export interface SlashCommandOptions {
  /** Called when slash state changes (for React to render picker) */
  onStateChange?: (state: SlashState) => void;
}

/**
 * Tiptap extension for slash commands.
 * Detects / at line start, tracks query as user types, exposes state for picker UI.
 */
export const SlashCommandExtension = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      onStateChange: undefined,
    };
  },

  addCommands() {
    return {
      closeSlashMenu:
        () =>
        ({ state, chain }) => {
          const pluginState = slashCommandPluginKey.getState(state);
          if (pluginState?.open) {
            return chain()
              .deleteRange({ from: pluginState.from, to: pluginState.to })
              .setMeta(slashCommandPluginKey, { open: false })
              .run();
          }
          return false;
        },

      deleteSlashLine:
        () =>
        ({ state }) => {
          const pluginState = slashCommandPluginKey.getState(state);
          if (!pluginState?.open) return false;
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Escape: () => {
        const state = slashCommandPluginKey.getState(this.editor.state);
        if (state?.open) {
          this.editor.commands.closeSlashMenu();
          return true;
        }
        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const onStateChange = this.options.onStateChange;

    return [
      new Plugin({
        key: slashCommandPluginKey,
        state: {
          init: () => ({ open: false, query: "", from: 0, to: 0 }),
          apply: (tr, value, _oldState, newState) => {
            const meta = tr.getMeta(slashCommandPluginKey);
            if (meta && "open" in meta) {
              return {
                open: meta.open ?? false,
                query: meta.query ?? "",
                from: meta.from ?? 0,
                to: meta.to ?? 0,
              };
            }

            if (!tr.docChanged && !tr.selectionSet) return value;

            const { from } = newState.selection;
            const doc = newState.doc;
            const $from = doc.resolve(from);

            const lineStart = $from.start();
            const lineEnd = $from.end();
            const lineText = doc.textBetween(lineStart, lineEnd, "\n");

            if (lineText.startsWith("/") && from >= lineStart) {
              const query = lineText.slice(1, from - lineStart);
              return {
                open: true,
                query,
                from: lineStart,
                to: lineEnd,
              };
            }

            return { open: false, query: "", from: 0, to: 0 };
          },
        },
        view: () => ({
          update: (view) => {
            const pluginState = slashCommandPluginKey.getState(view.state);
            if (pluginState && onStateChange) {
              onStateChange(pluginState);
            }
          },
          destroy: () => {},
        }),
      }),
    ];
  },
});
