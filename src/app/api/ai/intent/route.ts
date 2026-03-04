import { NextRequest, NextResponse } from "next/server";
import openai from "@/lib/openai";
import {
  intentClassificationPrompt,
  intentFulfillPrompts,
} from "@/lib/prompts";
import { extractStyleFingerprintFromText } from "@/lib/context";

const INTENT_LABELS = [
  "CONTINUE",
  "NEEDS_EXAMPLE",
  "NEEDS_WHY",
  "NEEDS_CONTEXT",
  "NEEDS_OPPOSITE",
  "NEEDS_STEP",
  "NEEDS_NUMBER",
  "NEEDS_LINK",
  "DONE",
];

/**
 * Two-stage intent prediction: classify → fulfill.
 * Replaces autocomplete with "what would a brilliant friend do?"
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { result: "", needsVerifyStatistic: false },
        { status: 200 }
      );
    }

    const body = await request.json();
    const {
      documentText = "",
      last600chars = "",
      lastSentence = "",
      last300chars = "",
      currentList = "",
      relevantEarlier = "",
      documentSummary = "",
      noteType = "GENERAL",
      cachedIntent,
      fullIntentSuite = true,
      hideStatisticFlag = false,
    } = body;

    const fingerprint = extractStyleFingerprintFromText(documentText);

    let intent = cachedIntent;

    if (!intent || !INTENT_LABELS.includes(intent)) {
      const classifyRes = await openai.chat.completions.create(
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: intentClassificationPrompt(
                noteType,
                documentText,
                last600chars,
                fingerprint
              ),
            },
            { role: "user", content: "Classify the intent." },
          ],
          max_tokens: 20,
          temperature: 0.2,
          stream: false,
        },
        { signal: request.signal }
      );
      intent =
        classifyRes.choices[0]?.message?.content?.trim()?.toUpperCase() ?? "";
      const match = INTENT_LABELS.find((l) => intent?.startsWith(l));
      intent = match ?? "CONTINUE";
    }

    const EXCLUDED_AT_SUBTLE = ["NEEDS_OPPOSITE", "NEEDS_LINK"];
    if (intent === "DONE" || (!fullIntentSuite && EXCLUDED_AT_SUBTLE.includes(intent))) {
      return NextResponse.json({
        result: "",
        intent,
        needsVerifyStatistic: false,
      });
    }

    const promptFn = intentFulfillPrompts[intent] ?? intentFulfillPrompts.CONTINUE;
    const params = {
      last600: last600chars,
      lastSentence: lastSentence || last600chars.slice(-200),
      last300: last300chars || last600chars.slice(-150),
      currentList,
      relevantEarlier,
      documentSummary: documentSummary || documentText.slice(0, 300),
      noteType,
      styleFingerprint: fingerprint,
    };

    const fulfillRes = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: promptFn(params) },
          { role: "user", content: "Generate the response." },
        ],
        max_tokens: 80,
        temperature: 0.3,
        stream: false,
      },
      { signal: request.signal }
    );

    const result =
      fulfillRes.choices[0]?.message?.content?.trim() ?? "";

    return NextResponse.json({
      result,
      intent,
      needsVerifyStatistic: !hideStatisticFlag && intent === "NEEDS_NUMBER",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return NextResponse.json(
        { result: "", needsVerifyStatistic: false },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { result: "", needsVerifyStatistic: false },
      { status: 200 }
    );
  }
}
