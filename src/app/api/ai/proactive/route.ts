import { NextRequest, NextResponse } from "next/server";
import openai from "@/lib/openai";
import { proactiveSystemPrompt } from "@/lib/prompts";

export type ProactiveInterventionType =
  | "CLARIFY"
  | "QUESTION"
  | "QUIZ"
  | "SUMMARIZE"
  | "GAP"
  | "CONNECT"
  | "PUSHBACK";

export interface ProactiveIntervention {
  type: ProactiveInterventionType;
  anchorText: string;
  insertPosition: "AFTER";
  content: string;
  label: string;
  confidence: number;
}

/**
 * Proactive document analysis — identifies 2-3 high-value insertion points.
 * Non-streaming, returns JSON array.
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ interventions: [] }, { status: 200 });
    }

    const body = await request.json();
    const { fullText = "", noteType = "GENERAL" } = body;

    if (typeof fullText !== "string" || fullText.trim().length < 50) {
      return NextResponse.json({ interventions: [] }, { status: 200 });
    }

    const systemPrompt = proactiveSystemPrompt(noteType, fullText);

    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Analyze and return interventions for this document.`,
          },
        ],
        max_tokens: 800,
        temperature: 0.4,
      },
      { signal: request.signal }
    );

    const raw =
      completion.choices[0]?.message?.content?.trim() ?? "[]";
    let interventions: ProactiveIntervention[] = [];
    try {
      const parsed = JSON.parse(raw);
      interventions = Array.isArray(parsed)
        ? parsed.filter(
            (x: ProactiveIntervention) =>
              x.confidence > 0.7 &&
              x.anchorText &&
              x.content &&
              x.type
          )
        : [];
    } catch {
      interventions = [];
    }

    return NextResponse.json({ interventions });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return NextResponse.json({ interventions: [] }, { status: 200 });
    }
    console.error("[api/ai/proactive]", err);
    return NextResponse.json({ interventions: [] }, { status: 200 });
  }
}
