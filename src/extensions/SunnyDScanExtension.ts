import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const SunnyDScanKey = new PluginKey<{
  scanDecorations: DecorationSet;
  actingDecorations: DecorationSet;
  active: boolean;
}>("sunnyDScan");

export const SunnyDScanExtension = Extension.create({
  name: "sunnyDScan",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: SunnyDScanKey,
        state: {
          init: () => ({
            scanDecorations: DecorationSet.empty,
            actingDecorations: DecorationSet.empty,
            active: false,
          }),
          apply(tr, value) {
            const meta = tr.getMeta(SunnyDScanKey) as
              | { type: "SET_HIGHLIGHT"; from: number; to: number }
              | { type: "SET_ACTING"; from: number; to: number }
              | { type: "CLEAR_ACTING" }
              | { type: "CLEAR" }
              | undefined;

            if (!meta) {
              return {
                ...value,
                scanDecorations: value.scanDecorations.map(tr.mapping, tr.doc),
                actingDecorations: value.actingDecorations.map(tr.mapping, tr.doc),
              };
            }

            if (meta.type === "SET_HIGHLIGHT") {
              const { from, to } = meta;
              let scanDecorations = DecorationSet.empty;
              if (from < to && to <= tr.doc.content.size && from >= 0) {
                const deco = Decoration.inline(from, to, {
                  class: "sunnyd-scan-highlight",
                });
                scanDecorations = DecorationSet.create(tr.doc, [deco]);
              }
              return {
                ...value,
                scanDecorations,
                actingDecorations: value.actingDecorations.map(tr.mapping, tr.doc),
                active: true,
              };
            }

            if (meta.type === "SET_ACTING") {
              const { from, to } = meta;
              let actingDecorations = DecorationSet.empty;
              if (from < to && to <= tr.doc.content.size && from >= 0) {
                const deco = Decoration.inline(from, to, {
                  class: "sunnyd-acting-highlight",
                });
                actingDecorations = DecorationSet.create(tr.doc, [deco]);
              }
              return {
                ...value,
                actingDecorations,
                scanDecorations: value.scanDecorations.map(tr.mapping, tr.doc),
                active: true,
              };
            }

            if (meta.type === "CLEAR_ACTING") {
              return {
                ...value,
                actingDecorations: DecorationSet.empty,
              };
            }

            if (meta.type === "CLEAR") {
              return {
                scanDecorations: DecorationSet.empty,
                actingDecorations: DecorationSet.empty,
                active: false,
              };
            }

            return value;
          },
        },
        props: {
          decorations(state) {
            const pluginState = SunnyDScanKey.getState(state);
            if (!pluginState) return DecorationSet.empty;
            const { scanDecorations, actingDecorations } = pluginState;
            const actingArr = actingDecorations.find();
            return actingArr.length
              ? scanDecorations.add(state.doc, actingArr)
              : scanDecorations;
          },
        },
      }),
    ];
  },
});
