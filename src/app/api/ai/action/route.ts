import { NextRequest, NextResponse } from "next/server";
import openai from "@/lib/openai";
import {
  selectionActionSystemPrompt,
  selectionActionUserMessages,
  questionAnswerPrompts,
} from "@/lib/prompts";
import { extractStyleFingerprintFromText } from "@/lib/context";

/**
 * Selection action endpoint.
 * Model: gpt-4o, streaming, max 500 tokens.
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return new Response("", { status: 200 });
    }

    const body = await request.json();
    const {
      action,
      selectedText,
      surroundingContext = "",
      noteType = "GENERAL",
      questionType,
      documentText = "",
      expandType,
    } = body;

    const fingerprint = extractStyleFingerprintFromText(
      documentText || surroundingContext
    );

    if (
      typeof action !== "string" ||
      typeof selectedText !== "string" ||
      !selectedText.trim()
    ) {
      return NextResponse.json(
        { error: "action and selectedText are required" },
        { status: 400 }
      );
    }

    let userContent: string;
    if (
      action.toLowerCase() === "answer" &&
      questionType &&
      questionAnswerPrompts[questionType]
    ) {
      userContent = questionAnswerPrompts[questionType](
        selectedText,
        surroundingContext,
        documentText || surroundingContext,
        fingerprint
      );
    } else {
      const key = action.toLowerCase();
      const userMessageFn = selectionActionUserMessages[key];
      const extra =
        action.toLowerCase() === "expand" && expandType
          ? { expandType: String(expandType) }
          : undefined;
      userContent = userMessageFn
        ? userMessageFn(selectedText, surroundingContext, extra)
        : `Transform this text:\n\n${selectedText}`;
    }

    const stream = await openai.chat.completions.create(
      {
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: selectionActionSystemPrompt(noteType, surroundingContext),
          },
          { role: "user", content: userContent },
        ],
        max_tokens: 500,
        temperature: 0.4,
        stream: true,
      },
      { signal: request.signal }
    );

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content ?? "";
            if (text) {
              controller.enqueue(new TextEncoder().encode(text));
            }
          }
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            console.error("[api/ai/action]", err);
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return new Response("", { status: 200 });
    }
    return new Response("", { status: 200 });
  }
}
