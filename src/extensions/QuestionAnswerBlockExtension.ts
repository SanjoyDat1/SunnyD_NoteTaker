import { Node, mergeAttributes } from "@tiptap/core";
import { markdownToHtml } from "@/lib/utils";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface QuestionAnswerBlockOptions {
  noteContext?: () => string;
  noteType?: () => string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    questionAnswerBlock: {
      appendChatMessage: (
        pos: number,
        role: "user" | "assistant",
        content: string
      ) => ReturnType;
    };
  }
}

export const QuestionAnswerBlockExtension = Node.create<QuestionAnswerBlockOptions>({
  name: "questionAnswerBlock",

  group: "block",

  content: "block*",

  defining: true,

  addOptions() {
    return {
      noteContext: undefined,
      noteType: undefined,
    };
  },

  addAttributes() {
    return {
      questionText: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-question-text") ?? "",
        renderHTML: (attrs) =>
          attrs.questionText ? { "data-question-text": attrs.questionText } : {},
      },
      initialAnswer: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-initial-answer") ?? "",
        renderHTML: (attrs) =>
          attrs.initialAnswer ? { "data-initial-answer": attrs.initialAnswer } : {},
      },
      messages: {
        default: "[]",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-messages") ?? "[]",
        renderHTML: (attrs) =>
          attrs.messages ? { "data-messages": attrs.messages } : {},
      },
      noteType: {
        default: "GENERAL",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-note-type") ?? "GENERAL",
        renderHTML: (attrs) =>
          attrs.noteType ? { "data-note-type": attrs.noteType } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="question-answer-block"]',
        getAttrs: (el) => ({
          questionText: (el as HTMLElement).getAttribute("data-question-text") ?? "",
          initialAnswer: (el as HTMLElement).getAttribute("data-initial-answer") ?? "",
          messages: (el as HTMLElement).getAttribute("data-messages") ?? "[]",
          noteType: (el as HTMLElement).getAttribute("data-note-type") ?? "GENERAL",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "question-answer-block",
        class: "question-answer-block",
      }),
    ];
  },

  addNodeView() {
    const opts = this.options;
    return ({ editor, node, getPos }) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-type", "question-answer-block");
      dom.className =
        "question-answer-block sunnyd-card border-l-2 border-[rgba(45,106,79,0.3)] rounded-r-lg";

      const answerBody = document.createElement("div");
      answerBody.className = "question-answer-body";
      answerBody.innerHTML = node.attrs.initialAnswer || "<p>No answer yet.</p>";

      const chatSection = document.createElement("div");
      chatSection.className = "question-answer-chat";

      const chatHeader = document.createElement("div");
      chatHeader.className =
        "flex items-center gap-2 py-2 mt-3 border-t border-border/60 text-[11px] font-medium uppercase tracking-wider text-[rgba(45,106,79,0.8)]";
      chatHeader.innerHTML = '✦ <span>Chat with SunnyD</span>';

      const messagesContainer = document.createElement("div");
      messagesContainer.className =
        "question-answer-messages space-y-2 max-h-[160px] overflow-y-auto py-2";

      const inputRow = document.createElement("div");
      inputRow.className = "flex gap-2 pt-2";

      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Ask a follow-up...";
      input.className =
        "flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-[rgba(45,106,79,0.3)]";

      const sendBtn = document.createElement("button");
      sendBtn.type = "button";
      sendBtn.textContent = "Send";
      sendBtn.className =
        "px-3 py-2 text-sm font-medium rounded-lg bg-[rgba(45,106,79,0.15)] text-[#2d6a4f] hover:bg-[rgba(45,106,79,0.22)] transition-colors";

      function parseMessages(): ChatMessage[] {
        try {
          return JSON.parse(node.attrs.messages || "[]");
        } catch {
          return [];
        }
      }

      function renderMessages() {
        messagesContainer.innerHTML = "";
        const msgs = parseMessages();
        for (const m of msgs) {
          const bubble = document.createElement("div");
          bubble.className =
            m.role === "user"
              ? "text-right"
              : "text-left";
          const inner = document.createElement("div");
          inner.className =
            m.role === "user"
              ? "inline-block text-left px-3 py-2 rounded-lg bg-[rgba(45,106,79,0.12)] text-sm max-w-[85%]"
              : "inline-block text-left px-3 py-2 rounded-lg bg-[rgba(45,106,79,0.06)] text-sm max-w-[85%] border-l-2 border-[rgba(45,106,79,0.4)]";
          if (m.role === "assistant") {
            inner.innerHTML = markdownToHtml(m.content);
            inner.style.lineHeight = "1.5";
          } else {
            inner.textContent = m.content;
          }
          inner.style.whiteSpace = "pre-wrap";
          inner.style.wordBreak = "break-word";
          bubble.appendChild(inner);
          messagesContainer.appendChild(bubble);
        }
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }

      renderMessages();

      async function sendMessage() {
        const text = input.value.trim();
        if (!text) return;

        input.value = "";
        sendBtn.disabled = true;
        sendBtn.textContent = "…";

        const msgs = parseMessages();
        msgs.push({ role: "user", content: text });
        messagesContainer.innerHTML += "";
        renderMessages();

        const pos = typeof getPos === "function" ? getPos() : -1;
        if (pos < 0) {
          sendBtn.disabled = false;
          sendBtn.textContent = "Send";
          return;
        }

        try {
          const res = await fetch("/api/ai/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: msgs,
              noteContext: opts.noteContext?.() ?? editor.state.doc.textContent,
              questionText: node.attrs.questionText,
              noteType: node.attrs.noteType ?? opts.noteType?.() ?? "GENERAL",
            }),
          });

          if (!res.ok || !res.body) {
            msgs.push({
              role: "assistant",
              content: "Sorry, I couldn't respond.",
            });
          } else {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let assistantText = "";
            const tempBubble = document.createElement("div");
            tempBubble.className = "text-left";
            const tempInner = document.createElement("div");
            tempInner.className =
              "inline-block text-left px-3 py-2 rounded-lg bg-[rgba(45,106,79,0.06)] text-sm max-w-[85%] border-l-2 border-[rgba(45,106,79,0.4)]";
            tempInner.style.whiteSpace = "pre-wrap";
            tempInner.style.wordBreak = "break-word";
            tempBubble.appendChild(tempInner);
            messagesContainer.appendChild(tempBubble);

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              assistantText += decoder.decode(value, { stream: true });
              tempInner.textContent = assistantText;
              messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }

            msgs.push({ role: "assistant", content: assistantText.trim() });
          }

          const newMessages = JSON.stringify(msgs);
          editor.commands.command(({ tr, state }) => {
            const $pos = state.doc.resolve(pos);
            const nodeAt = $pos.nodeAfter;
            if (nodeAt && nodeAt.type.name === "questionAnswerBlock") {
              tr.setNodeMarkup(pos, undefined, {
                ...nodeAt.attrs,
                messages: newMessages,
              });
              return true;
            }
            return false;
          });
        } catch {
          msgs.push({
            role: "assistant",
            content: "Something went wrong. Try again.",
          });
          const newMessages = JSON.stringify(msgs);
          editor.commands.command(({ tr, state }) => {
            const $pos = state.doc.resolve(pos);
            const nodeAt = $pos.nodeAfter;
            if (nodeAt && nodeAt.type.name === "questionAnswerBlock") {
              tr.setNodeMarkup(pos, undefined, {
                ...nodeAt.attrs,
                messages: newMessages,
              });
              return true;
            }
            return false;
          });
        }

        sendBtn.disabled = false;
        sendBtn.textContent = "Send";
        renderMessages();
      }

      sendBtn.onclick = () => sendMessage();
      input.onkeydown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      };

      inputRow.appendChild(input);
      inputRow.appendChild(sendBtn);
      chatSection.appendChild(chatHeader);
      chatSection.appendChild(messagesContainer);
      chatSection.appendChild(inputRow);

      dom.appendChild(answerBody);
      dom.appendChild(chatSection);

      return {
        dom,
        contentDOM: null,
        update: (updatedNode) => {
          if (updatedNode.attrs.initialAnswer !== node.attrs.initialAnswer) {
            answerBody.innerHTML = updatedNode.attrs.initialAnswer || "<p></p>";
          }
          node = updatedNode;
          renderMessages();
          return true;
        },
      };
    };
  },

  addCommands() {
    return {
      appendChatMessage:
        (pos: number, role: "user" | "assistant", content: string) =>
        ({ state, tr }) => {
          const $pos = state.doc.resolve(pos);
          const node = $pos.nodeAfter;
          if (!node || node.type.name !== "questionAnswerBlock") return false;
          const msgs: ChatMessage[] = JSON.parse(node.attrs.messages || "[]");
          msgs.push({ role, content });
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            messages: JSON.stringify(msgs),
          });
          return true;
        },
    };
  },
});
