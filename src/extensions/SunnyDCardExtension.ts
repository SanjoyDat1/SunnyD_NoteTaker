import { Node, mergeAttributes } from "@tiptap/core";

export interface SunnyDCardOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    sunnyDCard: {
      insertSunnyDCard: (content: string) => ReturnType;
      promoteSunnyDCard: () => ReturnType;
    };
  }
}

export const SunnyDCardExtension = Node.create<SunnyDCardOptions>({
  name: "sunnyDCard",

  group: "block",

  content: "block+",

  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      promoted: {
        default: false,
        parseHTML: (el) => (el as HTMLElement).hasAttribute("data-promoted"),
        renderHTML: (attrs) =>
          attrs.promoted ? { "data-promoted": "" } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="sunnyd-card"]',
      },
      {
        tag: 'div.sunnyd-card',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(
        { "data-type": "sunnyd-card", class: "sunnyd-card" },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      0,
    ];
  },

  addNodeView() {
    return ({ editor, node, getPos }) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-type", "sunnyd-card");
      dom.className = node.attrs.promoted ? "sunnyd-card promoted" : "sunnyd-card";

      const content = document.createElement("div");
      content.className = "sunnyd-card-content";
      content.style.cssText = "position: relative;";

      const btnGroup = document.createElement("span");
      btnGroup.className = "sunnyd-card-buttons";
      btnGroup.style.cssText =
        "position: absolute; top: 8px; right: 10px; opacity: 0; transition: opacity 150ms; display: flex; gap: 4px;";

      const promote = document.createElement("button");
      promote.className = "sunnyd-card-dismiss";
      promote.setAttribute("type", "button");
      promote.setAttribute("aria-label", "Promote to your notes");
      promote.textContent = "↑";
      promote.title = "Promote to your notes (Cmd+Enter)";
      promote.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        editor.commands.promoteSunnyDCard();
      };

      const dismiss = document.createElement("button");
      dismiss.className = "sunnyd-card-dismiss";
      dismiss.setAttribute("type", "button");
      dismiss.setAttribute("aria-label", "Dismiss");
      dismiss.textContent = "✕";
      dismiss.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (pos !== undefined && pos >= 0) {
          const from = pos;
          const to = pos + node.nodeSize;
          editor.commands.command(({ tr, dispatch }) => {
            tr.delete(from, to);
            dispatch?.(tr);
            return true;
          });
        }
      };

      btnGroup.append(promote, dismiss);
      dom.append(content, btnGroup);

      return {
        dom,
        contentDOM: content,
        update: (updatedNode) => {
          dom.className = updatedNode.attrs.promoted
            ? "sunnyd-card promoted"
            : "sunnyd-card";
          return true;
        },
      };
    };
  },

  addCommands() {
    return {
      insertSunnyDCard:
        (content: string) =>
        ({ chain }) =>
          chain()
            .insertContent(`<div data-type="sunnyd-card" class="sunnyd-card">${content}</div>`, {
              parseOptions: { preserveWhitespace: "full" },
            })
            .run(),

      promoteSunnyDCard:
        () =>
        ({ state, dispatch }) => {
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name === "sunnyDCard") {
              const pos = $from.before(d);
              const end = pos + node.nodeSize;
              const slice = state.doc.slice(pos + 1, end - 1);
              const tr = state.tr.replaceWith(pos, end, slice.content);
              dispatch?.(tr);
              return true;
            }
          }
          return false;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () =>
        this.editor.commands.promoteSunnyDCard(),
      "Mod-Backspace": () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d);
          if (node.type.name === "sunnyDCard") {
            return this.editor.commands.deleteNode("sunnyDCard");
          }
        }
        return false;
      },
    };
  },
});

export default SunnyDCardExtension;
