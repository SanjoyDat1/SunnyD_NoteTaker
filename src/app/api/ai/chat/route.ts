import { NextRequest, NextResponse } from "next/server";
import openai from "@/lib/openai";
import { extractStyleFingerprintFromText } from "@/lib/context";

/**
 * Conversational follow-up for SunnyD question answers.
 * Accepts { messages, noteContext, questionText } and streams the response.
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "API not configured" }, { status: 503 });
    }

    const body = await request.json();
    const {
      messages = [],
      noteContext = "",
      questionText = "",
      noteType = "GENERAL",
    } = body;

    const fingerprint = extractStyleFingerprintFromText(noteContext);

    const systemContent = `You are SunnyD, an AI embedded in a note-taking app. The user asked a question about their notes, and you're now in a follow-up chat about that question.

Original question: ${questionText}
Note context: ${noteContext.slice(0, 800)}

Be concise, match the user's style, and stay on topic. If you cannot add value, say so briefly. Max 150 words per response.
${fingerprint ? `Style: Match avg sentence length ~${fingerprint.avgSentenceLength} words, ${fingerprint.formality} formality.` : ""}`.trim();

    const openaiMessages = [
      { role: "system" as const, content: systemContent },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    const stream = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: openaiMessages,
        max_tokens: 300,
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
            console.error("[api/ai/chat]", err);
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
    return NextResponse.json(
      { error: "Chat failed" },
      { status: 500 }
    );
  }
}
