import { NextRequest, NextResponse } from "next/server";
import openai from "@/lib/openai";
import {
  slashCommandSystemPrompt,
  slashCommandPrompts,
} from "@/lib/prompts";
import { extractStyleFingerprintFromText } from "@/lib/context";

/**
 * Slash command endpoint.
 * Model: gpt-4o, streaming, max 400 tokens.
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return new Response("", { status: 200 });
    }

    const body = await request.json();
    const {
      command,
      argument,
      documentContent = "",
      cursorContext = "",
      precedingParagraph = "",
      noteType = "GENERAL",
    } = body;

    if (typeof command !== "string" || !command.trim()) {
      return NextResponse.json(
        { error: "command is required" },
        { status: 400 }
      );
    }

    const commandKey = command.split(/\s/)[0]?.toLowerCase() ?? command;
    const promptFn = slashCommandPrompts[commandKey];
    const fingerprint = extractStyleFingerprintFromText(documentContent);

    const context: Record<string, string> = {
      documentContent,
      cursorContext,
      precedingParagraph,
      noteType,
      argument: typeof argument === "string" ? argument : "",
    };

    const userContent = promptFn
      ? promptFn(context)
      : `Execute command "${command}":\n\nDocument: ${documentContent}\n\nContext: ${cursorContext}`;

    const stream = await openai.chat.completions.create(
      {
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: slashCommandSystemPrompt(noteType, documentContent, fingerprint),
          },
          { role: "user", content: userContent },
        ],
        max_tokens: 400,
        temperature: 0.5,
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
            console.error("[api/ai/slash]", err);
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
