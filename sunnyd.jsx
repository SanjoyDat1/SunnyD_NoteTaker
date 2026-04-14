import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import { saveAs } from "file-saver";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/* ─── LLM: OpenAI · Claude · Gemini ─────────────────────────────────────── */
// Lightest/fastest model per provider as of March 2026
const LLM_CONFIG = {
  openai: { model: "gpt-4o-mini" },
  claude: { model: "claude-haiku-4-5" },       // Claude's fastest model
  gemini: { model: "gemini-2.0-flash-lite" },   // Gemini's fastest GA model
};

async function ai(provider, apiKey, system, user, max = 900) {
  if (!apiKey?.trim()) throw new Error("API key required");

  // ── OpenAI ────────────────────────────────────────────────────────────────
  if (provider === "openai") {
    let r, d;
    try {
      r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: LLM_CONFIG.openai.model,
          max_tokens: max,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
      });
    } catch (e) { throw new Error("OpenAI: network error — " + e.message); }
    try { d = await r.json(); } catch { throw new Error("OpenAI: invalid JSON response"); }
    if (!r.ok) throw new Error("OpenAI: " + (d.error?.message || `HTTP ${r.status}`));
    return d.choices?.[0]?.message?.content?.trim() || "";
  }

  // ── Claude ────────────────────────────────────────────────────────────────
  // IMPORTANT: "anthropic-dangerous-direct-browser-access" is REQUIRED for any
  // browser → api.anthropic.com call; without it the preflight OPTIONS request
  // is rejected and the browser throws "Failed to fetch" (CORS error).
  if (provider === "claude") {
    let r, d;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: LLM_CONFIG.claude.model,
          max_tokens: max,
          system,
          messages: [{ role: "user", content: [{ type: "text", text: user }] }],
        }),
      });
    } catch (e) { throw new Error("Claude: network error — " + e.message); }
    try { d = await r.json(); } catch { throw new Error("Claude: invalid JSON response"); }
    if (!r.ok) throw new Error("Claude: " + (d.error?.message || `HTTP ${r.status}`));
    return d.content?.[0]?.text?.trim() || "";
  }

  // ── Gemini ────────────────────────────────────────────────────────────────
  // API key goes in the URL query string — no Authorization header needed.
  // generativelanguage.googleapis.com supports browser CORS natively.
  if (provider === "gemini") {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${LLM_CONFIG.gemini.model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    let r, d;
    try {
      r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: max },
        }),
      });
    } catch (e) { throw new Error("Gemini: network error — " + e.message); }
    try { d = await r.json(); } catch { throw new Error("Gemini: invalid JSON response"); }
    if (!r.ok) throw new Error("Gemini: " + (d.error?.message || `HTTP ${r.status}`));
    return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  }

  throw new Error("Unknown provider: " + provider);
}

/* ─── Study podcast (dialogue TTS, browser-only) ──────────────────────────── */

const PODCAST_TTS_MODEL_PRIMARY = "gpt-4o-mini-tts";
const PODCAST_TTS_MODEL_FALLBACK = "tts-1-hd";
const PODCAST_TTS_MAX_INPUT = 4096;
const PODCAST_CHUNK_SOFT = 3800;
/** Kokoro tokenizer is tight — keep chunks small for on-device open-source TTS */
const KOKORO_TEXT_CHUNK = 420;
/** SunnyD Cast hosts: female (OpenAI) / male (OpenAI) */
const SUNNYD_OPENAI_VOICE_FEMALE = "nova";
const SUNNYD_OPENAI_VOICE_MALE = "onyx";
/** Kokoro-82M (Apache-2.0): strong female/male American pair from model card */
const SUNNYD_KOKORO_VOICE_FEMALE = "af_bella";
const SUNNYD_KOKORO_VOICE_MALE = "am_michael";

let sunnydKokoroTtsPromise = null;

function getStoredOpenAIKey() {
  try {
    return (sessionStorage.getItem("sd_key_openai") || "").trim();
  } catch {
    return "";
  }
}

function resolveOpenAIKeyForTTS(llmProvider, currentApiKey) {
  const openaiStored = getStoredOpenAIKey();
  if (openaiStored) return openaiStored;
  if (llmProvider === "openai" && currentApiKey?.trim()) return currentApiKey.trim();
  return "";
}

function splitTextForTTS(text, maxLen = PODCAST_CHUNK_SOFT) {
  const t = (text || "").trim();
  if (!t) return [];
  if (t.length <= maxLen) return [t];
  const parts = [];
  let rest = t;
  while (rest.length > 0) {
    if (rest.length <= maxLen) {
      parts.push(rest);
      break;
    }
    let cut = rest.lastIndexOf(". ", maxLen);
    if (cut < Math.floor(maxLen * 0.45)) cut = rest.lastIndexOf("! ", maxLen);
    if (cut < Math.floor(maxLen * 0.45)) cut = rest.lastIndexOf("? ", maxLen);
    if (cut < Math.floor(maxLen * 0.45)) cut = rest.lastIndexOf("\n", maxLen);
    if (cut < Math.floor(maxLen * 0.45)) cut = rest.lastIndexOf(" ", maxLen);
    if (cut < 80) cut = maxLen;
    const chunk = rest.slice(0, cut + 1).trim();
    parts.push(chunk);
    rest = rest.slice(cut + 1).trim();
  }
  return parts.filter(Boolean);
}

async function openaiCreateSpeech(apiKey, input, voice, instructions, signal) {
  const trimmed = (input || "").trim().slice(0, PODCAST_TTS_MAX_INPUT);
  if (!trimmed) throw new Error("Empty TTS input");

  const tryOnce = async (model, useInstructions) => {
    const body = {
      model,
      input: trimmed,
      voice,
      response_format: "mp3",
    };
    if (useInstructions && instructions?.trim()) body.instructions = instructions.trim().slice(0, 450);
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try {
        const err = await r.json();
        msg = err.error?.message || msg;
      } catch {
        try { msg = (await r.text()).slice(0, 180); } catch {}
      }
      throw new Error(msg);
    }
    return r.arrayBuffer();
  };

  try {
    return await tryOnce(PODCAST_TTS_MODEL_PRIMARY, true);
  } catch (e) {
    if (signal?.aborted) throw e;
    const em = String(e?.message || "").toLowerCase();
    if (em.includes("401") || em.includes("invalid_api_key") || em.includes("incorrect api key")) throw e;
    return tryOnce(PODCAST_TTS_MODEL_FALLBACK, false);
  }
}

function float32SamplesToAudioBuffer(ctx, float32, sampleRate) {
  const b = ctx.createBuffer(1, float32.length, sampleRate);
  b.getChannelData(0).set(float32);
  return b;
}

/** Load Kokoro TTS once per session (open-source, runs in-browser via Transformers.js). */
async function loadSunnydKokoroTTS({ signal, progress_callback } = {}) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!sunnydKokoroTtsPromise) {
    sunnydKokoroTtsPromise = (async () => {
      const { KokoroTTS } = await import("kokoro-js");
      let device = "wasm";
      try {
        if (typeof navigator !== "undefined" && navigator.gpu) device = "webgpu";
      } catch {
        device = "wasm";
      }
      const dtype = device === "webgpu" ? "fp32" : "q8";
      return KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype,
        device,
        progress_callback: progress_callback || undefined,
      });
    })();
  }
  try {
    const tts = await sunnydKokoroTtsPromise;
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return tts;
  } catch (e) {
    sunnydKokoroTtsPromise = null;
    throw e;
  }
}

function mergeMonoAudioBuffers(ctx, buffers) {
  if (!buffers.length) return null;
  const sampleRate = buffers[0].sampleRate;
  let total = 0;
  for (const b of buffers) total += b.length;
  const out = ctx.createBuffer(1, total, sampleRate);
  const ch = out.getChannelData(0);
  let offset = 0;
  for (const b of buffers) {
    if (b.numberOfChannels === 1) {
      ch.set(b.getChannelData(0), offset);
    } else {
      const c0 = b.getChannelData(0);
      const c1 = b.getChannelData(1);
      for (let i = 0; i < b.length; i++) ch[offset + i] = (c0[i] + c1[i]) * 0.5;
    }
    offset += b.length;
  }
  return out;
}

function audioBufferToWavBlob(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples * blockAlign;
  const arr = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arr);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < samples; i++) {
    for (let c = 0; c < numChannels; c++) {
      let s = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([arr], { type: "audio/wav" });
}

/** Strip markdown / emphasis markers so TTS never reads asterisks or backticks aloud. */
function sanitizePodcastSpokenText(s) {
  if (!s || typeof s !== "string") return "";
  let t = s;
  t = t.replace(/\*\*([\s\S]*?)\*\*/g, "$1");
  t = t.replace(/\*([^*\n]+)\*/g, "$1");
  t = t.replace(/__([^_\n]+)__/g, "$1");
  t = t.replace(/(^|\s)_([^_\n]+)_(\s|$)/g, "$1$2$3");
  t = t.replace(/`([^`\n]+)`/g, "$1");
  t = t.replace(/\*\*/g, "");
  t = t.replace(/\*/g, "");
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function parsePodcastScriptJson(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/```json\s*|```/gi, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[0]);
    if (!Array.isArray(d.turns) || d.turns.length === 0) return null;
    const turns = d.turns
      .map((t, i) => {
        const speaker = String(t.speaker || "").toLowerCase().replace(/\s+/g, "_");
        const text = sanitizePodcastSpokenText((t.text || "").trim());
        if (!text) return null;
        const id = speaker === "host_b" || speaker === "b" || speaker === "2" ? "host_b" : "host_a";
        const defaultName = id === "host_b" ? "Ray" : "Dee";
        let displayName = sanitizePodcastSpokenText((t.displayName || t.name || defaultName).trim());
        if (!displayName) displayName = defaultName;
        return {
          id,
          displayName,
          text,
        };
      })
      .filter(Boolean);
    if (!turns.length) return null;
    return { title: sanitizePodcastSpokenText((d.title || "SunnyD Cast").trim()) || "SunnyD Cast", turns };
  } catch {
    return null;
  }
}

/** Rough per-turn timing for merged WAV (word-based; good enough for “who’s talking”). */
function podcastTurnTimelineSec(turns) {
  const wps = 2.4;
  let acc = 0;
  return turns.map(turn => {
    const words = turn.text.trim().split(/\s+/).filter(Boolean).length;
    const dur = Math.max(0.35, words / wps);
    const seg = { id: turn.id, start: acc, end: acc + dur };
    acc += dur;
    return seg;
  });
}

function activePodcastSpeakerFromTimeline(timeline, currentTime) {
  if (!timeline.length || currentTime < 0) return null;
  let id = null;
  for (const seg of timeline) {
    if (currentTime >= seg.start) id = seg.id;
  }
  return id;
}

/** One segment per script turn, times in seconds matching merged WAV currentTime (from decoded chunk durations). */
function podcastSegmentsFromBufferDurations(turns, chunkCounts, buffers) {
  if (!turns.length || turns.length !== chunkCounts.length) return [];
  const need = chunkCounts.reduce((a, b) => a + b, 0);
  if (need !== buffers.length) return [];
  let bi = 0;
  let tAcc = 0;
  const segments = [];
  for (let ti = 0; ti < turns.length; ti++) {
    let dur = 0;
    for (let k = 0; k < chunkCounts[ti]; k++) {
      const buf = buffers[bi++];
      dur += buf?.duration || 0;
    }
    const start = tAcc;
    tAcc += dur;
    segments.push({ id: turns[ti].id, start, end: tAcc });
  }
  return segments;
}

/** Non-last turns use [start, end); at boundaries the next host wins. Last turn runs through real file duration. */
function activePodcastSpeakerFromSegments(segments, currentTime, audioDuration, ended) {
  if (!segments.length || currentTime < 0 || ended) return null;
  const last = segments[segments.length - 1];
  const durOk = Number.isFinite(audioDuration) && audioDuration > 0.05;
  const fileEnd = durOk ? audioDuration : last.end;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    if (isLast) {
      const end = Math.max(seg.end, fileEnd);
      if (currentTime >= seg.start && currentTime <= end + 0.04) return seg.id;
    } else if (currentTime >= seg.start && currentTime < seg.end) {
      return seg.id;
    }
  }
  return null;
}

/** Recent dialogue around the pause point for “ask about this moment”. */
function buildPodcastQuestionSnippet(turns, segments, currentTime, audioDuration, browserMode, activeSpeakerId) {
  if (!turns.length) return { excerpt: "(No episode script.)", focusTurnIndex: 0 };
  let idx = 0;
  if (browserMode || !segments.length || currentTime == null || !Number.isFinite(currentTime)) {
    const hit = turns.findIndex(t => t.id === activeSpeakerId);
    idx = hit >= 0 ? hit : 0;
    const from = Math.max(0, idx - 1);
    const to = Math.min(turns.length, idx + 4);
    const slice = turns.slice(from, to);
    return {
      excerpt: slice.map(t => `${t.displayName}: ${t.text}`).join("\n\n"),
      focusTurnIndex: idx,
    };
  }
  const last = segments[segments.length - 1];
  const durOk = Number.isFinite(audioDuration) && audioDuration > 0.05;
  const t = Math.min(Math.max(0, currentTime), durOk ? audioDuration : last.end);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    const endBound = isLast ? Math.max(seg.end, audioDuration || seg.end) : seg.end;
    if (t >= seg.start && t < endBound) {
      idx = i;
      break;
    }
    if (isLast) idx = i;
  }
  const from = Math.max(0, idx - 2);
  const to = Math.min(turns.length, idx + 3);
  const slice = turns.slice(from, to);
  return {
    excerpt: slice.map(t => `${t.displayName}: ${t.text}`).join("\n\n"),
    focusTurnIndex: idx,
  };
}

function clampPodcastAnswerLength(s, maxWords = 95) {
  if (!s || typeof s !== "string") return "";
  const t = s.trim();
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length <= maxWords) return t;
  return `${parts.slice(0, maxWords).join(" ")}…`;
}

/* Detect Mac once at module load — used for keyboard shortcut labels throughout */
const IS_MAC = typeof navigator !== "undefined" &&
  (/Mac|iPhone|iPad/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent));
const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

const LS_CAST_MAX_MIN = "sd_cast_max_min";
const LS_CAST_FLOAT = "sd_cast_float_pos";
const PODCAST_FLOAT_W = 300;
const PODCAST_FLOAT_H = 340;

/** Keep mini player on-screen (invalid sessionStorage / small viewport). */
function clampPodcastFloatPosition(x, y) {
  const m = 12;
  const iw = typeof window !== "undefined" ? window.innerWidth : 400;
  const ih = typeof window !== "undefined" ? window.innerHeight : 700;
  const vw = Math.max(280, iw);
  const vh = Math.max(360, ih);
  let xi = Number(x);
  let yi = Number(y);
  if (!Number.isFinite(xi) || !Number.isFinite(yi)) {
    xi = vw - PODCAST_FLOAT_W - m;
    yi = vh - PODCAST_FLOAT_H - m;
  }
  const maxX = Math.max(m, vw - PODCAST_FLOAT_W - m);
  const maxY = Math.max(m, vh - PODCAST_FLOAT_H - m);
  return {
    x: Math.min(Math.max(m, xi), maxX),
    y: Math.min(Math.max(m, yi), maxY),
  };
}

function clampPodcastMinutes(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 7;
  return Math.min(10, Math.max(2, Math.round(x)));
}

function podcastLengthTargets(minutes) {
  const m = clampPodcastMinutes(minutes);
  const wpm = 135;
  const targetWords = Math.round(m * wpm);
  return {
    targetEpisodeMinutesMax: m,
    targetWordCountApprox: targetWords,
    targetWordCountMin: Math.round(targetWords * 0.88),
    targetWordCountMax: Math.round(targetWords * 1.12),
  };
}

function podcastScriptMaxOut(minutes, llmProvider) {
  const m = clampPodcastMinutes(minutes);
  const scaled = Math.round(2200 + (m - 2) * 1150);
  const cap = llmProvider === "openai" ? 12000 : llmProvider === "claude" ? 8000 : 8192;
  return Math.min(cap, Math.max(2800, scaled));
}

const PODCAST_SCRIPT_SYSTEM = `You write the official in-app audio show SunnyD Cast — a smart study recap for students. Output ONLY valid JSON (no markdown code fences, no markdown inside strings).

Schema:
{"title":"short episode title","turns":[{"speaker":"host_a","displayName":"Dee","text":"..."},{"speaker":"host_b","displayName":"Ray","text":"..."},...]}

SPOKEN TEXT RULES (critical):
- title, every displayName, and every "text" value must be plain spoken English only.
- Do NOT use asterisks, underscores, backticks, hashtags, or any markdown. Nothing that would be read aloud as punctuation emphasis (no star characters at all in output strings).

Hosts (never swap roles):
- host_a = Dee (she/her, woman). host_b = Ray (he/him, man). Alternate turns most of the time.

CORE DYNAMIC (for you as writer only — NEVER say this out loud in dialogue):
- Dee is quick, witty, silly analogies, big reactions, playful wrong guesses that invite correction. She learns out loud; she is not the factual anchor.
- Ray is the one who actually explains from the notes: definitions, steps, fixes misconceptions. Light dry humor ok; he carries most factual teaching. Not a fake résumé—only teach what the sources support.
- The listener should feel this dynamic from how they talk. Hosts must NEVER announce it: forbid lines like "I'm the funny one," "I'll be serious," "I'm here for the jokes," "I'll focus on the content," "you explain and I'll joke," or any meta description of their roles. Just be those people.

How they educate together:
- Dee tees up joke / fake-out / "wait really?" → Ray explains from sources → Dee reframes memorably; Ray corrects if she oversimplifies wrong.
- Ray gets more dense explanation lines; Dee reacts and asks the listener's questions out loud.

LOCKED PERSONALITIES (show, don't tell):
- Dee: warm, curious, humor that helps memory.
- Ray: patient, structured, grounded in the materials.

COLD OPEN — first 4–6 turns only:
1) In turn 1 or 2, name SunnyD and SunnyD Cast once in a natural welcome (not a sales pitch).
2) Self-intro plus short fictional bio colored by the topic (from title, course meta, notes themes). Dee's can be more absurd; Ray's can sound like someone who geeks out on the subject—in-character only, no fake degrees.
3) One line each on today's plan: Dee sounds excited or silly; Ray sounds plain and clear about what you'll relearn.

Teaching:
- Cover notes and lecture transcript. Thin transcript → note it briefly, lean on notes.
- Do not invent facts; Ray's factual lines must track sources. Dee's jokes can use silly hypotheticals but must not assert false facts as true.
- No stage directions, sound effects, or "music fades." Spoken words only.
- Each "text": 1–4 sentences unless a tight list helps.

Length: The user JSON includes targetEpisodeMinutesMax, targetWordCountMin, targetWordCountMax, and targetWordCountApprox. Count all words in every "text" field combined (ignore JSON keys). Stay within that word band so spoken time lands near the minute cap. Shorter → tighter cold open and fewer tangents; longer → more depth and examples. Cold open stays the first 4–6 turns; scale the teaching and recap to hit the cap. Depth over breadth within the band.`;

async function generatePodcastScript(provider, apiKey, userPayload, maxOut = 10000, signal) {
  const user = typeof userPayload === "string" ? userPayload : JSON.stringify(userPayload);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const raw = await ai(provider, apiKey, PODCAST_SCRIPT_SYSTEM, user, maxOut);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const parsed = parsePodcastScriptJson(raw);
  if (!parsed) throw new Error("Could not parse podcast script — try again.");
  return parsed;
}

function pickWebSpeechVoices() {
  const voices = typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : [];
  const en = voices.filter(v => /en(-|$)/i.test(v.lang || ""));
  const pool = en.length ? en : voices;
  const prefer = (nameRe) => pool.find(v => nameRe.test(v.name || ""));
  const voiceFemale =
    prefer(/samantha|victoria|karen|female|zoe|fiona|susan|kate|linda|moira|tessa/i) ||
    pool.find(v => /female/i.test(v.name || "")) ||
    pool[0];
  const voiceMale =
    prefer(/daniel|fred|tom|aaron|male|oliver|arthur|nicky|reed|alex|david|mark|rishi/i) ||
    pool.find(v => v && v !== voiceFemale && /male/i.test(v.name || "")) ||
    pool.find(v => v && v !== voiceFemale) ||
    pool[1] ||
    voiceFemale;
  return { voiceFemale: voiceFemale || null, voiceMale: voiceMale && voiceMale !== voiceFemale ? voiceMale : pool[1] || voiceFemale || null };
}

function speakTurnsWebSpeech(turns, signal, onProgress, onActiveTurn) {
  return new Promise((resolve, reject) => {
    if (!turns.length) {
      onActiveTurn?.(null);
      resolve();
      return;
    }
    const { voiceFemale, voiceMale } = pickWebSpeechVoices();
    let i = 0;
    const next = () => {
      if (signal.aborted) {
        speechSynthesis.cancel();
        onActiveTurn?.(null);
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      if (i >= turns.length) {
        onActiveTurn?.(null);
        resolve();
        return;
      }
      const t = turns[i];
      onActiveTurn?.(t);
      onProgress?.(i + 1, turns.length);
      const u = new SpeechSynthesisUtterance(t.text);
      const v = t.id === "host_b" ? voiceMale : voiceFemale;
      if (v) u.voice = v;
      u.rate = 1.02;
      u.pitch = t.id === "host_b" ? 0.97 : 1.01;
      u.onend = () => {
        i += 1;
        next();
      };
      u.onerror = () => {
        onActiveTurn?.(null);
        reject(new Error("Browser speech failed"));
      };
      speechSynthesis.speak(u);
    };
    speechSynthesis.cancel();
    next();
  });
}

const PODCAST_WAVE_BARS = 32;

/** Live spectrum bars from AnalyserNode when file audio plays; speech-like motion for Web Speech (no TTS tap in browsers). */
function PodcastWavePanel({ label, variant, isActive, analyserRef, audioRef, useAnalyserPath, simulateActive, compact }) {
  const canvasRef = useRef(null);
  const isActiveRef = useRef(isActive);
  const useAnalyserPathRef = useRef(useAnalyserPath);
  const simulateActiveRef = useRef(simulateActive);
  const compactRef = useRef(!!compact);
  isActiveRef.current = isActive;
  useAnalyserPathRef.current = useAnalyserPath;
  simulateActiveRef.current = simulateActive;
  compactRef.current = !!compact;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx2 = canvas.getContext("2d");
    if (!ctx2) return undefined;
    const w = canvas.width;
    const h = canvas.height;
    const nBars = compactRef.current ? 24 : PODCAST_WAVE_BARS;
    let freqBuf = null;
    let raf = 0;
    let tSim = 0;
    const smoothed = new Array(nBars).fill(0.1);
    const raw = new Array(nBars);

    const drawLoop = () => {
      raf = requestAnimationFrame(drawLoop);
      const active = isActiveRef.current;
      const useA = useAnalyserPathRef.current;
      const sim = simulateActiveRef.current;
      const analyser = analyserRef?.current;
      const el = audioRef?.current;
      const filePlaying = el && !el.paused && !el.ended;

      if (useA && active && filePlaying && analyser) {
        if (!freqBuf || freqBuf.length !== analyser.frequencyBinCount) {
          freqBuf = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(freqBuf);
        const usable = Math.min(freqBuf.length, 112);
        const step = Math.max(1, Math.floor(usable / nBars));
        for (let i = 0; i < nBars; i++) {
          let sum = 0;
          for (let k = 0; k < step; k++) sum += freqBuf[i * step + k] || 0;
          const v = sum / step / 255;
          raw[i] = Math.max(0.05, Math.min(1, v * 2.15 + 0.03));
        }
      } else if (sim && active) {
        tSim += 0.022;
        for (let i = 0; i < nBars; i++) {
          const ph = tSim * 5.5 + i * 0.33;
          const env = 0.5 + 0.5 * Math.sin(tSim * 12 + i * 0.27);
          const band = 0.5 + 0.5 * Math.sin(ph);
          raw[i] = Math.max(0.12, Math.min(1, 0.2 + band * 0.58 * env));
        }
      } else {
        const t = performance.now() / 1000;
        for (let i = 0; i < nBars; i++) {
          raw[i] = 0.07 + 0.06 * Math.sin(t * 1.2 + i * 0.26);
        }
      }

      const snap = useA && active && filePlaying && analyser ? 0.62 : sim && active ? 0.45 : 0.28;
      for (let i = 0; i < nBars; i++) {
        smoothed[i] += (raw[i] - smoothed[i]) * snap;
      }

      ctx2.clearRect(0, 0, w, h);
      const grad = ctx2.createLinearGradient(0, h, 0, 0);
      if (variant === "dee") {
        grad.addColorStop(0, "rgba(255,183,77,0.35)");
        grad.addColorStop(0.45, "#ffb74d");
        grad.addColorStop(1, "#f57c00");
      } else {
        grad.addColorStop(0, "rgba(149,117,205,0.35)");
        grad.addColorStop(0.45, "#9575cd");
        grad.addColorStop(1, "#5e35b1");
      }
      ctx2.fillStyle = grad;
      const slot = w / nBars;
      for (let i = 0; i < nBars; i++) {
        const bw = slot * 0.62;
        const x = i * slot + (slot - bw) / 2;
        const barH = Math.max(2, smoothed[i] * h * 0.94);
        const y = h - barH;
        ctx2.beginPath();
        const r = Math.min(bw / 2, 2.5);
        if (typeof ctx2.roundRect === "function") {
          ctx2.roundRect(x, y, bw, barH, r);
        } else {
          ctx2.rect(x, y, bw, barH);
        }
        ctx2.fill();
      }
    };

    raf = requestAnimationFrame(drawLoop);
    return () => cancelAnimationFrame(raf);
  }, [variant, analyserRef, audioRef, compact]);

  const vClass = variant === "ray" ? "podcast-wave-wrap--ray" : "podcast-wave-wrap--dee";
  return (
    <div
      className={`podcast-wave-wrap ${vClass}${compact ? " podcast-wave-wrap--compact" : ""}${isActive ? " podcast-wave-wrap--active" : ""}`}
      aria-label={isActive ? `${label} speaking` : label}
    >
      <canvas
        ref={canvasRef}
        width={compact ? 108 : 152}
        height={compact ? 40 : 56}
        className={`podcast-wave-canvas${compact ? " podcast-wave-canvas--compact" : ""}`}
        aria-hidden
      />
      <span className="podcast-wave-name">{label}</span>
    </div>
  );
}

function PodcastQuestionPanel({
  questionText,
  setQuestionText,
  answer,
  busy,
  onSubmit,
  onCloseResume,
  noApiKey,
}) {
  return (
    <div className="podcast-q-panel">
      <p className="podcast-q-hint">Playback is paused. Ask about the lines you just heard.</p>
      {noApiKey && <p className="podcast-q-warn">Add your API key in settings to get an answer.</p>}
      <textarea
        className="podcast-q-input"
        rows={3}
        placeholder="e.g. Can you explain that last analogy in simpler terms?"
        value={questionText}
        onChange={e => setQuestionText(e.target.value)}
        disabled={busy}
      />
      <div className="podcast-q-actions">
        <button type="button" className="note-setup-go podcast-q-send" disabled={busy || !questionText.trim()} onClick={onSubmit}>
          {busy ? "Thinking…" : "Get answer"}
        </button>
        <button type="button" className="note-setup-skip" disabled={busy} onClick={onCloseResume}>
          Resume episode
        </button>
      </div>
      {answer && (
        <div className="podcast-q-answer">
          <span className="podcast-q-answer-label">Answer</span>
          <p className="podcast-q-answer-body">{answer}</p>
        </div>
      )}
    </div>
  );
}

function PodcastFloatingDock({
  position,
  setPosition,
  title,
  wavePropsDee,
  wavePropsRay,
  audioRef,
  hasFileAudio,
  webSpeech,
  onExpand,
  onClose,
  onQuestion,
  questionOpen,
  questionText,
  setQuestionText,
  questionAnswer,
  questionBusy,
  onQuestionSubmit,
  onQuestionCloseResume,
  noApiKey,
}) {
  const dragStartRef = useRef(null);
  const posStartRef = useRef(null);
  const lastPosRef = useRef(position);
  const floatRootRef = useRef(null);
  const [, setTick] = useState(0);

  lastPosRef.current = position;

  useEffect(() => {
    if (!hasFileAudio || !audioRef?.current) return undefined;
    const el = audioRef.current;
    let raf = 0;
    let alive = true;
    const bump = () => setTick(t => (t + 1) % 1e6);
    el.addEventListener("timeupdate", bump);
    el.addEventListener("play", bump);
    el.addEventListener("pause", bump);
    el.addEventListener("seeked", bump);
    const loop = () => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (!el.paused && !el.ended) bump();
    };
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      el.removeEventListener("timeupdate", bump);
      el.removeEventListener("play", bump);
      el.removeEventListener("pause", bump);
      el.removeEventListener("seeked", bump);
    };
  }, [hasFileAudio, audioRef]);

  const clampPos = useCallback((x, y, w, h) => {
    const m = 10;
    const vw = typeof window !== "undefined" ? window.innerWidth : 400;
    const vh = typeof window !== "undefined" ? window.innerHeight : 700;
    return {
      x: Math.min(Math.max(m, x), vw - w - m),
      y: Math.min(Math.max(m, y), vh - h - m),
    };
  }, []);

  const onPointerDownDrag = e => {
    if (e.button !== 0) return;
    if (e.target.closest("button")) return;
    e.preventDefault();
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    posStartRef.current = { ...lastPosRef.current };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const onPointerMoveDrag = e => {
    if (!dragStartRef.current || !posStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const rect = floatRootRef.current?.getBoundingClientRect?.() || { width: 296, height: 260 };
    const next = clampPos(posStartRef.current.x + dx, posStartRef.current.y + dy, rect.width, rect.height);
    lastPosRef.current = next;
    setPosition(next);
  };

  const onPointerUpDrag = e => {
    dragStartRef.current = null;
    posStartRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    try {
      sessionStorage.setItem(LS_CAST_FLOAT, JSON.stringify(lastPosRef.current));
    } catch {}
  };

  const el = audioRef?.current;
  const dur = el && Number.isFinite(el.duration) ? el.duration : 0;
  const cur = el && Number.isFinite(el.currentTime) ? el.currentTime : 0;
  const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;

  return (
    <div ref={floatRootRef} className="podcast-float-root" style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
      <div className="podcast-float-inner">
        <div
          className="podcast-float-drag"
          onPointerDown={onPointerDownDrag}
          onPointerMove={onPointerMoveDrag}
          onPointerUp={onPointerUpDrag}
          onPointerCancel={onPointerUpDrag}
        >
          <span className="podcast-float-grip" aria-hidden />
          <span className="podcast-float-title">{title || "SunnyD Cast"}</span>
          <div className="podcast-float-win-btns">
            <button type="button" className="podcast-float-icon-btn" onClick={onExpand} aria-label="Expand player">
              ⛶
            </button>
            <button type="button" className="podcast-float-icon-btn" onClick={onClose} aria-label="Close and stop">
              ×
            </button>
          </div>
        </div>

        <div className="podcast-float-waves">
          <PodcastWavePanel {...wavePropsDee} compact />
          <PodcastWavePanel {...wavePropsRay} compact />
        </div>

        {webSpeech && (
          <div className="podcast-float-transport podcast-float-transport--speech">
            <button
              type="button"
              className="podcast-float-play"
              disabled={webSpeech.speaking}
              aria-label="Play through speaker"
              onClick={webSpeech.onPlay}
            >
              {webSpeech.speaking ? "…" : "▶ Speaker"}
            </button>
            {webSpeech.speaking && (
              <button type="button" className="podcast-float-stop" onClick={webSpeech.onStop}>
                Stop
              </button>
            )}
          </div>
        )}

        {hasFileAudio && (
          <div className="podcast-float-transport">
            <button
              type="button"
              className="podcast-float-play"
              aria-label={el?.paused ? "Play" : "Pause"}
              onClick={() => {
                const a = audioRef?.current;
                if (!a) return;
                if (a.paused) a.play().catch(() => {});
                else a.pause();
              }}
            >
              {el?.paused ? "▶" : "❚❚"}
            </button>
            <div className="podcast-float-scrub">
              <div className="podcast-float-scrub-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="podcast-float-time">
              {dur > 0 ? `${Math.floor(cur / 60)}:${String(Math.floor(cur % 60)).padStart(2, "0")}` : "—"}
            </span>
          </div>
        )}

        {hasFileAudio && (
          <input
            type="range"
            className="podcast-float-seek"
            min={0}
            max={dur > 0 ? dur : 1}
            step={0.1}
            value={dur > 0 ? cur : 0}
            onChange={e => {
              const a = audioRef?.current;
              if (a && dur > 0) a.currentTime = Number(e.target.value);
            }}
            aria-label="Seek episode"
          />
        )}

        <div className="podcast-float-actions">
          <button type="button" className="podcast-float-q-btn" onClick={onQuestion} disabled={questionBusy}>
            ? Ask about this moment
          </button>
        </div>

        {questionOpen && (
          <PodcastQuestionPanel
            questionText={questionText}
            setQuestionText={setQuestionText}
            answer={questionAnswer}
            busy={questionBusy}
            onSubmit={onQuestionSubmit}
            onCloseResume={onQuestionCloseResume}
            noApiKey={noApiKey}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Semantic Search ────────────────────────────────────────────────────── */

/* Call the active provider's embeddings API. Returns number[] or null. */
async function embedText(text) {
  try {
    const provider = sessionStorage.getItem("sd_provider") || "openai";
    const key = sessionStorage.getItem(`sd_key_${provider}`) || sessionStorage.getItem("sd_key") || "";
    if (!key) return null;
    if (provider === "claude") return null; // Anthropic has no embeddings API

    const trimmed = text.slice(0, 8000);

    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input: trimmed }),
      });
      if (!r.ok) return null;
      const data = await r.json();
      return data.data?.[0]?.embedding ?? null;
    }

    if (provider === "gemini") {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "models/text-embedding-004",
            content: { parts: [{ text: trimmed }] },
          }),
        }
      );
      if (!r.ok) return null;
      const data = await r.json();
      return data.embedding?.values ?? null;
    }

    return null;
  } catch { return null; }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
}

function keywordScore(noteText, query) {
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const lower = noteText.toLowerCase();
  const hits = words.filter(w => lower.includes(w.toLowerCase())).length;
  return hits / words.length;
}

function simpleHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

/* ── Embedding localStorage helpers ── */
const LS_EMBED_KEY = "sd_embeddings_v1";

function loadEmbeddings() {
  try { return JSON.parse(localStorage.getItem(LS_EMBED_KEY) || "{}"); } catch { return {}; }
}

function saveEmbedding(noteId, vector, contentHash) {
  try {
    const embeddings = loadEmbeddings();
    embeddings[noteId] = { vector, hash: contentHash };
    localStorage.setItem(LS_EMBED_KEY, JSON.stringify(embeddings));
  } catch (e) {
    if (e?.name === "QuotaExceededError") console.warn("Search index full — embedding not saved.");
  }
}

function deleteEmbedding(noteId) {
  try {
    const embeddings = loadEmbeddings();
    delete embeddings[noteId];
    localStorage.setItem(LS_EMBED_KEY, JSON.stringify(embeddings));
  } catch {}
}

function getExcerpt(content, query) {
  const plain = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const words = query.split(/\s+/).filter(Boolean);
  const lower = plain.toLowerCase();
  let matchIdx = -1;
  for (const w of words) {
    const idx = lower.indexOf(w.toLowerCase());
    if (idx !== -1) { matchIdx = idx; break; }
  }
  const start = matchIdx !== -1 ? Math.max(0, matchIdx - 60) : 0;
  const end   = Math.min(plain.length, start + 220);
  let excerpt = plain.slice(start, end);
  const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  if (escaped) {
    excerpt = excerpt.replace(new RegExp(`(${escaped})`, "gi"), "<mark>$1</mark>");
  }
  if (start > 0) excerpt = "…" + excerpt;
  if (end < plain.length) excerpt = excerpt + "…";
  return excerpt;
}

async function searchNotes(query, notes) {
  const provider = sessionStorage.getItem("sd_provider") || "openai";
  const embeddings = loadEmbeddings();

  if (provider !== "claude") {
    const queryVec = await embedText(query);
    if (!queryVec) return [];
    return notes
      .map(note => ({
        note,
        score: cosineSimilarity(queryVec, embeddings[note.id]?.vector ?? null),
        excerpt: getExcerpt(note.content, query),
      }))
      .filter(r => r.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  // Claude fallback: keyword search
  return notes
    .map(note => {
      const plainText = note.content.replace(/<[^>]+>/g, " ");
      return { note, score: keywordScore(plainText, query), excerpt: getExcerpt(note.content, query) };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/* ─── Seed ───────────────────────────────────────────────────────────────── */
/* Convert HTML to plain text for AI calls */
function htmlToText(html) {
  if (!html) return "";
  if (!html.trimStart().startsWith("<")) return html; // already plain text
  try {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || "";
  } catch { return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
}

/* Convert LLM markdown output → Tiptap-parseable HTML.
   If the text already looks like HTML it is passed through unchanged.
   Supports: # h1, ## h2, ### h3, **bold**, *italic*, _italic_, `code`,
             ``` code blocks ```, - / * unordered lists, 1. ordered lists,
             blank-line paragraph breaks. */
function mdToHtml(text) {
  if (!text) return "";
  const t = text.trim();
  if (t.startsWith("<")) return t; // already HTML — trust it

  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,     "<em>$1</em>")
    .replace(/__(.+?)__/g,     "<strong>$1</strong>")
    .replace(/_([^_]+)_/g,     "<em>$1</em>")
    .replace(/`([^`]+)`/g,     "<code>$1</code>");

  const out = [];
  let listType = null;
  let codeBuf  = null;

  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };

  for (const raw of t.split("\n")) {
    // Code fence
    if (/^```/.test(raw)) {
      if (codeBuf === null) { closeList(); codeBuf = []; }
      else { out.push(`<pre><code>${esc(codeBuf.join("\n"))}</code></pre>`); codeBuf = null; }
      continue;
    }
    if (codeBuf !== null) { codeBuf.push(raw); continue; }

    // Headings
    const h1 = raw.match(/^# (.+)$/);  if (h1) { closeList(); out.push(`<h1>${inline(h1[1])}</h1>`); continue; }
    const h2 = raw.match(/^## (.+)$/); if (h2) { closeList(); out.push(`<h2>${inline(h2[1])}</h2>`); continue; }
    const h3 = raw.match(/^### (.+)$/);if (h3) { closeList(); out.push(`<h3>${inline(h3[1])}</h3>`); continue; }

    // Unordered list
    const ul = raw.match(/^[-*] (.+)$/);
    if (ul) {
      if (listType !== "ul") { closeList(); out.push("<ul>"); listType = "ul"; }
      out.push(`<li>${inline(ul[1])}</li>`); continue;
    }
    // Ordered list
    const ol = raw.match(/^\d+\. (.+)$/);
    if (ol) {
      if (listType !== "ol") { closeList(); out.push("<ol>"); listType = "ol"; }
      out.push(`<li>${inline(ol[1])}</li>`); continue;
    }

    // Blank line
    if (raw.trim() === "") { closeList(); continue; }

    // Regular paragraph
    closeList();
    out.push(`<p>${inline(raw)}</p>`);
  }

  closeList();
  if (codeBuf !== null) out.push(`<pre><code>${esc(codeBuf.join("\n"))}</code></pre>`);
  return out.join("");
}

const SEED = [
  {
    id: 1, title: "Research Notes",
    content: `The Great Wall of China is approximately 500 miles long and was built entirely during the Ming Dynasty.

Quantum entanglement allows particles to instantaneously affect each other regardless of distance. What exactly is quantum entanglement and why does it matter for computing?

Climate change is primarily driven by human activities, especially the burning of fossil fuels. Atmospheric CO2 has increased by about 50% since pre-industrial times, and the last decade was the warmest on record.

The CRISPR-Cas9 system enables precise editing of genetic sequences. How does CRISPR actually work at the molecular level?

Studies suggest that regular meditation can reduce cortisol levels and improve attention span, though the mechanisms are still being unpacked.`,
  },
  {
    id: 2, title: "Ideas",
    content: `The best product ideas often come from noticing your own frustrations—the things that make you think "why doesn't this just..."

I've been thinking about how we could build a tool that helps people

What if we could turn every meeting into a searchable knowledge base without anyone having to take notes?

The key insight is that most users don't want more features, they want fewer decisions. Simplicity isn't about removing options, it's about removing the cognitive load of choosing between them.

How might we design for the 10% of users who drive 90% of the value?`,
  },
];

/* ── Local persistence helpers ── */
const LS_NOTES_KEY   = "sd_notes_v1";
const LS_ACTIVE_KEY  = "sd_activeId_v1";

function loadNotes() {
  try {
    const raw = localStorage.getItem(LS_NOTES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return SEED;
}

function loadActiveId(notes) {
  try {
    const raw = localStorage.getItem(LS_ACTIVE_KEY);
    if (raw) {
      const id = JSON.parse(raw);
      if (notes.some(n => n.id === id)) return id;
    }
  } catch {}
  return notes[0]?.id ?? 1;
}

function saveNotes(notes) {
  try { localStorage.setItem(LS_NOTES_KEY, JSON.stringify(notes)); } catch {}
}

function saveActiveId(id) {
  try { localStorage.setItem(LS_ACTIVE_KEY, JSON.stringify(id)); } catch {}
}

/* ── Disk file persistence (File System Access API) ── */
const IDB_NAME = "sunnyd_db";
const IDB_STORE = "store";
const FILE_HANDLE_KEY = "notes_file";

const supportsFileAccess = () => typeof window !== "undefined" && "showSaveFilePicker" in window;

function openIDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result);
    r.onupgradeneeded = (e) => { e.target.result.createObjectStore(IDB_STORE); };
  });
}

async function getStoredFileHandle() {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(IDB_STORE, "readonly");
      const req = t.objectStore(IDB_STORE).get(FILE_HANDLE_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}

async function setStoredFileHandle(handle) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(IDB_STORE, "readwrite");
    t.objectStore(IDB_STORE).put(handle, FILE_HANDLE_KEY);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

async function readFromFile(handle) {
  const file = await handle.getFile();
  const text = await file.text();
  const data = JSON.parse(text);
  return { notes: data.notes ?? [], activeId: data.activeId ?? null };
}

async function writeToFile(handle, notes, activeId) {
  const w = await handle.createWritable();
  await w.write(JSON.stringify({ notes, activeId, version: 1 }, null, 2));
  await w.close();
}

let _n = 0;
const uid = () => `a${++_n}_${Date.now()}`;

/* Hex to rgba with opacity */
const hexToRgba = (hex, a = 1) => {
  const m = hex.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return `rgba(0,0,0,${a})`;
  return `rgba(${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)},${a})`;
};

/* ─── Categories ─────────────────────────────────────────────────────────── */
const CATS = {
  fact:     { label: "Fact Check",  color: "#C04500", bg: "#FFF2EA", border: "#EFAA7A", icon: "⚠" },
  expand:   { label: "Expand",      color: "#1A6835", bg: "#EDFAF2", border: "#7DD4A0", icon: "✦" },
  clarity:  { label: "Clarity",     color: "#1448AA", bg: "#EEF3FF", border: "#88BCEE", icon: "≋" },
  explain:  { label: "Explain",     color: "#0A6868", bg: "#EDFAFA", border: "#7ECCCC", icon: "◉" },
  research: { label: "Research",    color: "#0A6868", bg: "#EDFAFA", border: "#7ECCCC", icon: "⊞" },
  lecture:  { label: "Lecture",     color: "#5E38A0", bg: "#F5F0FF", border: "#B89EE8", icon: "🎙" },
};

/* Parse [text](url) markdown links and return React elements */
function parseWithLinks(text, keyPrefix = "l") {
  if (!text) return null;
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts = [];
  let lastIdx = 0;
  let match;
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(<span key={`${keyPrefix}-${i++}`} style={{ whiteSpace: "pre-wrap" }}>{text.slice(lastIdx, match.index)}</span>);
    parts.push(<a key={`${keyPrefix}-${i++}`} href={match[2]} target="_blank" rel="noopener noreferrer" className="hl-link">{match[1]}</a>);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(<span key={`${keyPrefix}-${i++}`} style={{ whiteSpace: "pre-wrap" }}>{text.slice(lastIdx)}</span>);
  return parts.length > 0 ? parts : <span key={keyPrefix} style={{ whiteSpace: "pre-wrap" }}>{text}</span>;
}

/* Find the best matching range in content for a suggestion (for highlighting) */
function findSuggestionRange(content, sugg) {
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  const tryMatch = (phrase) => {
    if (!phrase || phrase.length < 8) return null;
    let idx = content.indexOf(phrase);
    if (idx !== -1) return { start: idx, end: idx + phrase.length };
    const n = norm(phrase);
    if (n.length >= 8) {
      idx = content.indexOf(n);
      if (idx !== -1) return { start: idx, end: idx + n.length };
    }
    for (let len = Math.min(phrase.length, 80); len >= 15; len -= 5) {
      const sub = norm(phrase.slice(0, len));
      idx = content.indexOf(sub);
      if (idx !== -1) return { start: idx, end: idx + sub.length };
    }
    const words = (phrase || "").split(/\s+/).filter(w => w.length > 3);
    for (let n = Math.min(words.length, 8); n >= 2; n--) {
      const sub = words.slice(0, n).join(" ");
      idx = content.indexOf(sub);
      if (idx !== -1) return { start: idx, end: idx + sub.length };
    }
    return null;
  };
  const r = tryMatch(sugg.textRef) || tryMatch(sugg.detail) || tryMatch(sugg.preview) || tryMatch(sugg.headline);
  return r;
}

/* ─── TypeWriter ─────────────────────────────────────────────────────────── */
function TypeWriter({ text, speed = 16 }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
    if (!text) return;
    let i = 0;
    const t = setInterval(() => { i++; setIdx(i); if (i >= text.length) clearInterval(t); }, speed);
    return () => clearInterval(t);
  }, [text]);
  return <>{text.slice(0, idx)}</>;
}

/* ─── ThinkDots ──────────────────────────────────────────────────────────── */
function ThinkDots() {
  return <span className="think-dots"><span /><span /><span /></span>;
}

/* ─── ReadingState: shown in suggestion panel while AI scans notes ────────── */
function ReadingState() {
  const msgs = [
    "Reading your notes…",
    "Checking for insights…",
    "Finding opportunities…",
    "Analyzing content…",
  ];
  const [msgIdx, setMsgIdx] = useState(0);
  const [fade, setFade] = useState(true);
  useEffect(() => {
    const t = setInterval(() => {
      setFade(false);
      setTimeout(() => { setMsgIdx(i => (i + 1) % msgs.length); setFade(true); }, 220);
    }, 2000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="reading-state">
      <div className="reading-brand">
        <img src="/sunnyd-logo.png" alt="SunnyD" className="reading-logo-img" />
        <span className="reading-scan-ring" />
        <span className="reading-scan-ring r2" />
        <span className="reading-scan-ring r3" />
      </div>
      <div className={`reading-label${fade ? "" : " fade-out"}`}>{msgs[msgIdx]}</div>
      <div className="reading-bars">
        <span className="reading-bar" style={{ width: "72%", animationDelay: "0ms" }} />
        <span className="reading-bar" style={{ width: "48%", animationDelay: "200ms" }} />
        <span className="reading-bar" style={{ width: "63%", animationDelay: "400ms" }} />
        <span className="reading-bar" style={{ width: "38%", animationDelay: "600ms" }} />
      </div>
    </div>
  );
}

/* ─── AnnCard ────────────────────────────────────────────────────────────── */
function AnnCard({ s, onDismiss, isNew, onHover, onLeave, onCardClick }) {
  const cat = CATS[s.cat] || CATS.expand;
  const bgTint = hexToRgba(cat.color, 0.03);

  const handleCardClick = e => {
    if (s.applying) return;
    onCardClick?.(s, e);
  };

  return (
    <div
      className={`ann-card${isNew ? " ann-enter" : ""}${s.applying ? " applying" : ""}`}
      style={{ "--cat-color": cat.color, "--cat-tint": bgTint }}
      onMouseEnter={() => onHover?.(s.id)}
      onMouseLeave={() => onLeave?.()}
      onClick={handleCardClick}
    >
      <div className="ann-card-inner">
        <div className="ann-tag">
          <span className="ann-tag-dot" style={{ background: cat.color }} />
          <span className="ann-tag-label" style={{ color: cat.color }}>{cat.label}</span>
        </div>
        {s.applying ? (
          <div className="ann-applying">
            <span className="think-dots"><span /><span /><span /></span>
            <span>Weaving…</span>
          </div>
        ) : (
          <span className="ann-chevron">›</span>
        )}
      </div>
    </div>
  );
}

/* ─── CSS ────────────────────────────────────────────────────────────────── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap');
:root {
  --paper:   #F8F4ED;
  --page:    #FFFFFF;
  --ink:     #1A1410;
  --ink2:    #3C2F1E;
  --ink3:    #8C7A64;
  --rule:    #E8E0D4;
  --rule2:   #D5C9B8;
  --sh:      rgba(50,35,15,.08);
  --green:   #1A6835;
  --red:     #B83030;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html,body{height:100%;}
body{background:var(--paper);font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased;color:var(--ink);}
.app{display:flex;flex-direction:column;height:100vh;overflow:hidden;}

/* ── Key screen ── */
.key-screen{display:flex;align-items:center;justify-content:center;height:100vh;background:#E8761A;padding:24px;}
.key-card{width:100%;max-width:400px;background:var(--page);border-radius:4px;border:1px solid var(--rule2);box-shadow:0 4px 24px var(--sh);padding:40px;}
.key-mark{width:34px;height:34px;background:var(--ink);color:var(--paper);border-radius:4px;display:flex;align-items:center;justify-content:center;font-family:'DM Sans',sans-serif;font-weight:700;font-size:14px;margin-bottom:20px;}
.key-mark-logo{width:72px;height:72px;object-fit:contain;padding:8px 5px;border-radius:50%;background:#ed7f21;box-shadow:0 3px 14px rgba(237,127,33,.45);margin-bottom:20px;display:block;}
.key-title{font-family:'DM Sans',sans-serif;font-size:22px;font-weight:700;margin-bottom:6px;line-height:1.25;letter-spacing:-.02em;}
.key-sub{font-size:13px;color:var(--ink3);line-height:1.6;margin-bottom:24px;}
.key-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--ink3);display:block;margin-bottom:7px;}
.key-select{width:100%;padding:10px 13px;border:1px solid var(--rule2);border-radius:6px;background:var(--page);color:var(--ink);font-family:'DM Sans',sans-serif;font-size:13px;outline:none;transition:border-color .18s;margin-bottom:10px;cursor:pointer;}
.key-inp{width:100%;padding:10px 13px;border:1px solid var(--rule2);border-radius:6px;background:var(--paper);color:var(--ink);font-family:'DM Sans',sans-serif;font-size:13.5px;outline:none;transition:border-color .18s;margin-bottom:10px;}
.key-inp:focus{border-color:var(--ink2);}
.key-btn{width:100%;padding:11px;background:var(--ink);color:var(--paper);border:none;border-radius:6px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:13.5px;font-weight:600;transition:opacity .18s;margin-bottom:14px;}
.key-btn:hover:not(:disabled){opacity:.82;}
.key-btn:disabled{opacity:.4;cursor:default;}
.key-err{font-size:12px;color:var(--red);margin-bottom:10px;line-height:1.4;}
.key-note{font-size:11px;color:var(--ink3);line-height:1.55;}
.key-note a{color:var(--ink2);}

/* ── Header ── */
.hdr{display:flex;align-items:center;justify-content:space-between;padding:0 18px;height:44px;flex-shrink:0;background:var(--page);border-bottom:1px solid var(--rule);}
.logo{display:flex;align-items:center;gap:9px;}
.logo-sq{width:25px;height:25px;background:var(--ink);color:var(--paper);border-radius:4px;display:flex;align-items:center;justify-content:center;font-family:'DM Sans',sans-serif;font-weight:700;font-size:12px;}
.logo-name{font-size:13px;font-weight:600;color:var(--ink);letter-spacing:-.02em;}
.logo-sep{width:1px;height:12px;background:var(--rule2);}
.logo-tag{font-size:11px;color:var(--ink3);}
.hdr-pill{display:flex;align-items:center;gap:6px;padding:3px 11px;border-radius:20px;border:1px solid var(--rule);background:var(--paper);font-size:11px;color:var(--ink3);font-weight:500;transition:all .25s;}
.hdr-pill.live{border-color:var(--rule2);color:var(--ink2);}
.hdr-dot{width:5px;height:5px;border-radius:50%;background:var(--rule2);transition:background .25s;flex-shrink:0;}
.hdr-pill.live .hdr-dot{background:var(--ink);animation:dotBlink 1.2s ease-in-out infinite;}
@keyframes dotBlink{0%,100%{opacity:1}50%{opacity:.2}}

/* Suggestion frequency bar */
.sugg-freq-bar{display:flex;align-items:center;gap:10px;padding:6px 18px;background:var(--paper);border-bottom:1px solid rgba(215,205,188,.5);flex-shrink:0;}
.sugg-freq-lbl{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--ink3);opacity:.8;}
.sugg-freq-btn{padding:4px 12px;border-radius:6px;border:1px solid var(--rule);background:var(--page);font-size:11px;font-weight:500;color:var(--ink2);cursor:pointer;transition:all .2s;font-family:'DM Sans',sans-serif;}
.sugg-freq-btn:hover{border-color:var(--rule2);color:var(--ink);}
.sugg-freq-btn.on{background:var(--ink);color:var(--paper);border-color:var(--ink);}
.hdr-r{display:flex;align-items:center;gap:10px;}
.hdr-llm-select{padding:4px 8px;border-radius:5px;border:1px solid var(--rule);background:var(--page);font-family:'DM Sans',sans-serif;font-size:11px;font-weight:500;color:var(--ink2);cursor:pointer;transition:border-color .15s;}
.hdr-llm-select:hover{border-color:var(--rule2);}
.export-wrap{position:relative;}
.export-btn{padding:5px 11px;border-radius:6px;border:1px solid var(--rule);background:var(--page);font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;color:var(--ink2);cursor:pointer;transition:all .15s;}
.export-btn:hover{border-color:var(--rule2);background:var(--paper);color:var(--ink);}
.hdr-podcast-btn{
  display:flex;align-items:center;gap:5px;
  padding:5px 11px;border-radius:6px;border:1px solid rgba(94,56,160,.38);
  background:linear-gradient(135deg,rgba(107,62,184,.12),rgba(94,56,160,.06));
  font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;color:#5E38A0;
  cursor:pointer;transition:all .15s;white-space:nowrap;
}
.hdr-podcast-btn:hover:not(:disabled){border-color:rgba(94,56,160,.58);background:rgba(94,56,160,.16);color:#4A2D85;}
.hdr-podcast-btn:disabled{opacity:.45;cursor:not-allowed;}
.export-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:9999;width:220px;background:var(--page);border:1px solid var(--rule2);border-radius:10px;box-shadow:0 8px 28px rgba(50,35,15,.13),0 2px 8px rgba(50,35,15,.07);overflow:hidden;animation:cardRise .18s cubic-bezier(.22,1,.36,1);}
.export-item{display:flex;align-items:center;gap:10px;width:100%;padding:10px 14px;background:none;border:none;cursor:pointer;text-align:left;transition:background .12s;}
.export-item:hover{background:var(--paper);}
.export-item-ic{font-size:18px;flex-shrink:0;}
.export-item-lbl{display:block;font-size:12px;font-weight:600;color:var(--ink);font-family:'DM Sans',sans-serif;}
.export-item-desc{display:block;font-size:10px;color:var(--ink3);font-family:'DM Sans',sans-serif;margin-top:1px;}
.hdr-sep{width:1px;height:14px;background:var(--rule2);opacity:.6;}
.hdr-wc{font-size:11px;color:var(--ink3);opacity:.6;}
.btn-link{font-size:11px;color:var(--ink3);background:none;border:none;cursor:pointer;padding:3px 7px;border-radius:4px;transition:background .15s;}
.btn-link:hover{background:var(--paper);color:var(--ink2);}

/* ── Lecture toggle & transcript ── */
.lecture-btn{display:flex;align-items:center;gap:6px;padding:5px 12px;border-radius:6px;border:1px solid var(--rule);background:var(--page);font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;color:var(--ink2);cursor:pointer;transition:all .2s;}
.lecture-btn:hover{border-color:var(--rule2);color:var(--ink);background:var(--paper);}
.lecture-btn.on{background:#1A1410;color:#fff;border-color:#1A1410;}
.lecture-btn.on:hover{background:#2C221A;}
.lecture-btn-ic{font-size:8px;opacity:.9;}
/* Pulsing red dot shown while actively recording */
.lecture-rec-dot{width:7px;height:7px;border-radius:50%;background:#E03030;flex-shrink:0;animation:recPulse 1.2s ease-in-out infinite;}
@keyframes recPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.75)}}
.lecture-panel{background:linear-gradient(180deg,var(--paper) 0%,#F5F0E8 100%);border-bottom:1px solid var(--rule);padding:12px 18px;animation:lectureSlideIn .3s cubic-bezier(.22,1,.36,1);}
@keyframes lectureSlideIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
.lecture-panel-hdr{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;flex-wrap:wrap;}
.lecture-panel-lbl{display:flex;align-items:center;gap:6px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--ink3);}
.lecture-panel-actions{display:flex;gap:6px;align-items:center;}
.lecture-panel-btn{padding:4px 10px;border-radius:5px;border:1px solid var(--rule);background:var(--page);font-family:'DM Sans',sans-serif;font-size:10px;font-weight:600;color:var(--ink2);cursor:pointer;transition:all .15s;}
.lecture-panel-btn:hover{background:var(--paper);border-color:var(--rule2);color:var(--ink);}
.lecture-pause-btn{padding:4px 10px;border-radius:5px;border:1px solid rgba(94,56,160,.3);background:rgba(94,56,160,.07);font-family:'DM Sans',sans-serif;font-size:10px;font-weight:600;color:#5E38A0;cursor:pointer;transition:all .15s;}
.lecture-pause-btn:hover{background:rgba(94,56,160,.14);border-color:rgba(94,56,160,.5);}
/* Stats row */
.lecture-stats{display:flex;align-items:center;gap:12px;margin-bottom:7px;font-size:10px;color:var(--ink3);}
.lecture-stat{display:flex;align-items:center;gap:4px;}
.lecture-stat-val{font-weight:600;color:var(--ink2);}
.lecture-transcript{max-height:68px;overflow:hidden;transition:max-height .35s cubic-bezier(.22,1,.36,1);}
.lecture-transcript.expanded{max-height:320px;overflow-y:auto;}
.lecture-text{font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.7;color:var(--ink);margin:0;word-break:break-word;}
.lecture-interim{color:var(--ink3);opacity:.7;font-style:italic;}
.lecture-placeholder{font-size:13px;color:var(--ink3);font-style:italic;margin:0;}
.lecture-footer{display:flex;align-items:center;justify-content:space-between;margin-top:7px;flex-wrap:wrap;gap:6px;}
.lecture-q-count{font-size:10px;font-weight:600;color:#5E38A0;letter-spacing:.01em;}

/* ── Lecture question highlights ── */
.lecture-q-hl{background:rgba(94,56,160,.1);border-bottom:2px solid rgba(94,56,160,.4);border-radius:2px 2px 0 0;cursor:pointer;padding:1px 0;transition:background .15s,border-color .15s;position:relative;}
.lecture-q-hl:hover{background:rgba(94,56,160,.2);border-bottom-color:rgba(94,56,160,.7);}
.lecture-q-hl.answered{background:rgba(26,104,53,.1);border-bottom-color:rgba(26,104,53,.45);}
.lecture-q-hl.answered:hover{background:rgba(26,104,53,.18);}
.lecture-q-pip{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:#5E38A0;color:#fff;font-size:8px;font-weight:700;margin-left:3px;vertical-align:middle;line-height:1;transition:background .15s;}
.lecture-q-hl.answered .lecture-q-pip{background:var(--green);}

/* ── Lecture append marker (end-of-note insert point) ── */
.lecture-append-marker{display:inline-flex;align-items:center;gap:5px;margin-left:6px;vertical-align:middle;animation:appendMarkerIn .25s cubic-bezier(.22,1,.36,1) forwards;}
@keyframes appendMarkerIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.lecture-append-pip{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#5E38A0;color:#fff;font-size:10px;box-shadow:0 0 0 3px rgba(94,56,160,.18),0 0 0 6px rgba(94,56,160,.07);animation:appendPulse 1.8s ease-in-out infinite;}
@keyframes appendPulse{0%,100%{box-shadow:0 0 0 3px rgba(94,56,160,.18),0 0 0 6px rgba(94,56,160,.07)}50%{box-shadow:0 0 0 5px rgba(94,56,160,.22),0 0 0 10px rgba(94,56,160,.09)}}
.lecture-append-label{font-size:10.5px;font-weight:600;color:#5E38A0;background:rgba(94,56,160,.08);border:1px solid rgba(94,56,160,.2);border-radius:10px;padding:2px 8px;letter-spacing:.01em;white-space:nowrap;}

/* ── Lecture question answer card ── */
.lecture-q-card{position:fixed;z-index:10000;width:360px;background:var(--page);border:1px solid var(--rule2);border-radius:12px;box-shadow:0 16px 48px rgba(50,35,15,.16),0 4px 14px rgba(50,35,15,.08);overflow:hidden;animation:cardRise .22s cubic-bezier(.22,1,.36,1);}
@keyframes cardRise{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
.lecture-q-card-hdr{padding:10px 14px;background:linear-gradient(135deg,#F7F2FF 0%,rgba(248,244,237,.9) 100%);border-bottom:1px solid rgba(94,56,160,.15);display:flex;align-items:center;justify-content:space-between;}
.lecture-q-badge{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#5E38A0;}
.lecture-q-question{font-family:'DM Sans',sans-serif;font-size:13px;color:var(--ink);font-weight:500;padding:13px 16px 0;line-height:1.55;font-style:italic;border-left:3px solid rgba(94,56,160,.35);margin:12px 16px 0;padding:8px 10px;background:rgba(94,56,160,.04);border-radius:0 5px 5px 0;}
.lecture-q-answer{
  font-family:'DM Sans',sans-serif;font-size:13.5px;line-height:1.72;color:var(--ink2);
  padding:12px 16px 14px;font-weight:400;
  overflow-y:auto;
  transition:max-height .35s cubic-bezier(.22,1,.36,1);
}
.lecture-q-answer.compact{max-height:140px;}
.lecture-q-answer.expanded{max-height:480px;}
/* Rich-text rendering inside the answer (from mdToHtml) */
.lecture-q-answer p{margin:.25rem 0;}
.lecture-q-answer strong{font-weight:600;color:var(--ink);}
.lecture-q-answer em{font-style:italic;}
.lecture-q-answer h1,.lecture-q-answer h2,.lecture-q-answer h3{
  font-weight:700;color:var(--ink);margin:.7rem 0 .25rem;font-size:13.5px;
}
.lecture-q-answer h2{font-size:13px;color:#5E38A0;}
.lecture-q-answer ul,.lecture-q-answer ol{padding-left:1.3rem;margin:.35rem 0;}
.lecture-q-answer li{margin:.15rem 0;}
.lecture-q-answer code{font-family:monospace;font-size:12px;background:rgba(0,0,0,.06);padding:1px 5px;border-radius:3px;}
.lecture-q-answer blockquote{border-left:3px solid rgba(94,56,160,.35);margin:.5rem 0;padding:.3rem .8rem;color:var(--ink3);font-style:italic;}
.lecture-q-loading{display:flex;align-items:center;gap:8px;padding:16px;color:var(--ink3);font-size:12px;font-weight:500;}
.lecture-q-btns{padding:10px 14px;background:var(--paper);border-top:1px solid var(--rule);display:flex;gap:7px;align-items:center;flex-wrap:wrap;}
/* Expand button */
.lecture-q-expand-btn{
  flex-shrink:0;
  padding:6px 11px;background:linear-gradient(135deg,rgba(94,56,160,.12),rgba(94,56,160,.18));
  color:#5E38A0;border:1px solid rgba(94,56,160,.28);border-radius:7px;
  font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;
  cursor:pointer;transition:all .15s;letter-spacing:.01em;white-space:nowrap;
}
.lecture-q-expand-btn:hover{background:linear-gradient(135deg,rgba(94,56,160,.2),rgba(94,56,160,.28));border-color:rgba(94,56,160,.5);}
.lecture-q-expand-btn.active{background:linear-gradient(135deg,#6B3EB8,#5E38A0);color:#fff;border-color:transparent;}
.lecture-q-add-btn{flex:1;padding:7px 12px;background:linear-gradient(135deg,#6B3EB8,#5E38A0);color:#fff;border:none;border-radius:7px;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;cursor:pointer;transition:opacity .15s,transform .15s;letter-spacing:.01em;}
.lecture-q-add-btn:hover{opacity:.88;transform:translateY(-1px);}
.lecture-q-add-btn.noted{background:var(--green);}
.lecture-q-refresh-btn{width:28px;height:28px;flex-shrink:0;border-radius:50%;border:1px solid var(--rule2);background:var(--page);color:var(--ink3);font-size:15px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s,border-color .15s,transform .25s;line-height:1;}
.lecture-q-refresh-btn:hover{background:var(--paper);border-color:var(--ink3);color:var(--ink);transform:rotate(60deg);}
/* Question highlight states */
.lecture-q-hl.noted{background:rgba(26,104,53,.09);border-bottom-color:rgba(26,104,53,.4);}
.lecture-q-hl.noted:hover{background:rgba(26,104,53,.16);}

/* ── Layout ── */
.layout{display:flex;flex:1;overflow:hidden;}

/* ── Notes sidebar ── */
.notes-sb{width:170px;flex-shrink:0;background:var(--paper);border-right:1px solid var(--rule);display:flex;flex-direction:column;padding:11px 8px;overflow-y:auto;}
.sb-top-row{display:flex;gap:6px;margin-bottom:9px;}
.new-btn{flex:1;padding:8px 10px;background:var(--ink);color:var(--paper);border:none;border-radius:5px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;cursor:pointer;transition:opacity .18s;}
.new-btn:hover{opacity:.78;}
.search-btn{padding:8px 12px;background:var(--ink);color:var(--paper);border:none;border-radius:5px;font-family:'DM Sans',sans-serif;font-size:15px;cursor:pointer;transition:opacity .18s;line-height:1;}
.search-btn:hover{opacity:.78;}
mark{background:rgba(234,179,8,0.3);color:inherit;border-radius:2px;padding:0 2px;}
.note-row{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:5px;cursor:pointer;transition:background .12s;margin-bottom:1px;}
.note-row:hover{background:rgba(50,35,15,.05);}
.note-row.on{background:rgba(50,35,15,.09);}
.nr-pip{width:3px;height:3px;border-radius:50%;background:var(--ink3);flex-shrink:0;opacity:.4;}
.note-row.on .nr-pip{opacity:1;background:var(--ink);}
.nr-lbl{font-size:12px;color:var(--ink2);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.note-row.on .nr-lbl{color:var(--ink);font-weight:600;}
.sb-footer{margin-top:auto;padding-top:14px;border-top:1px solid var(--rule);}
.sb-autosave{font-size:9.5px;color:#1A6835;font-weight:600;margin-bottom:10px;opacity:.75;letter-spacing:.01em;}
.sb-autosave.just-saved{animation:savedFlash .9s ease forwards;}
@keyframes savedFlash{0%{opacity:1;color:#1A6835}30%{opacity:.9;color:#117a32}100%{opacity:.75;color:#1A6835}}
.sb-autosave.sb-disk{margin-bottom:8px;}
.sb-disk-btn{display:block;width:100%;margin-bottom:12px;padding:6px 10px;font-size:10px;font-weight:600;font-family:'DM Sans',sans-serif;color:var(--ink2);background:var(--paper);border:1px solid var(--rule2);border-radius:6px;cursor:pointer;transition:all .15s;}
.sb-disk-btn:hover{background:var(--page);border-color:var(--ink3);color:var(--ink);}
.sb-ttl{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--ink3);opacity:.5;margin-bottom:8px;}
.sb-item{margin-bottom:7px;}
.sb-h{font-size:10.5px;font-weight:600;color:var(--ink2);margin-bottom:1px;}
.sb-d{font-size:9.5px;color:var(--ink3);line-height:1.4;}

/* ── Main area: doc + ann scroll together ── */
.main-area{flex:1;overflow-y:auto;background:var(--page);}
.main-inner{display:flex;min-height:100%;}

/* ── Document column ── */
.doc-col{
  flex:1;
  min-width:0;
  padding:50px 40px 160px 56px;
  position:relative;
  background-image:repeating-linear-gradient(transparent,transparent 31px,rgba(170,155,130,.11) 31px,rgba(170,155,130,.11) 32px);
  background-position:0 108px;
}
.margin-line{position:absolute;left:72px;top:0;bottom:0;width:1px;background:rgba(200,155,130,.15);pointer-events:none;}
.title-inp{font-family:'DM Sans',sans-serif;font-size:26px;font-weight:700;color:var(--ink);border:none;outline:none;background:transparent;width:100%;padding:0;line-height:1.3;margin-bottom:5px;caret-color:var(--ink);letter-spacing:-.02em;}
.title-inp::placeholder{color:#CEC6BA;}
.meta-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:10px;color:#BCB4A8;text-transform:uppercase;letter-spacing:.06em;font-weight:500;margin-bottom:18px;}
.ann-badge{padding:1px 7px;border-radius:10px;background:var(--paper);border:1px solid var(--rule2);color:var(--ink2);font-size:9px;font-weight:700;}
.divider{height:1px;background:var(--rule);margin-bottom:26px;}
.ta-wrap{position:relative;width:100%;}
/* ── Tiptap Editor ── */
.note-editor-wrap{width:100%;}
.note-editor{width:100%;min-height:60vh;padding:0;font-size:16px;line-height:1.7;cursor:text;}
.note-editor .ProseMirror{min-height:100%;outline:none;font-family:'DM Sans',sans-serif;font-size:16px;line-height:1.85;color:var(--ink);}
.note-editor .ProseMirror p.is-editor-empty:first-child::before{content:attr(data-placeholder);color:#C8C0B4;pointer-events:none;height:0;float:left;}
.note-editor h1{font-size:1.6em;font-weight:600;margin:1rem 0 .4rem;}
.note-editor h2{font-size:1.3em;font-weight:600;margin:.9rem 0 .3rem;}
.note-editor h3{font-size:1.1em;font-weight:600;margin:.8rem 0 .3rem;}
.note-editor ul,.note-editor ol{padding-left:1.4rem;margin:.5rem 0;}
.note-editor pre{background:#1e1e1e;color:#d4d4d4;border-radius:6px;padding:.75rem 1rem;font-family:monospace;font-size:13px;overflow-x:auto;}
.note-editor p{margin:.2rem 0;}
/* Toolbar */
.editor-toolbar{display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid rgba(0,0,0,.1);margin-bottom:4px;}
.editor-toolbar-btn{padding:4px 10px;border-radius:4px;border:1px solid transparent;background:transparent;cursor:pointer;font-size:13px;font-family:'DM Sans',sans-serif;}
.editor-toolbar-btn:hover{background:rgba(0,0,0,.06);}
.editor-toolbar-btn.active{background:rgba(37,99,235,.12);color:#2563eb;}
/* Selection result bar — kept for legacy compat but hidden by new design */
.sel-result-bar{display:none;}
/* Weave inline pill — anchored to the affected passage */
.weave-pill{
  position:fixed;
  display:inline-flex;
  align-items:center;
  gap:7px;
  padding:6px 14px 6px 10px;
  background:rgba(255,255,255,.97);
  border:1px solid rgba(215,205,188,.65);
  border-radius:20px;
  box-shadow:0 6px 24px rgba(50,35,15,.13),0 1px 4px rgba(50,35,15,.07);
  backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);
  font-family:'DM Sans',sans-serif;
  font-size:12.5px;
  font-weight:500;
  color:var(--ink);
  z-index:9998;
  pointer-events:none;
  white-space:nowrap;
  animation:weavePillIn .3s cubic-bezier(.34,1.56,.64,1) forwards;
}
@keyframes weavePillIn{from{opacity:0;transform:translateY(5px) scale(.92)}to{opacity:1;transform:translateY(0) scale(1)}}
.weave-pill.exiting{animation:weavePillOut .25s ease forwards;}
@keyframes weavePillOut{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.9)}}
.weave-pill-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
.weave-pill-label{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;opacity:.85;}
.weave-pill-sep{opacity:.3;margin:0 1px;}
.weave-pill-msg{color:var(--ink2);font-size:12px;}
.weave-pill-dots{display:inline-flex;gap:3px;align-items:center;margin-left:2px;}
.weave-pill-dots span{width:3.5px;height:3.5px;border-radius:50%;background:currentColor;animation:weavePillDot 1.1s ease-in-out infinite;opacity:.5;}
.weave-pill-dots span:nth-child(2){animation-delay:.17s;}
.weave-pill-dots span:nth-child(3){animation-delay:.34s;}
@keyframes weavePillDot{0%,80%,100%{opacity:.25;transform:scale(.7)}40%{opacity:.9;transform:scale(1)}}
/* Pulsing highlight on the text being rewritten */
.sugg-applying-hl{border-radius:3px;animation:applyHlPulse 1.4s ease-in-out infinite;}
@keyframes applyHlPulse{0%,100%{background:rgba(255,175,0,.22);box-shadow:0 0 0 1px rgba(255,150,0,.3)}50%{background:rgba(255,155,0,.38);box-shadow:0 0 0 2px rgba(255,130,0,.25)}}
/* Flash highlight on newly inserted/replaced text — blinks orange then settles to a soft glow */
.sugg-inserted-hl{border-radius:3px;animation:insertedFlash 3s cubic-bezier(.22,1,.36,1) forwards;}
@keyframes insertedFlash{
  0%  {background:rgba(255,125,0,.55);box-shadow:0 0 0 2px rgba(255,110,0,.4);}
  18% {background:rgba(255,150,0,.25);box-shadow:0 0 0 1px rgba(255,130,0,.2);}
  35% {background:rgba(255,125,0,.48);box-shadow:0 0 0 2px rgba(255,110,0,.35);}
  55% {background:rgba(255,145,0,.28);box-shadow:0 0 0 1px rgba(255,130,0,.18);}
  75% {background:rgba(255,160,0,.20);box-shadow:0 0 0 1px rgba(255,140,0,.12);}
  100%{background:rgba(255,170,0,.13);box-shadow:0 0 0 1px rgba(255,150,0,.08);}
}
.hl-link{color:#0A6868;text-decoration:underline;text-underline-offset:2px;pointer-events:auto;cursor:pointer;}
.hl-link:hover{color:#085555;}

/* ── Ghost hint bar (Tab/Esc hint shown when ghost is active) ── */
.ghost-hint{display:flex;align-items:center;gap:7px;margin-top:8px;padding:6px 12px;background:var(--paper);border:1px solid var(--rule);border-radius:5px;opacity:0;animation:fadeSoft .2s ease forwards;}
.ghost-hint-txt{font-size:10.5px;color:var(--ink3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.kbd{padding:2px 7px;background:var(--page);border:1px solid var(--rule2);border-radius:4px;font-size:10px;font-weight:600;color:var(--ink2);}
.ghost-esc{font-size:10px;color:#C0B8AE;}

/* ── Annotation column ── */
.ann-col{width:260px;flex-shrink:0;min-height:0;padding:24px 14px 80px 14px;background:var(--paper);border-left:1px solid rgba(215,205,188,.55);overflow-y:auto;}
.ann-col-hdr{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:var(--ink3);opacity:.55;margin-bottom:10px;padding:0;}
.ann-col-body{position:relative;width:100%;overflow:visible;}
.ann-empty{padding:12px 0;font-family:'DM Sans',sans-serif;font-size:11px;color:var(--ink3);line-height:1.5;opacity:.65;}

/* ── Annotation cards (pill style) ── */
.ann-card{
  position:relative;
  height:44px;
  background:#fff;
  border:1px solid #E5DDD4;
  border-radius:8px;
  margin-bottom:6px;
  overflow:hidden;
  transition:box-shadow .15s ease,transform .15s ease,background .15s ease;
  box-shadow:none;
  cursor:pointer;
}
.ann-card:hover{
  transform:translateY(-1px);
  box-shadow:0 3px 10px rgba(0,0,0,.09);
  background:var(--cat-tint,var(--page));
}
.ann-card.expanded{box-shadow:0 3px 10px rgba(0,0,0,.09);}
.ann-card-inner{
  display:flex;
  align-items:center;
  height:100%;
  padding:0 14px;
  gap:0;
}
.ann-card-inner .ann-tag{
  display:inline-flex;
  align-items:center;
  gap:8px;
  flex-shrink:0;
}
.ann-card-inner .ann-tag-dot{
  width:7px;
  height:7px;
  border-radius:50%;
  flex-shrink:0;
}
.ann-card-inner .ann-tag-label{
  font-size:9px;
  font-weight:700;
  letter-spacing:.12em;
  text-transform:uppercase;
}
.ann-chevron{
  font-size:14px;
  color:#C0B8AE;
  margin-left:auto;
  flex-shrink:0;
  transition:color .15s ease;
}
.ann-card:hover .ann-chevron{color:#1A1410;}
.ann-applying{
  display:flex;
  align-items:center;
  gap:6px;
  margin-left:auto;
  font-size:11px;
  color:var(--ink3);
}
.ann-enter{opacity:0;animation:annEnter .55s cubic-bezier(.22,1,.36,1) forwards;}

/* ── Reading state in suggestion panel ── */
.reading-state{display:flex;flex-direction:column;align-items:center;padding:28px 20px 24px;gap:16px;animation:annEnter .4s ease forwards;}
.reading-brand{position:relative;width:80px;height:80px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.reading-logo-img{width:80px;height:80px;object-fit:contain;object-position:center;padding:10px 6px;border-radius:50%;background:#ed7f21;position:relative;z-index:1;box-shadow:0 4px 16px rgba(237,127,33,.45);}
.reading-scan-ring{position:absolute;inset:-8px;border-radius:50%;border:1.5px solid rgba(237,127,33,.5);animation:scanRing 2s ease-in-out infinite;pointer-events:none;}
.reading-scan-ring.r2{inset:-18px;border-color:rgba(237,127,33,.28);animation-delay:.55s;animation-duration:2.5s;}
.reading-scan-ring.r3{inset:-30px;border-color:rgba(237,127,33,.12);animation-delay:1.1s;animation-duration:3s;}
@keyframes scanRing{0%{transform:scale(.88);opacity:0}25%{opacity:1}100%{transform:scale(1.1);opacity:0}}
.reading-label{font-size:11.5px;font-weight:600;color:var(--ink2);font-family:'DM Sans',sans-serif;letter-spacing:.01em;min-height:18px;text-align:center;transition:opacity .2s ease;}
.reading-label.fade-out{opacity:0;}
.reading-bars{display:flex;flex-direction:column;gap:6px;width:100%;padding:0 8px;}
.reading-bar{display:block;height:5px;background:var(--rule);border-radius:3px;animation:readPulse 1.5s ease-in-out infinite;transform-origin:left;}
@keyframes readPulse{0%,100%{opacity:.25;transform:scaleX(.88)}50%{opacity:.7;transform:scaleX(1)}}

/* ── Animated header while reading ── */
.ann-col-hdr-reading{display:inline-flex;align-items:center;gap:4px;font-weight:700;}
.ann-col-hdr-dots{display:inline-flex;gap:2px;align-items:center;margin-left:2px;}
.ann-col-hdr-dots span{width:3px;height:3px;border-radius:50%;background:currentColor;animation:hdrDot 1.2s ease-in-out infinite;}
.ann-col-hdr-dots span:nth-child(2){animation-delay:.2s;}
.ann-col-hdr-dots span:nth-child(3){animation-delay:.4s;}
@keyframes hdrDot{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}

@keyframes annEnter{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:translateX(0)}}

/* Weave overlay — blur text behind, cream tint, typing animation */
/* Legacy weave-overlay (kept for other uses) */
.weave-overlay{position:absolute;z-index:10;display:flex;align-items:flex-start;padding:10px 14px;background:rgba(248,244,237,.22);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(215,205,188,.5);border-radius:10px;pointer-events:auto;animation:weaveIn .5s cubic-bezier(.22,1,.36,1) forwards;box-shadow:0 2px 12px rgba(50,35,15,.06);overflow-y:auto;max-height:200px;}
.weave-overlay .weave-typing{font-family:'DM Sans',sans-serif;font-size:16px;line-height:1.85;color:var(--ink);white-space:pre-wrap;word-break:break-word;}
.weave-overlay .weave-cursor{display:inline-block;width:2px;height:1.05em;background:var(--ink);margin-left:1px;vertical-align:text-bottom;animation:weaveCursor 1s step-end infinite;}
@keyframes weaveIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
@keyframes weaveCursor{0%,50%{opacity:1}51%,100%{opacity:0}}

/* Suggestion textRef highlight in editor */
.hs{border-radius:2px;transition:background .2s ease,box-shadow .2s ease;animation:hsIn .3s ease forwards;}
@keyframes hsIn{from{opacity:.3}to{opacity:1}}
/* Hover-highlight decoration rendered by ProseMirror */
.sugg-hover-hl{background:rgba(255,180,0,.28);border-radius:3px;box-shadow:0 0 0 1.5px rgba(255,160,0,.35);transition:background .15s ease;}
/* Stronger tint when a docked card is open — kept via JS, not just :hover */
.docked-open .sugg-hover-hl{background:rgba(255,165,0,.35);box-shadow:0 0 0 2px rgba(255,145,0,.4);}

/* Highlight for referenced text (docked card) */
.href{border-radius:3px;transition:background .5s ease,border-color .5s ease;animation:hrefIn 1s cubic-bezier(.22,1,.36,1) forwards;}
@keyframes hrefIn{from{opacity:.5}to{opacity:1}}

/* Panel slide states */
.sugg-panel{transition:transform 1s cubic-bezier(.22,1,.36,1);}
.sugg-panel.hidden{transform:translateX(100%);}

/* Docked floating card */
.docked-card{width:300px;max-height:420px;overflow-y:auto;background:#fff;border:1px solid #DDD5C8;border-radius:10px;box-shadow:0 8px 32px rgba(50,35,15,.14),0 2px 8px rgba(50,35,15,.08);padding:14px 16px;animation:dockedIn 1s cubic-bezier(.22,1,.36,1) forwards;}
@keyframes dockedIn{from{opacity:0;transform:translateX(24px) scale(.96)}to{opacity:1;transform:translateX(0) scale(1)}}
.dc-header{display:flex;align-items:center;gap:7px;margin-bottom:10px;}
.dc-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
.dc-type{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;flex:1;}
.dc-close{background:none;border:none;color:#C0B8AE;cursor:pointer;font-size:17px;line-height:1;padding:0;}
.dc-close:hover{color:#3C2F1E;}
.dc-body{font-family:'DM Sans',sans-serif;font-size:13.5px;line-height:1.7;color:#3C2F1E;margin-bottom:14px;}
.dc-body a{color:#0A6868;text-decoration:underline;text-underline-offset:2px;}
.dc-body a:hover{color:#085555;}
.dc-articles{margin-bottom:12px;}
.dc-append-note{font-size:10px;color:#5E38A0;background:rgba(94,56,160,.07);border:1px solid rgba(94,56,160,.18);border-radius:5px;padding:5px 10px;margin:0 16px 10px;text-align:center;font-weight:500;letter-spacing:.01em;}
.dc-art-link{display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:5px;background:rgba(10,104,104,.08);border:1px solid rgba(10,104,104,.2);margin-bottom:6px;text-decoration:none;color:#0A6868;font-size:11px;transition:all .15s;}
.dc-art-link:hover{background:rgba(10,104,104,.14);border-color:#0A6868;}
.dc-art-src{font-weight:700;text-transform:uppercase;letter-spacing:.05em;flex-shrink:0;}
.dc-art-title{flex:1;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dc-btns{display:flex;gap:8px;}
.dc-apply{padding:7px 14px;background:#1A5C32;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;transition:opacity .17s;}
.dc-apply:hover{opacity:.85;}
.dc-decline{padding:7px 14px;background:transparent;color:#B84040;border:1px solid #E8C8C8;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;transition:background .15s;}
.dc-decline:hover{background:#FFF0F0;}

/* Card header */
.ann-header{display:flex;align-items:center;justify-content:space-between;padding:5px 10px 0;cursor:pointer;user-select:none;}
.ann-tag{display:inline-flex;align-items:center;gap:4px;font-size:7.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;}
.ann-tag-dot{width:4px;height:4px;border-radius:50%;flex-shrink:0;opacity:.9;}
.ann-dismiss{background:none;border:none;color:#C8C0B6;cursor:pointer;font-size:14px;line-height:1;padding:0;transition:color .12s;display:flex;align-items:center;}
.ann-dismiss:hover{color:var(--red);}

/* Expanded body */
.ann-detail-wrap{padding:8px 13px 13px;border-top:1px solid rgba(230,222,210,.7);animation:fadeUp .22s ease;}
.ann-expand-hint{font-size:9px;color:var(--ink3);opacity:.5;user-select:none;}
.ann-detail{font-family:'DM Sans',sans-serif;font-size:12px;color:var(--ink2);line-height:1.72;padding-top:11px;margin-bottom:13px;font-weight:400;}

/* ── Thinking skeleton ── */
.ann-skel{height:7px;background:var(--rule);border-radius:3px;margin:0 0 0 0;animation:skelPulse 1.5s ease-in-out infinite;}
@keyframes skelPulse{0%,100%{opacity:.35}50%{opacity:.9}}

/* ── Think dots ── */
.think-dots{display:inline-flex;gap:3px;vertical-align:middle;}
.think-dots span{width:3.5px;height:3.5px;border-radius:50%;background:var(--rule2);display:inline-block;animation:ld 1.1s ease-in-out infinite;}
.think-dots span:nth-child(2){animation-delay:.2s}
.think-dots span:nth-child(3){animation-delay:.4s}
@keyframes ld{0%,80%,100%{opacity:.2;transform:scale(.7)}40%{opacity:1;transform:scale(1)}}

/* ── Research articles ── */
.ann-articles{margin-bottom:13px;}
.ann-art-lbl{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--ink3);margin-bottom:7px;opacity:.7;}
.ann-art-link{display:flex;align-items:center;gap:6px;padding:6px 9px;border-radius:5px;background:var(--paper);border:1px solid var(--rule);margin-bottom:5px;text-decoration:none;transition:all .15s;}
.ann-art-link:hover{border-color:var(--rule2);background:#EDE7DC;transform:translateX(2px);}
.ann-art-src{font-size:8.5px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em;flex-shrink:0;}
.ann-art-title{font-family:'DM Sans',sans-serif;font-size:11.5px;color:var(--ink2);flex:1;line-height:1.4;font-weight:400;}
.ann-art-arr{font-size:12px;color:var(--ink3);flex-shrink:0;opacity:.6;}

/* ── Action buttons ── */
.ann-actions{display:flex;align-items:center;gap:4px;padding:0 10px 8px;}
.btn-more{background:none;border:none;color:var(--ink3);cursor:pointer;font-size:10px;font-weight:500;padding:2px 0;transition:color .15s;}
.btn-more:hover{color:var(--ink2);}
.ann-card.applying{opacity:.8;}
.ann-applying{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--ink3);font-weight:500;padding:2px 0;}
.ann-applying .think-dots{display:inline-flex;gap:3px;align-items:center;}
.ann-applying .think-dots span{width:4px;height:4px;border-radius:50%;background:var(--ink3);animation:dotBlink 1.1s ease-in-out infinite;}
.ann-applying .think-dots span:nth-child(2){animation-delay:.18s;}
.ann-applying .think-dots span:nth-child(3){animation-delay:.36s;}
.btn-apply{padding:6px 14px;background:var(--green);color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;letter-spacing:.02em;transition:all .15s;white-space:nowrap;}
.btn-apply:hover{opacity:.84;transform:translateY(-1px);box-shadow:0 2px 6px rgba(26,104,53,.3);}
.btn-decline{padding:6px 14px;background:transparent;color:var(--red);border:1.5px solid var(--red);border-radius:5px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;letter-spacing:.02em;transition:all .15s;white-space:nowrap;}
.btn-decline:hover{background:var(--red);color:#fff;transform:translateY(-1px);}


/* ── Popover / floating card shared buttons ── */
.btn-fill{padding:7px 15px;background:var(--green);color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:11.5px;font-weight:600;letter-spacing:.02em;transition:all .15s;white-space:nowrap;}
.btn-fill:hover{opacity:.82;transform:translateY(-1px);}
.btn-out{padding:7px 15px;background:var(--red);color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:11.5px;font-weight:600;letter-spacing:.02em;transition:all .15s;white-space:nowrap;}
.btn-out:hover{opacity:.82;transform:translateY(-1px);}
.btn-ghost{padding:7px 14px;background:var(--paper);color:var(--ink2);border:1px solid var(--rule);border-radius:5px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:11.5px;font-weight:500;transition:background .13s;white-space:nowrap;}
.btn-ghost:hover{background:var(--rule);}
.x-btn{background:none;border:none;color:#C0B8AE;cursor:pointer;font-size:18px;line-height:1;padding:0 2px;transition:color .13s;}
.x-btn:hover{color:var(--ink2);}

/* ── Note setup modal ── */
.note-setup-overlay{
  position:fixed;inset:0;z-index:11000;
  background:rgba(30,20,10,.45);backdrop-filter:blur(4px);
  display:flex;align-items:center;justify-content:center;
  animation:fadeIn .18s ease;
}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.note-setup-modal{
  width:440px;max-width:calc(100vw - 32px);
  background:var(--page);border:1px solid var(--rule2);border-radius:16px;
  box-shadow:0 24px 64px rgba(50,35,15,.22),0 8px 24px rgba(50,35,15,.12);
  overflow:hidden;animation:cardRise .25s cubic-bezier(.22,1,.36,1);
}
.note-setup-hdr{
  padding:20px 22px 16px;
  background:linear-gradient(135deg,#FDF8F2 0%,#F7F0E6 100%);
  border-bottom:1px solid var(--rule);
}
.note-setup-hdr-top{display:flex;align-items:center;gap:10px;margin-bottom:5px;}
.note-setup-icon{font-size:22px;line-height:1;}
.note-setup-title{font-size:16px;font-weight:700;color:var(--ink);letter-spacing:-.01em;}
.note-setup-sub{font-size:12.5px;color:var(--ink3);line-height:1.5;}
.note-setup-body{padding:20px 22px 8px;display:flex;flex-direction:column;gap:14px;}
.note-setup-field{display:flex;flex-direction:column;gap:5px;}
.note-setup-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--ink3);}
.note-setup-input{
  padding:9px 12px;
  background:var(--paper);border:1.5px solid var(--rule2);border-radius:8px;
  font-family:'DM Sans',sans-serif;font-size:13.5px;color:var(--ink);
  transition:border-color .15s,box-shadow .15s;outline:none;
}
.note-setup-input::placeholder{color:var(--ink3);opacity:.7;}
.note-setup-input:focus{border-color:rgba(197,120,0,.55);box-shadow:0 0 0 3px rgba(197,120,0,.1);}
.note-setup-footer{
  padding:14px 22px 18px;
  display:flex;align-items:center;justify-content:flex-end;gap:10px;
  border-top:1px solid var(--rule);margin-top:8px;
}
.note-setup-skip{
  font-size:12.5px;color:var(--ink3);background:none;border:none;
  cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500;
  padding:7px 12px;border-radius:7px;transition:color .12s,background .12s;
}
.note-setup-skip:hover{color:var(--ink);background:var(--paper);}
.note-setup-go{
  padding:8px 22px;background:linear-gradient(135deg,#C57800,#A85F00);
  color:#fff;border:none;border-radius:8px;
  font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;
  cursor:pointer;transition:opacity .15s,transform .15s;
  box-shadow:0 3px 10px rgba(165,95,0,.28);letter-spacing:.01em;
}
.note-setup-go:hover{opacity:.9;transform:translateY(-1px);}

/* ── Study podcast modal ── */
.podcast-modal{width:min(480px,calc(100vw - 28px));}
.podcast-disclosure{
  font-size:11px;line-height:1.45;color:var(--ink3);padding:10px 12px;
  background:rgba(94,56,160,.06);border:1px solid rgba(94,56,160,.12);border-radius:8px;margin-bottom:12px;
}
.podcast-progress{font-size:12px;color:var(--ink2);margin-bottom:10px;font-weight:500;}
.podcast-progress-bar{height:5px;background:var(--rule);border-radius:3px;overflow:hidden;margin-top:6px;}
.podcast-progress-fill{height:100%;background:linear-gradient(90deg,#6B3EB8,#5E38A0);border-radius:3px;transition:width .25s ease;}
.podcast-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px;}
.podcast-audio{width:100%;margin-top:12px;border-radius:8px;}
.podcast-speakers{
  display:flex;justify-content:center;align-items:flex-end;gap:20px;margin:14px 0 10px;
}
.podcast-wave-wrap{
  display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px 12px 8px;
  border-radius:12px;background:rgba(0,0,0,.03);border:1px solid var(--rule);
  transition:box-shadow .2s,border-color .2s,background .2s;
  min-width:156px;
}
.podcast-wave-wrap--dee.podcast-wave-wrap--active{
  background:rgba(197,120,0,.06);border-color:rgba(197,120,0,.22);
  box-shadow:0 4px 16px rgba(165,95,0,.12);
}
.podcast-wave-wrap--ray.podcast-wave-wrap--active{
  background:rgba(94,56,160,.07);border-color:rgba(94,56,160,.2);
  box-shadow:0 4px 16px rgba(94,56,160,.14);
}
.podcast-wave-canvas{display:block;width:152px;height:56px;border-radius:8px;}
.podcast-wave-name{font-size:11px;font-weight:600;color:var(--ink2);}
.podcast-err{font-size:12.5px;color:#B83232;line-height:1.45;margin-top:8px;}
.podcast-length-row{display:flex;align-items:center;gap:10px;margin-top:8px;margin-bottom:2px;}
.podcast-length-label{font-size:12.5px;color:var(--ink2);font-weight:600;flex-shrink:0;}
.podcast-length-slider{flex:1;min-width:0;accent-color:#A85F00;cursor:pointer;height:6px;}
.podcast-length-slider:disabled{opacity:.45;cursor:not-allowed;}
.podcast-length-val{font-size:12px;font-weight:600;color:var(--ink2);min-width:46px;white-space:nowrap;}
.podcast-length-hint{font-size:10.5px;color:var(--ink3);margin:6px 0 0;line-height:1.4;}
.podcast-overlay--ghost{background:transparent !important;backdrop-filter:none !important;pointer-events:none !important;animation:none;}
.podcast-float-root{
  position:fixed;left:0;top:0;z-index:120000;will-change:transform;
  pointer-events:none;
}
.podcast-float-inner{
  pointer-events:auto;touch-action:manipulation;
  width:min(296px,calc(100vw - 24px));
  background:var(--page);
  border:1px solid var(--rule2);
  border-radius:16px;
  box-shadow:0 16px 48px rgba(50,35,15,.25),0 6px 20px rgba(50,35,15,.12);
  padding:10px 12px 12px;
}
.podcast-float-drag{
  display:flex;align-items:center;gap:8px;cursor:grab;padding:4px 2px 8px;margin:-2px 0 4px;
  touch-action:none;user-select:none;border-bottom:1px solid var(--rule);
}
.podcast-float-drag:active{cursor:grabbing;}
.podcast-float-grip{
  width:18px;height:14px;border-radius:3px;
  background:repeating-linear-gradient(180deg,var(--ink3) 0 2px,transparent 2px 4px) center/10px 10px no-repeat;
  opacity:.5;flex-shrink:0;
}
.podcast-float-title{flex:1;font-size:13px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.podcast-float-win-btns{display:flex;gap:4px;flex-shrink:0;}
.podcast-float-icon-btn{
  background:var(--paper);border:1px solid var(--rule);border-radius:8px;width:32px;height:32px;
  cursor:pointer;font-size:15px;line-height:1;color:var(--ink2);transition:background .15s,color .15s;
}
.podcast-float-icon-btn:hover{background:var(--rule);color:var(--ink);}
.podcast-float-waves{display:flex;justify-content:center;gap:8px;margin:6px 0 8px;}
.podcast-wave-wrap--compact{min-width:0;padding:6px 8px 6px;gap:4px;}
.podcast-wave-canvas--compact{width:108px !important;height:40px !important;}
.podcast-float-transport{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.podcast-float-transport--speech{justify-content:center;flex-wrap:wrap;gap:8px;}
.podcast-float-play{
  min-width:44px;height:36px;border-radius:10px;border:none;cursor:pointer;
  background:linear-gradient(135deg,#C57800,#A85F00);color:#fff;font-size:15px;font-weight:700;
  box-shadow:0 2px 10px rgba(165,95,0,.25);
}
.podcast-float-play:disabled{opacity:.55;cursor:default;}
.podcast-float-stop{font-size:12.5px;padding:8px 12px;border-radius:8px;border:1px solid var(--rule);background:var(--paper);cursor:pointer;font-family:'DM Sans',sans-serif;}
.podcast-float-scrub{flex:1;height:5px;background:var(--rule);border-radius:4px;overflow:hidden;min-width:0;}
.podcast-float-scrub-fill{height:100%;background:linear-gradient(90deg,#C57800,#A85F00);border-radius:4px;}
.podcast-float-time{font-size:11px;font-weight:600;color:var(--ink3);width:38px;text-align:right;flex-shrink:0;}
.podcast-float-seek{width:100%;margin:0 0 8px;height:6px;accent-color:#A85F00;cursor:pointer;}
.podcast-float-actions{margin-top:4px;}
.podcast-float-q-btn{
  width:100%;padding:9px 10px;border-radius:10px;border:1px solid rgba(94,56,160,.35);
  background:rgba(94,56,160,.08);color:#5E38A0;font-size:12.5px;font-weight:600;cursor:pointer;
  font-family:'DM Sans',sans-serif;transition:background .15s,border-color .15s;
}
.podcast-float-q-btn:hover:not(:disabled){background:rgba(94,56,160,.12);}
.podcast-float-q-btn:disabled{opacity:.5;cursor:default;}
.podcast-q-panel{margin-top:10px;padding-top:10px;border-top:1px solid var(--rule);animation:podcastQIn .22s ease;}
@keyframes podcastQIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
.podcast-q-hint{font-size:11.5px;color:var(--ink3);line-height:1.45;margin:0 0 8px;}
.podcast-q-warn{font-size:11.5px;color:#B83232;margin:0 0 8px;}
.podcast-q-input{
  width:100%;resize:vertical;min-height:64px;padding:10px 12px;border-radius:10px;border:1.5px solid var(--rule2);
  font-family:'DM Sans',sans-serif;font-size:13px;color:var(--ink);background:var(--paper);margin-bottom:8px;
  box-sizing:border-box;
}
.podcast-q-input:focus{outline:none;border-color:rgba(197,120,0,.5);box-shadow:0 0 0 3px rgba(197,120,0,.1);}
.podcast-q-actions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;}
.podcast-q-send{padding:8px 16px !important;font-size:12.5px !important;}
.podcast-q-answer{background:rgba(94,56,160,.06);border-radius:10px;padding:10px 12px;margin-top:6px;}
.podcast-q-answer-label{display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#5E38A0;margin-bottom:6px;}
.podcast-q-answer-body{font-size:12.5px;color:var(--ink2);line-height:1.5;margin:0;white-space:pre-wrap;}
.podcast-minimize-top-btn{
  margin-left:6px;padding:4px 8px;border-radius:8px;border:1px solid rgba(197,120,0,.35);
  background:rgba(197,120,0,.08);color:#A85F00;font-size:14px;line-height:1;cursor:pointer;font-weight:600;
}
.podcast-minimize-top-btn:hover{background:rgba(197,120,0,.14);}
.podcast-q-open-btn{margin-right:4px;}
.sunnyd-cast-hdr{
  background:linear-gradient(135deg,#FFF9F0 0%,#FDF8F2 48%,#F5EBDC 100%) !important;
  border-bottom:1px solid rgba(197,120,0,.28) !important;
}
.sunnyd-cast-badge{
  display:inline-block;
  font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#A85F00;
  margin-bottom:6px;
}

/* ── Note metadata bar (below title) ── */
.note-meta-chips{
  display:flex;align-items:center;gap:6px;flex-wrap:wrap;
  padding:4px 0 6px;
}
.note-meta-chip{
  display:inline-flex;align-items:center;gap:4px;
  padding:3px 9px;border-radius:20px;
  background:rgba(197,120,0,.08);border:1px solid rgba(197,120,0,.2);
  font-size:11.5px;color:var(--ink2);font-weight:500;
}
.note-meta-chip-icon{font-size:11px;opacity:.7;}
.note-meta-edit-btn{
  background:none;border:none;cursor:pointer;
  font-size:12px;color:var(--ink3);padding:2px 5px;border-radius:5px;
  transition:color .12s,background .12s;line-height:1;
}
.note-meta-edit-btn:hover{color:var(--ink);background:var(--paper);}

/* ── Selection toolbar (compact dark floating bar, two-row) ── */
.sel-toolbar{
  position:fixed;z-index:9999;
  display:inline-flex;flex-direction:column;align-items:stretch;gap:0;
  background:#1A1410;border-radius:10px;
  box-shadow:0 6px 24px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.18);
  padding:4px;
  animation:selToolIn .15s cubic-bezier(.34,1.56,.64,1) forwards;
  transform:translateX(-50%);
  user-select:none;min-width:220px;
}
@keyframes selToolIn{from{opacity:0;transform:translateX(-50%) scale(.88)}to{opacity:1;transform:translateX(-50%) scale(1)}}
/* AI action row */
.sel-toolbar-acts{display:flex;align-items:center;gap:1px;}
.sel-toolbar-btn{
  display:flex;align-items:center;gap:5px;
  padding:5px 11px;border-radius:6px;
  background:none;border:none;color:rgba(255,255,255,.88);
  font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;
  cursor:pointer;transition:background .1s,color .1s;
  white-space:nowrap;
}
.sel-toolbar-btn:hover{background:rgba(255,255,255,.14);color:#fff;}
.sel-toolbar-btn-ic{font-size:11px;opacity:.7;}
.sel-toolbar-sep{width:1px;height:16px;background:rgba(255,255,255,.14);margin:0 2px;flex-shrink:0;}
/* Horizontal divider between AI row and format row */
.sel-toolbar-sep-h{height:1px;background:rgba(255,255,255,.1);margin:3px 2px;}
/* Format button row */
.sel-toolbar-fmts{display:flex;align-items:center;justify-content:center;gap:1px;padding:1px 2px;}
.sel-toolbar-fmt-btn{
  width:30px;height:26px;
  display:flex;align-items:center;justify-content:center;
  border-radius:5px;background:none;border:none;
  color:rgba(255,255,255,.65);
  cursor:pointer;transition:background .1s,color .1s;
  flex-shrink:0;
}
.sel-toolbar-fmt-btn:hover{background:rgba(255,255,255,.14);color:#fff;}
.sel-toolbar-fmt-btn.fmt-active{background:rgba(255,255,255,.22);color:#fff;}
.sel-toolbar-fmt-sep{width:1px;height:14px;background:rgba(255,255,255,.12);margin:0 2px;flex-shrink:0;}
/* Thinking pill — replaces toolbar while AI works */
.sel-thinking-pill{
  position:fixed;z-index:9999;
  display:inline-flex;align-items:center;gap:7px;
  padding:6px 14px;
  background:#1A1410;border-radius:20px;
  color:rgba(255,255,255,.8);
  font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;
  box-shadow:0 4px 18px rgba(0,0,0,.22);
  transform:translateX(-50%);
  animation:selToolIn .15s ease forwards;
  pointer-events:none;
}
/* Floating result card */
.sel-result-card{
  position:fixed;z-index:9999;width:420px;max-width:calc(100vw - 24px);
  background:var(--page);border:1px solid var(--rule2);border-radius:12px;
  box-shadow:0 16px 48px rgba(50,35,15,.16),0 4px 14px rgba(50,35,15,.08);
  overflow:hidden;
  animation:cardRise .2s cubic-bezier(.22,1,.36,1);
}
@keyframes cardRise{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
.sel-result-hdr{
  padding:10px 14px;
  background:var(--paper);border-bottom:1px solid var(--rule);
  display:flex;align-items:center;gap:8px;
}
.sel-result-badge{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--ink3);}
.sel-result-orig{
  font-size:11px;color:var(--ink3);font-style:italic;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;max-width:260px;
}
.sel-result-close{background:none;border:none;color:var(--ink3);cursor:pointer;font-size:16px;line-height:1;padding:0;margin-left:auto;}
.sel-result-close:hover{color:var(--ink);}
.sel-result-op{
  font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;
  padding:2px 7px;border-radius:4px;flex-shrink:0;
}
.sel-result-op.replace{background:rgba(197,84,0,.1);color:#C04500;}
.sel-result-op.add{background:rgba(26,104,53,.1);color:#1A6835;}
.sel-result-body{
  padding:14px 16px;font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.75;
  color:var(--ink);overflow-y:auto;max-height:200px;
}
.sel-result-body p{margin:.2rem 0;}
.sel-result-body strong{font-weight:600;}
.sel-result-body em{font-style:italic;}
.sel-result-body code{font-family:monospace;font-size:12px;background:#1e1e1e;color:#d4d4d4;padding:1px 5px;border-radius:3px;}
.sel-result-body ul,.sel-result-body ol{padding-left:1.3rem;margin:.4rem 0;}
.sel-result-body h1,.sel-result-body h2,.sel-result-body h3{font-weight:600;margin:.6rem 0 .3rem;}
.sel-result-expl{font-size:11.5px;color:var(--ink3);padding:0 16px 12px;line-height:1.5;}
.sel-result-btns{
  padding:10px 14px;background:var(--paper);border-top:1px solid var(--rule);
  display:flex;gap:8px;align-items:center;
}
/* Legacy sel-act kept but unused */
.sel-hd,.sel-act,.sel-act-ic,.sel-act-lbl,.sel-act-desc{display:none;}

/* ── Selection inline preview (below highlighted section) ── */
.sel-pending{background:rgba(94,56,160,.08);border-bottom:2px solid rgba(94,56,160,.25);border-radius:3px 3px 0 0;}
.sel-strike{background:rgba(184,48,48,.06);text-decoration:line-through;text-decoration-color:var(--red);color:var(--ink3);border-radius:3px;}
.sel-inline-add{display:block;font-family:'DM Sans',sans-serif;font-size:16px;line-height:1.85;color:var(--ink2);background:linear-gradient(135deg,rgba(26,104,53,.04) 0%,rgba(26,104,53,.08) 100%);border-radius:4px;padding:8px 12px;margin:6px 0;border-left:3px solid var(--green);max-height:320px;overflow-y:auto;overflow-x:hidden;white-space:pre-wrap;word-break:break-word;pointer-events:auto;}
.sel-inline-preview{margin:14px 0 20px;padding:0;background:var(--page);border:1px solid var(--rule2);border-radius:12px;box-shadow:0 6px 24px rgba(50,35,15,.1),0 2px 8px rgba(50,35,15,.04);animation:selPreviewIn .4s cubic-bezier(.22,1,.36,1) forwards;pointer-events:auto;cursor:default;overflow:hidden;}
.sel-preview-hdr{padding:10px 18px;background:linear-gradient(180deg,var(--paper) 0%,rgba(248,244,237,.6) 100%);border-bottom:1px solid var(--rule);}
.sel-preview-badge{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--ink3);}
.sel-preview-body{font-family:'DM Sans',sans-serif;font-size:15px;line-height:1.75;color:var(--ink);padding:16px 18px;font-weight:400;}
.sel-preview-hint{font-size:11px;color:var(--ink3);line-height:1.5;padding:0 18px 12px;font-weight:500;}
.sel-overview{font-size:13px;color:var(--ink2);line-height:1.6;padding:16px 18px;font-weight:500;}
.sel-preview-btns{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:14px 18px;background:var(--paper);border-top:1px solid var(--rule);}
.sel-preview-btns .btn-apply{padding:9px 20px;background:var(--green);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;letter-spacing:.02em;transition:all .18s;white-space:nowrap;box-shadow:0 2px 8px rgba(26,104,53,.25);}
.sel-preview-btns .btn-apply:hover{opacity:.92;transform:translateY(-1px);box-shadow:0 4px 12px rgba(26,104,53,.3);}
.sel-preview-btns .btn-decline{padding:9px 20px;background:transparent;color:var(--ink3);border:1.5px solid var(--rule2);border-radius:8px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;letter-spacing:.02em;transition:all .18s;white-space:nowrap;}
.sel-preview-btns .btn-decline:hover{background:rgba(184,48,48,.06);color:var(--red);border-color:rgba(184,48,48,.4);}
@keyframes selPreviewIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}

/* ── Pop ── */
.pop{position:fixed;z-index:9998;width:330px;max-height:calc(100vh - 48px);overflow-y:auto;background:var(--page);border-radius:10px;border:1px solid var(--rule2);box-shadow:0 10px 34px rgba(50,35,15,.1);padding:16px 18px;animation:cardRise .18s cubic-bezier(.22,1,.36,1);}
.pop-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:11px;}
.pop-type{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--ink3);}
.pop-q{font-family:'DM Sans',sans-serif;font-size:13.5px;line-height:1.6;color:var(--ink);font-weight:500;margin-bottom:12px;}
.pop-txt{font-size:13.5px;color:var(--ink);font-weight:500;margin-bottom:10px;line-height:1.5;}
.pop-ans{font-family:'DM Sans',sans-serif;font-size:13px;line-height:1.68;color:var(--ink2);border-left:2px solid var(--rule2);padding:8px 12px;background:var(--paper);border-radius:0 6px 6px 0;margin-bottom:12px;font-weight:400;}
.pop-socratic{margin-bottom:12px;}
.pop-socratic-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--ink3);margin-bottom:6px;}
.pop-socratic .pop-ans{border-left-color:#5E38A0;white-space:pre-line;}
.pop-prev{font-family:'DM Sans',sans-serif;font-size:12.5px;color:var(--ink3);padding:9px 12px;background:var(--paper);border-radius:6px;border:1px solid var(--rule);line-height:1.65;margin-bottom:12px;font-weight:400;}
.pop-prev-lbl{font-family:'DM Sans',sans-serif;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--ink3);display:block;margin-bottom:4px;}
.pop-btns{display:flex;gap:7px;flex-wrap:wrap;}
.ldots{display:flex;gap:4px;padding:6px 0;}
.ldots span{width:4px;height:4px;border-radius:50%;background:var(--rule2);animation:ld 1.1s ease-in-out infinite;}
.ldots span:nth-child(2){animation-delay:.2s}.ldots span:nth-child(3){animation-delay:.4s}

/* ── LLM thinking animation (Give me the answer) ── */
.pop-thinking{display:flex;align-items:center;gap:8px;padding:14px 16px;margin:12px 0;background:linear-gradient(90deg,rgba(94,56,160,.06) 0%,rgba(94,56,160,.02) 50%,rgba(94,56,160,.06) 100%);border-radius:8px;border:1px solid rgba(94,56,160,.12);animation:popThinkIn .4s ease-out forwards;}
.pop-thinking-txt{font-size:12px;font-weight:500;color:var(--ink2);letter-spacing:.02em;}
.pop-thinking-dots{display:flex;gap:4px;align-items:center;}
.pop-thinking-dots span{width:5px;height:5px;border-radius:50%;background:var(--ink2);opacity:.5;animation:thinkDot 1.4s ease-in-out infinite;}
.pop-thinking-dots span:nth-child(1){animation-delay:0s}
.pop-thinking-dots span:nth-child(2){animation-delay:.18s}
.pop-thinking-dots span:nth-child(3){animation-delay:.36s}
@keyframes popThinkIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
@keyframes thinkDot{0%,60%,100%{opacity:.25;transform:scale(.75)}30%{opacity:1;transform:scale(1.1)}}

/* ── Shared animations ── */
@keyframes fadeSoft{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:var(--rule2);border-radius:10px;}
`;

/* ─── Providers (shared) ──────────────────────────────────────────────────── */
const PROVIDERS = [
  { id: "openai", name: "OpenAI", placeholder: "sk-...", keyPrefix: "sk-", url: "https://platform.openai.com/api-keys" },
  { id: "claude", name: "Claude", placeholder: "sk-ant-...", keyPrefix: "sk-ant-", url: "https://console.anthropic.com/settings/keys" },
  { id: "gemini", name: "Gemini", placeholder: "AIza...", keyPrefix: "AIza", url: "https://aistudio.google.com/apikey" },
];

/* ─── Toolbar ────────────────────────────────────────────────────────────── */
function Toolbar({ editor }) {
  if (!editor) return null;
  const btn = (label, action, activeCheck, tooltip) => (
    <button
      className={`editor-toolbar-btn${editor.isActive(activeCheck) ? " active" : ""}`}
      onMouseDown={e => { e.preventDefault(); action(); }}
      title={tooltip || label}
    >
      {label}
    </button>
  );
  return (
    <div className="editor-toolbar">
      {btn("B",       () => editor.chain().focus().toggleBold().run(),                    "bold",     `Bold (${MOD_KEY}+B)`)}
      {btn("I",       () => editor.chain().focus().toggleItalic().run(),                  "italic",   `Italic (${MOD_KEY}+I)`)}
      {btn("H1",      () => editor.chain().focus().toggleHeading({ level: 1 }).run(),     { type: "heading", attrs: { level: 1 } }, "Heading 1")}
      {btn("H2",      () => editor.chain().focus().toggleHeading({ level: 2 }).run(),     { type: "heading", attrs: { level: 2 } }, "Heading 2")}
      {btn("• List",  () => editor.chain().focus().toggleBulletList().run(),              "bulletList", "Bullet list")}
      {btn("</> Block", () => editor.chain().focus().toggleCodeBlock().run(),             "codeBlock",  "Code block")}
    </div>
  );
}

/* ─── NoteEditor hover-highlight ProseMirror plugin ─────────────────────── */
const hoverHlKey = new PluginKey("hoverHighlight");
const hoverHlPlugin = new Plugin({
  key: hoverHlKey,
  state: {
    init() { return null; },
    apply(tr, value) {
      const meta = tr.getMeta(hoverHlKey);
      return meta !== undefined ? meta : value;
    },
  },
  props: {
    decorations(state) {
      const range = this.getState(state);
      if (!range) return DecorationSet.empty;
      return DecorationSet.create(state.doc, [
        Decoration.inline(range.from, range.to, { class: "sugg-hover-hl" }),
      ]);
    },
  },
});

const HoverHighlightExtension = Extension.create({
  name: "hoverHighlight",
  addProseMirrorPlugins() { return [hoverHlPlugin]; },
});

/* ─── Applying-highlight plugin (pulsing amber while AI rewrites a passage) ─ */
const applyingHlKey = new PluginKey("applyingHighlight");
const applyingHlPlugin = new Plugin({
  key: applyingHlKey,
  state: {
    init() { return null; },
    apply(tr, value) {
      const meta = tr.getMeta(applyingHlKey);
      return meta !== undefined ? meta : value;
    },
  },
  props: {
    decorations(state) {
      const range = this.getState(state);
      if (!range) return DecorationSet.empty;
      return DecorationSet.create(state.doc, [
        Decoration.inline(range.from, range.to, { class: "sugg-applying-hl" }),
      ]);
    },
  },
});

const ApplyingHighlightExtension = Extension.create({
  name: "applyingHighlight",
  addProseMirrorPlugins() { return [applyingHlPlugin]; },
});

/* ─── Inserted-highlight plugin (blink-then-glow after text is applied) ─── */
const insertedHlKey = new PluginKey("insertedHighlight");
const insertedHlPlugin = new Plugin({
  key: insertedHlKey,
  state: {
    init() { return null; },
    apply(tr, value) {
      const meta = tr.getMeta(insertedHlKey);
      return meta !== undefined ? meta : value;
    },
  },
  props: {
    decorations(state) {
      const range = this.getState(state);
      if (!range) return DecorationSet.empty;
      return DecorationSet.create(state.doc, [
        Decoration.inline(range.from, range.to, { class: "sugg-inserted-hl" }),
      ]);
    },
  },
});

const InsertedHighlightExtension = Extension.create({
  name: "insertedHighlight",
  addProseMirrorPlugins() { return [insertedHlPlugin]; },
});

/* Find a text string in a ProseMirror doc, return {from, to} doc positions */
function findTextInDoc(doc, searchText) {
  if (!searchText) return null;
  let text = "";
  const positions = [];
  doc.descendants((node, pos) => {
    if (node.isText) {
      for (let i = 0; i < (node.text || "").length; i++) {
        text += node.text[i];
        positions.push(pos + i);
      }
    }
  });
  // Try direct match first, then normalised whitespace match
  let idx = text.indexOf(searchText);
  if (idx === -1) {
    const norm = s => s.replace(/\s+/g, " ").trim();
    const normNeedle = norm(searchText);
    const normHaystack = norm(text);
    idx = normHaystack.indexOf(normNeedle);
  }
  if (idx === -1 || idx >= positions.length) return null;
  const endIdx = Math.min(idx + searchText.length - 1, positions.length - 1);
  return { from: positions[idx], to: positions[endIdx] + 1 };
}

/* ─── NoteEditor ─────────────────────────────────────────────────────────── */
const NoteEditor = forwardRef(function NoteEditor({ content, onChange, onKeyDown }, ref) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Start writing — SunnyD will assist as you go." }),
      HoverHighlightExtension,
      ApplyingHighlightExtension,
      InsertedHighlightExtension,
    ],
    content: content || "",
    onUpdate({ editor }) {
      onChange({ text: editor.getText(), html: editor.getHTML() });
    },
  });

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    insertAtCursor(text) {
      editor?.commands.insertContent(text);
    },
    /* Append rich HTML at the very end of the document (moves cursor there first) */
    appendContent(html) {
      if (!editor) return;
      editor.chain().focus("end").insertContent(html).run();
    },
    getSelection() {
      if (!editor) return "";
      const { from, to } = editor.state.selection;
      return editor.state.doc.textBetween(from, to, " ");
    },
    replaceSelection(text) {
      editor?.chain().focus().deleteSelection().insertContent(text).run();
    },
    setEditorContent(html) {
      if (editor) editor.commands.setContent(html || "", false);
    },
    getEditorDom() {
      return editor?.view?.dom ?? null;
    },
    /* Highlight text in the editor matching textRef (called on suggestion hover) */
    setHoverHighlight(textRef) {
      if (!editor) return;
      if (!textRef) {
        editor.view.dispatch(editor.state.tr.setMeta(hoverHlKey, null));
        return;
      }
      const range = findTextInDoc(editor.state.doc, textRef);
      if (range) {
        editor.view.dispatch(editor.state.tr.setMeta(hoverHlKey, range));
      }
    },
    clearHoverHighlight() {
      if (!editor) return;
      editor.view.dispatch(editor.state.tr.setMeta(hoverHlKey, null));
    },
    /* Surgically replace oldText with replacementHTML in the editor */
    findAndReplaceText(oldText, replacementHTML) {
      if (!editor || !oldText) return false;
      const range = findTextInDoc(editor.state.doc, oldText);
      if (!range) return false;
      editor.chain().deleteRange(range).insertContentAt(range.from, replacementHTML).run();
      return true;
    },
    /* Insert HTML content immediately after the block node that contains anchorText.
       We resolve range.to to find its parent top-level block (paragraph, heading, etc.)
       and insert AFTER that whole block — never mid-paragraph. */
    insertAfterText(anchorText, insertionHTML) {
      if (!editor || !anchorText) return false;
      const range = findTextInDoc(editor.state.doc, anchorText);
      if (!range) return false;
      try {
        const $to = editor.state.doc.resolve(range.to);
        // $to.after(depth) = position right after the node at that depth.
        // depth=1 is always the top-level block inside the document (paragraph, heading, list…).
        const insertPos = $to.depth >= 1 ? $to.after(1) : range.to;
        editor.commands.insertContentAt(insertPos, insertionHTML);
      } catch {
        // Fallback: insert at range.to if resolve fails
        editor.commands.insertContentAt(range.to, insertionHTML);
      }
      return true;
    },
    /* Get the current HTML content of the editor */
    getEditorContent() {
      return editor?.getHTML() ?? "";
    },
    /* Get the viewport bounding rect of the current text selection */
    getSelectionRect() {
      if (!editor) return null;
      const { from, to } = editor.state.selection;
      if (from === to) return null;
      try {
        const s = editor.view.coordsAtPos(from);
        const e = editor.view.coordsAtPos(to);
        return { top: Math.min(s.top, e.top), bottom: Math.max(s.bottom, e.bottom), left: Math.min(s.left, e.left), right: Math.max(s.right, e.right) };
      } catch { return null; }
    },
    /* Pulsing highlight while AI is rewriting a passage */
    setApplyingHighlight(textRef) {
      if (!editor || !textRef) return;
      const range = findTextInDoc(editor.state.doc, textRef);
      if (range) editor.view.dispatch(editor.state.tr.setMeta(applyingHlKey, range));
    },
    clearApplyingHighlight() {
      if (!editor) return;
      editor.view.dispatch(editor.state.tr.setMeta(applyingHlKey, null));
    },
    /* Blink-then-glow highlight on newly inserted/replaced text */
    setInsertedHighlight(searchText) {
      if (!editor || !searchText) return;
      // Use first ~100 chars as search key; trim trailing whitespace
      const key = searchText.trim().slice(0, 100);
      const range = findTextInDoc(editor.state.doc, key);
      if (range) editor.view.dispatch(editor.state.tr.setMeta(insertedHlKey, range));
    },
    clearInsertedHighlight() {
      if (!editor) return;
      editor.view.dispatch(editor.state.tr.setMeta(insertedHlKey, null));
    },
    /* Apply a format (bold/italic/h1/h2/bulletList/code) to the current selection */
    applyFormat(type) {
      if (!editor) return;
      const map = {
        bold:       () => editor.chain().focus().toggleBold().run(),
        italic:     () => editor.chain().focus().toggleItalic().run(),
        h1:         () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        h2:         () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        bulletList: () => editor.chain().focus().toggleBulletList().run(),
        code:       () => editor.chain().focus().toggleCode().run(),
      };
      map[type]?.();
    },
    /* Return which marks/nodes are active at the current selection */
    getFormatState() {
      if (!editor) return {};
      return {
        bold:       editor.isActive('bold'),
        italic:     editor.isActive('italic'),
        h1:         editor.isActive('heading', { level: 1 }),
        h2:         editor.isActive('heading', { level: 2 }),
        bulletList: editor.isActive('bulletList'),
        code:       editor.isActive('code'),
      };
    },
    /* Scroll the editor viewport so that the first occurrence of searchText is visible */
    scrollToText(searchText) {
      if (!editor || !searchText) return false;
      const range = findTextInDoc(editor.state.doc, searchText.trim().slice(0, 80));
      if (!range) return false;
      editor.chain().setTextSelection(range.from).scrollIntoView().run();
      return true;
    },
  }), [editor]);

  // Sync content when note changes (note switching)
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "", false);
    }
  }, [content, editor]);

  // Forward keyboard events
  useEffect(() => {
    const dom = editor?.view?.dom;
    if (!dom || !onKeyDown) return;
    dom.addEventListener("keydown", onKeyDown);
    return () => dom.removeEventListener("keydown", onKeyDown);
  }, [editor, onKeyDown]);

  return (
    <div className="note-editor-wrap">
      <Toolbar editor={editor} />
      <div className="note-editor">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});

/* ─── SearchPalette ──────────────────────────────────────────────────────── */
function SearchPalette({ notes, onSelectNote, onClose }) {
  const [query, setQuery]           = useState("");
  const [results, setResults]       = useState([]);
  const [loading, setLoading]       = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [hovered, setHovered]       = useState(null);
  const inputRef = useRef(null);
  const searchTimer = useRef(null);

  // Focus input + backfill missing embeddings on mount
  useEffect(() => {
    inputRef.current?.focus();
    (async () => {
      const embeddings = loadEmbeddings();
      const missing = notes.filter(n => !embeddings[n.id] && (n.content || "").trim().length > 50);
      if (missing.length === 0) return;
      setBackfilling(true);
      for (const note of missing) {
        const plain = note.content.replace(/<[^>]+>/g, " ").trim();
        const vec = await embedText(plain);
        if (vec) saveEmbedding(note.id, vec, simpleHash(plain));
        await new Promise(r => setTimeout(r, 150));
      }
      setBackfilling(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search on query change
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchNotes(query, notes);
        setResults(res);
      } catch { setResults([]); }
      setLoading(false);
    }, 350);
    return () => clearTimeout(searchTimer.current);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusLabel = loading ? "searching…" : backfilling ? "indexing…" : "";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "15vh",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg, #fff)",
          borderRadius: 12,
          width: "100%", maxWidth: 560,
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.22)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Input row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid rgba(0,0,0,0.08)", padding: "12px 16px" }}>
          <span style={{ fontSize: 18, opacity: 0.45, lineHeight: 1 }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") onClose(); }}
            placeholder="Search notes…"
            style={{ border: "none", outline: "none", flex: 1, fontSize: 15, background: "transparent", fontFamily: "inherit", color: "inherit" }}
          />
          {statusLabel && (
            <span style={{ fontSize: 12, opacity: 0.5, whiteSpace: "nowrap" }}>{statusLabel}</span>
          )}
        </div>

        {/* Results */}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 360, overflowY: "auto" }}>
          {results.map(({ note, score, excerpt }) => (
            <li
              key={note.id}
              style={{
                padding: "12px 16px",
                cursor: "pointer",
                borderBottom: "1px solid rgba(0,0,0,0.05)",
                background: hovered === note.id ? "rgba(0,0,0,0.04)" : "transparent",
                transition: "background 0.1s",
              }}
              onMouseEnter={() => setHovered(note.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => { onSelectNote(note.id); onClose(); }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 500, fontSize: 14 }}>{note.title || "Untitled"}</span>
                <span style={{ fontSize: 11, opacity: 0.4 }}>{Math.round(score * 100)}% match</span>
              </div>
              <div
                style={{ fontSize: 13, opacity: 0.6, lineHeight: 1.5, marginTop: 4 }}
                dangerouslySetInnerHTML={{ __html: excerpt }}
              />
            </li>
          ))}
        </ul>

        {/* Empty state */}
        {query.trim() && !loading && results.length === 0 && (
          <div style={{ textAlign: "center", fontSize: 14, opacity: 0.5, padding: "20px 16px" }}>
            No matching notes
          </div>
        )}

        {/* Footer */}
        {!query.trim() && (
          <div style={{ fontSize: 12, opacity: 0.4, padding: "10px 16px 12px" }}>
            {notes.length} note{notes.length !== 1 ? "s" : ""} indexed
          </div>
        )}
      </div>
    </div>
  );
}

function KeyScreen({ onSave }) {
  const [provider, setProvider] = useState(() => { try { return sessionStorage.getItem("sd_provider") || "openai"; } catch { return "openai"; } });
  const [val, setVal] = useState(() => { try { return sessionStorage.getItem(`sd_key_${sessionStorage.getItem("sd_provider") || "openai"}`) || ""; } catch { return ""; } });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const p = PROVIDERS.find(x => x.id === provider) || PROVIDERS[0];

  const handleProviderChange = (newProvider) => {
    setProvider(newProvider);
    setErr("");
    try { setVal(sessionStorage.getItem(`sd_key_${newProvider}`) || ""); } catch { setVal(""); }
  };

  const submit = async () => {
    const k = val.trim();
    if (!k) { setErr("Please enter your API key."); return; }
    setLoading(true); setErr("");
    try {
      await ai(provider, k, "Reply with the single word: ready", "ping", 10);
      onSave(provider, k);
    } catch (e) {
      const msg = (e.message || "").toLowerCase();
      // Some providers error on very short max_tokens — still accept the key
      if (msg.includes("max_tokens") || msg.includes("maximum") || msg.includes("token") || msg.includes("content_policy")) {
        onSave(provider, k);
      } else {
        setErr(e.message?.slice(0, 120) || "Could not connect — check your key and try again.");
      }
    } finally { setLoading(false); }
  };

  return (
    <div className="key-screen">
      <div className="key-card">
        <img src="/sunnyd-logo.png" alt="SunnyD" className="key-mark-logo" />
        <div className="key-title">SunnyD Notes</div>
        <div className="key-sub">AI-assisted note-taking with full client-side control. Open-source and self-hosted — your API keys are stored locally and only sent to the provider you choose.</div>
        <label className="key-lbl">LLM Provider</label>
        <select className="key-select" value={provider} onChange={e => handleProviderChange(e.target.value)}>
          {PROVIDERS.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <label className="key-lbl">{p.name} API Key</label>
        <input className="key-inp" type="password" placeholder={p.placeholder} value={val}
          onChange={e => { setVal(e.target.value); setErr(""); }}
          onKeyDown={e => e.key === "Enter" && !loading && submit()} autoFocus />
        {err && <div className="key-err">{err}</div>}
        <button className="key-btn" onClick={submit} disabled={loading || !val.trim()}>
          {loading ? "Verifying…" : "Continue"}
        </button>
        <div className="key-note">
          Get an API key at <a href={p.url} target="_blank" rel="noreferrer">{p.url.replace("https://", "")}</a>
        </div>
      </div>
    </div>
  );
}

/* ─── FactPop ─────────────────────────────────────────────────────────────── */
function FactPop({ ann, onDismiss, onClose, onApply }) {
  const [phase, setPhase] = useState("q");
  return (
    <>
      <div className="pop-hd"><span className="pop-type">Fact Check</span><button className="x-btn" onClick={onClose}>×</button></div>
      {phase === "q" && (
        <><p className="pop-q">{ann.data?.question}</p>
        <div className="pop-btns">
          <button className="btn-fill" onClick={() => setPhase("c")}>Show correction</button>
          <button className="btn-out" onClick={onDismiss}>Dismiss</button>
        </div></>
      )}
      {phase === "c" && (
        <><div className="pop-ans">{ann.data?.correction}</div>
        <div className="pop-btns">
          {ann.data?.replacement && <button className="btn-fill" onClick={() => setPhase("p")}>Apply to notes</button>}
          <button className="btn-out" onClick={onDismiss}>Dismiss</button>
        </div></>
      )}
      {phase === "p" && (
        <><div className="pop-prev"><span className="pop-prev-lbl">Will replace with</span>{ann.data.replacement}</div>
        <div className="pop-btns">
          <button className="btn-fill" onClick={() => onApply(ann)}>✓ Confirm</button>
          <button className="btn-out" onClick={() => setPhase("c")}>Back</button>
        </div></>
      )}
    </>
  );
}

/* ─── Main ───────────────────────────────────────────────────────────────── */
export default function SunnyDNotes() {
  const [llmProvider, setLlmProvider] = useState(() => { try { return sessionStorage.getItem("sd_provider") || "openai"; } catch { return "openai"; } });
  const [apiKey,      setApiKey]      = useState(() => {
    try {
      const p = sessionStorage.getItem("sd_provider") || "openai";
      return sessionStorage.getItem(`sd_key_${p}`) || sessionStorage.getItem("sd_key") || "";
    } catch { return ""; }
  });
  const [notes,       setNotes]       = useState(() => loadNotes());
  const [activeId,    setActiveId]    = useState(() => { const n = loadNotes(); return loadActiveId(n); });
  const [suggestions, setSugg]        = useState([]);
  const [shownSuggIds,   setShownSuggIds]   = useState(new Set());
  const [hoveredSuggId,  setHoveredSuggId]  = useState(null);
  const [dockedCard,     setDockedCard]     = useState(null);
  const [panelHidden,    setPanelHidden]    = useState(false);
  const [ghost,       setGhost]       = useState(null);
  const [ghostThinking, setGhostThinking] = useState(false);
  const [selMenu,     setSelMenu]     = useState(null);
  const [selRes,      setSelRes]      = useState(null);
  const [selThinking, setSelThinking] = useState(null); // { action, x, y }
  const [busy,        setBusy]        = useState(false);
  const [statusTxt,   setStatus]      = useState("");
  const [copied,      setCopied]      = useState(false);
  const [suggFreq,    setSuggFreq]    = useState(() => { try { return sessionStorage.getItem("sd_suggFreq") || "balanced"; } catch { return "balanced"; } });
  const [lectureOn,   setLectureOn]   = useState(false);
  const [lecturePaused, setLecturePaused] = useState(false);
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [lectureQs,   setLectureQs]   = useState([]); // detected questions in transcript
  const [activeLectureQ, setActiveLectureQ] = useState(null); // { q, x, y }
  const [lectureQCopied, setLectureQCopied] = useState(false);
  const [lectureQAdded,  setLectureQAdded]  = useState(false);
  const [lectureQRefreshing, setLectureQRefreshing] = useState(false);
  const [lectureQGenerating, setLectureQGenerating] = useState(false); // auto-generating missing answer
  const [lectureQExpanding,  setLectureQExpanding]  = useState(false); // generating long expanded answer
  // Note setup modal — null = hidden; pendingId = number means creating new note; null pendingId = editing existing
  const [noteSetupModal, setNoteSetupModal] = useState(null); // { pendingId, subject, professor, goal }
  const [notedQIds, setNotedQIds] = useState(new Set()); // Q IDs added to notes
  const [lectureSecs, setLectureSecs] = useState(0); // session duration counter
  const lectureTimerRef = useRef(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [savingToDisk, setSavingToDisk] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [podcastOpen, setPodcastOpen] = useState(false);
  const [podcastPhase, setPodcastPhase] = useState("idle");
  const [podcastMsg, setPodcastMsg] = useState("");
  const [podcastErr, setPodcastErr] = useState("");
  const [podcastTtsProg, setPodcastTtsProg] = useState({ cur: 0, total: 0 });
  const [podcastAudioUrl, setPodcastAudioUrl] = useState(null);
  const [podcastTitle, setPodcastTitle] = useState("");
  const [podcastBrowserMode, setPodcastBrowserMode] = useState(false);
  const [podcastTurns, setPodcastTurns] = useState([]);
  const [podcastSpeaking, setPodcastSpeaking] = useState(false);
  const [podcastVoiceKind, setPodcastVoiceKind] = useState(null);
  const [podcastMaxMinutes, setPodcastMaxMinutes] = useState(() => {
    try {
      const s = sessionStorage.getItem(LS_CAST_MAX_MIN);
      if (s == null) return 7;
      return clampPodcastMinutes(Number(s));
    } catch {
      return 7;
    }
  });
  const [podcastActiveSpeaker, setPodcastActiveSpeaker] = useState(null);
  const [podcastAudioSegments, setPodcastAudioSegments] = useState([]);
  const [podcastMinimized, setPodcastMinimized] = useState(false);
  const [podcastFloatPos, setPodcastFloatPos] = useState({ x: 16, y: 16 });
  const [podcastQuestionOpen, setPodcastQuestionOpen] = useState(false);
  const [podcastQuestionText, setPodcastQuestionText] = useState("");
  const [podcastQuestionAnswer, setPodcastQuestionAnswer] = useState("");
  const [podcastQuestionBusy, setPodcastQuestionBusy] = useState(false);
  const podcastAbortRef = useRef(null);
  const podcastAudioRef = useRef(null);
  const podcastAnalyserRef = useRef(null);
  const lastPodcastSpeakerRef = useRef(null);

  const podcastTimeAnchors = useMemo(() => podcastTurnTimelineSec(podcastTurns), [podcastTurns]);

  const syncPodcastSpeakerFromAudio = useCallback(() => {
    const el = podcastAudioRef.current;
    if (!el || podcastBrowserMode) return;
    if (el.ended) {
      lastPodcastSpeakerRef.current = null;
      setPodcastActiveSpeaker(null);
      return;
    }
    let next = null;
    const realSeg = podcastAudioSegments.length > 0;
    if (realSeg) {
      next = activePodcastSpeakerFromSegments(
        podcastAudioSegments,
        el.currentTime,
        el.duration,
        false
      );
    } else {
      const d = el.duration;
      let t = el.currentTime;
      const lastEnd = podcastTimeAnchors.length ? podcastTimeAnchors[podcastTimeAnchors.length - 1].end : 0;
      if (Number.isFinite(d) && d > 0.1 && lastEnd > 0) {
        t = (el.currentTime / d) * lastEnd;
      }
      next = activePodcastSpeakerFromTimeline(podcastTimeAnchors, t);
    }
    if (lastPodcastSpeakerRef.current !== next) {
      lastPodcastSpeakerRef.current = next;
      setPodcastActiveSpeaker(next);
    }
  }, [podcastTimeAnchors, podcastAudioSegments, podcastBrowserMode]);

  useEffect(() => {
    const el = podcastAudioRef.current;
    if (!el || podcastBrowserMode) return undefined;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      syncPodcastSpeakerFromAudio();
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      syncPodcastSpeakerFromAudio();
    };
    el.addEventListener("play", start);
    el.addEventListener("pause", stop);
    el.addEventListener("ended", stop);
    el.addEventListener("seeked", syncPodcastSpeakerFromAudio);
    if (!el.paused && !el.ended) start();
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("play", start);
      el.removeEventListener("pause", stop);
      el.removeEventListener("ended", stop);
      el.removeEventListener("seeked", syncPodcastSpeakerFromAudio);
    };
  }, [podcastAudioUrl, podcastBrowserMode, syncPodcastSpeakerFromAudio]);

  useEffect(() => {
    if (!podcastAudioRef.current || podcastBrowserMode) return;
    syncPodcastSpeakerFromAudio();
  }, [podcastAudioSegments, podcastBrowserMode, syncPodcastSpeakerFromAudio]);

  useEffect(() => {
    if (!podcastOpen || !podcastAudioUrl || podcastBrowserMode) {
      podcastAnalyserRef.current = null;
      return undefined;
    }
    const el = podcastAudioRef.current;
    if (!el) return undefined;
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx;
    let src;
    let analyser;
    try {
      ctx = new AC();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.82;
      src = ctx.createMediaElementSource(el);
      src.connect(analyser);
      analyser.connect(ctx.destination);
      podcastAnalyserRef.current = analyser;
      const resume = () => {
        ctx.resume().catch(() => {});
      };
      el.addEventListener("play", resume);
      return () => {
        el.removeEventListener("play", resume);
        podcastAnalyserRef.current = null;
        try {
          src.disconnect();
          analyser.disconnect();
        } catch {}
        ctx.close().catch(() => {});
      };
    } catch {
      podcastAnalyserRef.current = null;
      return undefined;
    }
  }, [podcastOpen, podcastAudioUrl, podcastBrowserMode]);

  const { transcript, interimTranscript, finalTranscript, listening, resetTranscript, browserSupportsSpeechRecognition } = useSpeechRecognition({ clearTranscriptOnListen: false });

  const editorRef   = useRef(null);
  const docColRef   = useRef(null);
  const mainAreaRef = useRef(null);
  const annColRef   = useRef(null);
  const panelBodyRef = useRef(null);
  const [suggTops, setSuggTops] = useState({});
  const [applyingOverlay, setApplyingOverlay] = useState(null); // {top,left,cat,exiting}
  const timers      = useRef({});
  const dismissed   = useRef({ fact: new Set(), research: new Set() });
  const checked     = useRef(new Set());
  const lastScannedContent = useRef({});
  const ghostBusy   = useRef(false);
  const newSuggIds  = useRef(new Set());
  const busyWithSelAction = useRef(false);
  const transcriptEndRef  = useRef(null);
  const scannedTranscriptRef = useRef(""); // how far into finalTranscript we've scanned
  const lectureQTimerRef  = useRef(null);
  const lectureSuggTimerRef = useRef(null);
  const scannedLectureSuggRef = useRef(""); // transcript already used for lecture suggestions
  const fileHandleRef = useRef(null);
  const diskSaveTimeoutRef = useRef(null);

  const saveKeys = (provider, key) => {
    try {
      sessionStorage.setItem("sd_provider", provider);
      sessionStorage.setItem(`sd_key_${provider}`, key);
      sessionStorage.setItem("sd_key", key);
      setLlmProvider(provider);
      setApiKey(key);
    } catch {}
  };
  const resetKey = () => {
    try {
      ["openai", "claude", "gemini"].forEach(p => sessionStorage.removeItem(`sd_key_${p}`));
      sessionStorage.removeItem("sd_provider");
      sessionStorage.removeItem("sd_key");
    } catch {}
    setApiKey("");
    setLlmProvider("openai");
  };
  const setProviderAndLoadKey = (p) => {
    setLlmProvider(p);
    try {
      sessionStorage.setItem("sd_provider", p);
      setApiKey(sessionStorage.getItem(`sd_key_${p}`) || "");
    } catch {}
  };
  const setSuggFreqAndSave = v => {
    setSuggFreq(v);
    try { sessionStorage.setItem("sd_suggFreq", v); } catch {}
    // Always clear suggestions for the current note and force a fresh rescan
    // so the new mode takes effect immediately with the right quantity
    setSugg(p => p.filter(s => s.noteId !== activeId));
    if (v !== "off") {
      delete lastScannedContent.current[activeId];
      clearTimeout(timers.current.s);
      timers.current.s = setTimeout(() => {
        generateSuggestions(activeId, notes.find(n => n.id === activeId)?.content || "", notes);
      }, 400);
    }
  };

  const note       = notes.find(n => n.id === activeId) || notes[0];
  // noteHtml = HTML stored in notes; content = plain text used for all AI calls
  const noteHtml   = note.content;
  const content    = htmlToText(noteHtml);
  // setContent: sets editor content (and the editor's onChange updates notes via handleEditorChange)
  const setContent = v => { editorRef.current?.setEditorContent(v); };
  const setTitle   = v => setNotes(p => p.map(n => n.id === activeId ? { ...n, title:   v } : n));

  const closePodcastModal = useCallback(() => {
    try { podcastAbortRef.current?.abort(); } catch {}
    podcastAbortRef.current = null;
    try { speechSynthesis.cancel(); } catch {}
    setPodcastSpeaking(false);
    setPodcastAudioUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (podcastAudioRef.current) {
      try {
        podcastAudioRef.current.pause();
        podcastAudioRef.current.removeAttribute("src");
        podcastAudioRef.current.load();
      } catch {}
    }
    setPodcastOpen(false);
    setPodcastPhase("idle");
    setPodcastErr("");
    setPodcastMsg("");
    setPodcastTtsProg({ cur: 0, total: 0 });
    setPodcastTitle("");
    setPodcastBrowserMode(false);
    setPodcastTurns([]);
    setPodcastVoiceKind(null);
    setPodcastAudioSegments([]);
    lastPodcastSpeakerRef.current = null;
    setPodcastActiveSpeaker(null);
    setPodcastMinimized(false);
    setPodcastQuestionOpen(false);
    setPodcastQuestionText("");
    setPodcastQuestionAnswer("");
    setPodcastQuestionBusy(false);
  }, []);

  const dockPodcastMinimized = useCallback(() => {
    try {
      const raw = sessionStorage.getItem(LS_CAST_FLOAT);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y)) {
          setPodcastFloatPos(clampPodcastFloatPosition(p.x, p.y));
          setPodcastMinimized(true);
          return;
        }
      }
    } catch {}
    setPodcastFloatPos(
      clampPodcastFloatPosition(window.innerWidth - PODCAST_FLOAT_W - 14, window.innerHeight - PODCAST_FLOAT_H - 18)
    );
    setPodcastMinimized(true);
  }, []);

  useLayoutEffect(() => {
    if (!podcastMinimized) return;
    setPodcastFloatPos(p => clampPodcastFloatPosition(p.x, p.y));
  }, [podcastMinimized]);

  const expandPodcastFromDock = useCallback(() => {
    setPodcastMinimized(false);
  }, []);

  const runStudyPodcast = useCallback(async () => {
    try { speechSynthesis.cancel(); } catch {}
    setPodcastSpeaking(false);
    setPodcastMinimized(false);
    setPodcastQuestionOpen(false);
    setPodcastQuestionText("");
    setPodcastQuestionAnswer("");
    setPodcastQuestionBusy(false);
    setPodcastAudioSegments([]);
    lastPodcastSpeakerRef.current = null;
    setPodcastActiveSpeaker(null);
    const ac = new AbortController();
    podcastAbortRef.current = ac;
    setPodcastErr("");
    setPodcastAudioUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPodcastBrowserMode(false);
    setPodcastVoiceKind(null);
    setPodcastPhase("script");
    setPodcastMsg("Writing your episode…");
    setPodcastTtsProg({ cur: 0, total: 0 });

    const notePlain = content.trim();
    const lec = (finalTranscript || transcript || "").trim();
    if (notePlain.length < 40 && lec.length < 80) {
      setPodcastPhase("error");
      setPodcastErr("Add more notes or a short lecture transcript, then try again.");
      return;
    }

    const scriptMax = podcastScriptMaxOut(podcastMaxMinutes, llmProvider);

    const payload = {
      ...podcastLengthTargets(podcastMaxMinutes),
      noteTitle: note?.title || "Untitled",
      noteMeta: (noteMetaBlock(note) || "").trim(),
      studentNotes: notePlain.slice(0, 14000),
      lectureTranscript: lec.length ? lec.slice(0, 12000) : "(No lecture transcript captured — rely on the notes and say so briefly in the dialogue if relevant.)",
      openingBrief:
        "Show don't tell: Dee witty, Ray teaches from notes—never have them say they're the funny or serious one. No markdown or asterisks in any string.",
    };

    let script;
    try {
      script = await generatePodcastScript(llmProvider, apiKey, payload, scriptMax, ac.signal);
    } catch (e) {
      if (e?.name === "AbortError") return;
      setPodcastPhase("error");
      setPodcastErr(e?.message || "Couldn’t write the episode. Try again.");
      return;
    }

    setPodcastTitle(script.title);
    setPodcastTurns(script.turns);

    const oaiKey = resolveOpenAIKeyForTTS(llmProvider, apiKey);
    const instrDee =
      "You are Dee, female co-host of SunnyD Cast: funny, warm, playful—comedic timing but still clear. Sound like a podcast host who makes people laugh while they learn.";
    const instrRay =
      "You are Ray, male co-host of SunnyD Cast: knowledgeable, calm, clear teacher energy—confident explanations, friendly not stiff. Light dry humor only as reaction lines.";

    const openaiJobs = [];
    const kokoroJobs = [];
    for (const t of script.turns) {
      const isRay = t.id === "host_b";
      const oaiVoice = isRay ? SUNNYD_OPENAI_VOICE_MALE : SUNNYD_OPENAI_VOICE_FEMALE;
      const kokoroVoice = isRay ? SUNNYD_KOKORO_VOICE_MALE : SUNNYD_KOKORO_VOICE_FEMALE;
      const instructions = isRay ? instrRay : instrDee;
      for (const part of splitTextForTTS(t.text)) {
        openaiJobs.push({ text: part, voice: oaiVoice, instructions });
      }
      for (const part of splitTextForTTS(t.text, KOKORO_TEXT_CHUNK)) {
        kokoroJobs.push({ text: part, kokoroVoice });
      }
    }
    if (!openaiJobs.length || !kokoroJobs.length) {
      setPodcastPhase("error");
      setPodcastErr("Empty episode. Tap New episode and try again.");
      return;
    }

    setPodcastPhase("tts");

    const ACtx = window.AudioContext || window.webkitAudioContext;
    let decodeCtx = null;
    const buffers = [];

    const runOpenAIChunks = async () => {
      for (let i = 0; i < openaiJobs.length; i++) {
        if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
        setPodcastTtsProg({ cur: i + 1, total: openaiJobs.length });
        setPodcastMsg(`Making audio… ${i + 1} / ${openaiJobs.length}`);
        const mp3 = await openaiCreateSpeech(oaiKey, openaiJobs[i].text, openaiJobs[i].voice, openaiJobs[i].instructions, ac.signal);
        const audioBuf = await decodeCtx.decodeAudioData(mp3.slice(0));
        buffers.push(audioBuf);
      }
    };

    const runKokoroChunks = async () => {
      buffers.length = 0;
      setPodcastTtsProg({ cur: 0, total: kokoroJobs.length });
      setPodcastMsg("Loading voices… first run can take a minute.");
      const tts = await loadSunnydKokoroTTS({
        signal: ac.signal,
        progress_callback: info => {
          const p = info?.progress;
          if (typeof p === "number" && !Number.isNaN(p)) {
            setPodcastMsg(`Loading… ${Math.min(100, Math.round(p * 100))}%`);
          }
        },
      });
      for (let i = 0; i < kokoroJobs.length; i++) {
        if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
        setPodcastTtsProg({ cur: i + 1, total: kokoroJobs.length });
        setPodcastMsg(`Making audio on this device… ${i + 1} / ${kokoroJobs.length}`);
        const raw = await tts.generate(kokoroJobs[i].text, { voice: kokoroJobs[i].kokoroVoice, speed: 1 });
        buffers.push(float32SamplesToAudioBuffer(decodeCtx, raw.audio, raw.sampling_rate));
      }
    };

    let voiceEngine = "kokoro";
    try {
      decodeCtx = new ACtx();
      if (oaiKey) {
        try {
          await runOpenAIChunks();
          voiceEngine = "openai";
        } catch (e1) {
          if (e1?.name === "AbortError") throw e1;
          setPodcastErr("");
          await runKokoroChunks();
          voiceEngine = "kokoro";
        }
      } else {
        await runKokoroChunks();
        voiceEngine = "kokoro";
      }

      const merged = mergeMonoAudioBuffers(decodeCtx, buffers);
      if (!merged) throw new Error("Could not merge audio.");
      const chunkCounts =
        voiceEngine === "openai"
          ? script.turns.map(t => splitTextForTTS(t.text).length)
          : script.turns.map(t => splitTextForTTS(t.text, KOKORO_TEXT_CHUNK).length);
      const segments = podcastSegmentsFromBufferDurations(script.turns, chunkCounts, buffers);
      setPodcastAudioSegments(segments);
      const wavBlob = audioBufferToWavBlob(merged);
      const url = URL.createObjectURL(wavBlob);
      setPodcastAudioUrl(url);
      setPodcastPhase("ready");
      setPodcastBrowserMode(false);
      setPodcastErr("");
      setPodcastVoiceKind(voiceEngine);
      setPodcastMsg(
        voiceEngine === "openai"
          ? "Ready. Play to relearn, or download a copy."
          : "Ready. Made on this device—play to relearn, or download."
      );
    } catch (e) {
      if (e?.name === "AbortError") return;
      setPodcastAudioSegments([]);
      setPodcastBrowserMode(true);
      setPodcastPhase("ready");
      setPodcastVoiceKind("system");
      setPodcastErr("");
      setPodcastMsg(
        "Audio didn’t build. The script is still here—use Play (speaker) below, or New episode to retry."
      );
    } finally {
      try { await decodeCtx?.close(); } catch {}
    }
  }, [llmProvider, apiKey, content, finalTranscript, transcript, note, podcastMaxMinutes]);

  const resetPodcastSession = useCallback(() => {
    try { podcastAbortRef.current?.abort(); } catch {}
    podcastAbortRef.current = null;
    try { speechSynthesis.cancel(); } catch {}
    setPodcastSpeaking(false);
    setPodcastAudioUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (podcastAudioRef.current) {
      try {
        podcastAudioRef.current.pause();
        podcastAudioRef.current.removeAttribute("src");
        podcastAudioRef.current.load();
      } catch {}
    }
    setPodcastPhase("idle");
    setPodcastErr("");
    setPodcastMsg("");
    setPodcastTtsProg({ cur: 0, total: 0 });
    setPodcastTitle("");
    setPodcastBrowserMode(false);
    setPodcastTurns([]);
    setPodcastVoiceKind(null);
    setPodcastAudioSegments([]);
    lastPodcastSpeakerRef.current = null;
    setPodcastActiveSpeaker(null);
    setPodcastMinimized(false);
    setPodcastQuestionOpen(false);
    setPodcastQuestionText("");
    setPodcastQuestionAnswer("");
    setPodcastQuestionBusy(false);
  }, []);

  useEffect(() => {
    if (!podcastOpen || typeof speechSynthesis === "undefined") return;
    const warm = () => {
      try { speechSynthesis.getVoices(); } catch {}
    };
    warm();
    speechSynthesis.addEventListener?.("voiceschanged", warm);
    return () => speechSynthesis.removeEventListener?.("voiceschanged", warm);
  }, [podcastOpen]);

  useEffect(() => {
    try {
      sessionStorage.setItem(LS_CAST_MAX_MIN, String(clampPodcastMinutes(podcastMaxMinutes)));
    } catch {}
  }, [podcastMaxMinutes]);

  /* ── Note metadata helpers ── */
  // Returns a context block injected into AI prompts when metadata is set
  function noteMetaBlock(n) {
    const parts = [];
    if (n?.subject)   parts.push(`Subject / Course: ${n.subject}`);
    if (n?.professor) parts.push(`Professor: ${n.professor}`);
    if (n?.goal)      parts.push(`Student's goal: ${n.goal}`);
    return parts.length ? `\n\n${parts.join('\n')}` : '';
  }

  const handlePodcastBackdropClick = useCallback(
    e => {
      if (e.target !== e.currentTarget) return;
      if (podcastPhase === "ready") dockPodcastMinimized();
      else closePodcastModal();
    },
    [podcastPhase, dockPodcastMinimized, closePodcastModal]
  );

  const openPodcastQuestion = useCallback(() => {
    try {
      podcastAudioRef.current?.pause();
    } catch {}
    try {
      podcastAbortRef.current?.abort();
      speechSynthesis.cancel();
    } catch {}
    setPodcastSpeaking(false);
    lastPodcastSpeakerRef.current = null;
    setPodcastActiveSpeaker(null);
    setPodcastQuestionOpen(true);
    setPodcastQuestionText("");
    setPodcastQuestionAnswer("");
  }, []);

  const closePodcastQuestionResume = useCallback(() => {
    setPodcastQuestionOpen(false);
    setPodcastQuestionText("");
    setPodcastQuestionAnswer("");
    setPodcastQuestionBusy(false);
  }, []);

  const playPodcastWebSpeech = useCallback(() => {
    const ac = new AbortController();
    podcastAbortRef.current = ac;
    setPodcastSpeaking(true);
    setPodcastMsg("Playing through your speaker…");
    speakTurnsWebSpeech(
      podcastTurns,
      ac.signal,
      (c, t) => setPodcastMsg(`Playing… ${c}/${t}`),
      turn => {
        const id = turn ? turn.id : null;
        lastPodcastSpeakerRef.current = id;
        setPodcastActiveSpeaker(id);
      }
    )
      .then(() => {
        setPodcastSpeaking(false);
        lastPodcastSpeakerRef.current = null;
        setPodcastActiveSpeaker(null);
        setPodcastMsg(
          podcastAudioUrl
            ? "Use the player above or download if you want a file."
            : "Done. Generate again for a new mix."
        );
        podcastAbortRef.current = null;
      })
      .catch(e => {
        setPodcastSpeaking(false);
        lastPodcastSpeakerRef.current = null;
        setPodcastActiveSpeaker(null);
        podcastAbortRef.current = null;
        if (e?.name !== "AbortError") setPodcastMsg("Stopped. Tap Play to continue.");
      });
  }, [podcastTurns, podcastAudioUrl]);

  const stopPodcastWebSpeech = useCallback(() => {
    try {
      podcastAbortRef.current?.abort();
    } catch {}
    try {
      speechSynthesis.cancel();
    } catch {}
    setPodcastSpeaking(false);
    lastPodcastSpeakerRef.current = null;
    setPodcastActiveSpeaker(null);
    podcastAbortRef.current = null;
    setPodcastMsg("Paused.");
  }, []);

  const submitPodcastQuestion = useCallback(async () => {
    const q = podcastQuestionText.trim();
    if (!q || podcastQuestionBusy) return;
    const el = podcastAudioRef.current;
    const curT = el && !podcastBrowserMode && Number.isFinite(el.currentTime) ? el.currentTime : null;
    const dur = el && Number.isFinite(el.duration) ? el.duration : null;
    const { excerpt } = buildPodcastQuestionSnippet(
      podcastTurns,
      podcastAudioSegments,
      curT,
      dur,
      podcastBrowserMode,
      podcastActiveSpeaker
    );
    if (!apiKey?.trim()) {
      setPodcastQuestionAnswer("Add your API key in settings (OpenAI, Claude, or Gemini) to get an answer.");
      return;
    }
    setPodcastQuestionBusy(true);
    setPodcastQuestionAnswer("");
    try {
      const system = `You are SunnyD. The student paused a short study podcast (Dee & Ray) and asked one question about what they just heard.

Rules (strict):
- Answer in plain text only. No markdown, bullets, or headings.
- Start with the direct answer in ONE sentence.
- Total length: at most 90 words (about 5–7 short sentences). If you need less, use less.
- Do not repeat their question, no long intro or recap of the episode, no “great question,” no closing essay.
- Use the excerpt + notes only; if you cannot answer from them, say so in 1–2 sentences and what to replay.`;
      const user = JSON.stringify({
        studentQuestion: q,
        episodeTitle: podcastTitle,
        excerptLinesJustHeard: excerpt,
        noteTitle: note?.title || "Untitled",
        noteMeta: (noteMetaBlock(note) || "").trim(),
        studentNotesForContext: content.slice(0, 3500),
      });
      const raw = await ai(llmProvider, apiKey, system, user, 280);
      setPodcastQuestionAnswer(clampPodcastAnswerLength(String(raw || "").trim(), 95));
    } catch (e) {
      setPodcastQuestionAnswer(e?.message || "Something went wrong. Try again.");
    } finally {
      setPodcastQuestionBusy(false);
    }
  }, [
    podcastQuestionText,
    podcastQuestionBusy,
    podcastBrowserMode,
    podcastTurns,
    podcastAudioSegments,
    podcastActiveSpeaker,
    podcastTitle,
    apiKey,
    llmProvider,
    note,
    content,
  ]);

  // Open the setup modal for creating a new note (pendingId = future note id)
  function openNewNoteSetup() {
    const pendingId = Date.now();
    setNoteSetupModal({ pendingId, subject: '', professor: '', goal: '' });
  }

  // Open for editing existing note metadata
  function openEditNoteMeta() {
    setNoteSetupModal({
      pendingId: null,
      subject:   note?.subject   || '',
      professor: note?.professor || '',
      goal:      note?.goal      || '',
    });
  }

  // Confirm: create new note (if pendingId) or update existing note metadata
  function confirmNoteSetup(skip = false) {
    if (!noteSetupModal) return;
    const { pendingId, subject, professor, goal } = noteSetupModal;
    if (pendingId !== null) {
      // Creating a new note
      const meta = skip ? {} : { subject: subject.trim(), professor: professor.trim(), goal: goal.trim() };
      const newNote = { id: pendingId, title: 'Untitled', content: '', createdAt: Date.now(), ...meta };
      setNotes(p => [...p, newNote]);
      setActiveId(pendingId);
      setTimeout(() => document.querySelector('.title-inp')?.focus(), 80);
      setGhost(null); setGhostThinking(false);
      setSelMenu(null); setSelThinking(null); setSelRes(null);
      setHoveredSuggId(null); setDockedCard(null); setPanelHidden(false);
    } else {
      // Editing metadata of the current note
      if (!skip) {
        setNotes(p => p.map(n => n.id === activeId
          ? { ...n, subject: subject.trim(), professor: professor.trim(), goal: goal.trim() }
          : n
        ));
      }
    }
    setNoteSetupModal(null);
  }
  const activeSugg = suggestions.filter(s => s.noteId === activeId && (!s.textRef || content.includes(s.textRef)));
  const applyingSugg = suggestions.find(s => s.applying);

  /* Compute viewport rect of the first line of textRef for the pill overlay */
  const getPillPosition = useCallback((textRef) => {
    const editorDom = editorRef.current?.getEditorDom();
    if (!editorDom || !textRef) return null;
    const plainText = contentRef.current || "";
    const idx = plainText.indexOf(textRef);
    if (idx === -1) return null;
    const walker = document.createTreeWalker(editorDom, NodeFilter.SHOW_TEXT);
    let node, charOffset = 0;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (charOffset + len > idx) {
        const r = document.createRange();
        const startOff = idx - charOffset;
        r.setStart(node, startOff);
        r.setEnd(node, Math.min(startOff + Math.min(textRef.length, len - startOff), len));
        const rect = r.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return null;
        // Position pill above the first line; if near top of viewport, go below instead
        const PILL_H = 40;
        const MARGIN = 8;
        const top = rect.top > PILL_H + MARGIN * 2
          ? rect.top - PILL_H - MARGIN          // above
          : rect.bottom + MARGIN;               // below
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - 280));
        return { top, left };
      }
      charOffset += len;
    }
    return null;
  }, []);

  /* ── Lecture mode: start / pause / stop speech recognition ── */
  useEffect(() => {
    if (!browserSupportsSpeechRecognition) return;
    if (lectureOn && !lecturePaused) {
      SpeechRecognition.startListening({ continuous: true, language: "en-US" });
      // Tick duration counter every second while recording
      lectureTimerRef.current = setInterval(() => setLectureSecs(s => s + 1), 1000);
    } else if (lectureOn && lecturePaused) {
      SpeechRecognition.stopListening();
      clearInterval(lectureTimerRef.current);
    } else {
      // Lecture turned off — full reset
      SpeechRecognition.stopListening();
      clearInterval(lectureTimerRef.current);
      setLecturePaused(false);
      setShowFullTranscript(false);
      setLectureQs([]);
      setActiveLectureQ(null);
      setNotedQIds(new Set());
      setLectureSecs(0);
      scannedTranscriptRef.current = "";
      scannedLectureSuggRef.current = "";
      setSugg(p => p.filter(s => s.cat !== "lecture"));
    }
    return () => {
      clearInterval(lectureTimerRef.current);
      if (lectureOn) SpeechRecognition.stopListening();
    };
  }, [lectureOn, lecturePaused, browserSupportsSpeechRecognition]);

  /* ── On mount: try to load notes from disk file if we have a saved handle ── */
  useEffect(() => {
    if (!supportsFileAccess()) return;
    let cancelled = false;
    (async () => {
      const handle = await getStoredFileHandle();
      if (!handle || cancelled) return;
      try {
        const permission = await handle.queryPermission?.({ mode: "readwrite" });
        if (permission !== "granted") return;
        const { notes: fileNotes, activeId: fileActiveId } = await readFromFile(handle);
        if (cancelled || !Array.isArray(fileNotes) || fileNotes.length === 0) return;
        fileHandleRef.current = handle;
        setNotes(fileNotes);
        setActiveId(fileActiveId && fileNotes.some(n => n.id === fileActiveId) ? fileActiveId : fileNotes[0].id);
        saveNotes(fileNotes);
        saveActiveId(fileActiveId ?? fileNotes[0].id);
        setSavingToDisk(true);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  /* ── Persist notes to localStorage on every change; if disk file is active, write there too (debounced) ── */
  useEffect(() => {
    saveNotes(notes);
    setLastSavedAt(Date.now());
    // Generate/update embedding for the active note if content changed
    const currentNote = notes.find(n => n.id === activeId);
    if (currentNote) {
      const plainText = htmlToText(currentNote.content).trim();
      if (plainText.length > 50) {
        const hash = simpleHash(plainText);
        const existing = loadEmbeddings()[activeId];
        if (!existing || existing.hash !== hash) {
          embedText(plainText)
            .then(vector => { if (vector) saveEmbedding(activeId, vector, hash); })
            .catch(() => {});
        }
      }
    }
  }, [notes]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { saveActiveId(activeId); }, [activeId]);
  useEffect(() => {
    const handle = fileHandleRef.current;
    if (!handle) return;
    clearTimeout(diskSaveTimeoutRef.current);
    diskSaveTimeoutRef.current = setTimeout(async () => {
      try {
        await writeToFile(handle, notes, activeId);
      } catch {}
    }, 600);
    return () => clearTimeout(diskSaveTimeoutRef.current);
  }, [notes, activeId]);

  /* ── Auto-scroll transcript to bottom when new content ── */
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  /* ── Question detection: scan new finalTranscript text after a short pause ── */
  useEffect(() => {
    if (!lectureOn || !finalTranscript) return;
    const newText = finalTranscript.slice(scannedTranscriptRef.current.length);
    if (newText.trim().length < 12) return;
    clearTimeout(lectureQTimerRef.current);
    lectureQTimerRef.current = setTimeout(() => detectLectureQuestions(finalTranscript), 2200);
  }, [finalTranscript, lectureOn]);

  /* ── Lecture suggestions: compare transcript vs note, surface missed content ── */
  useEffect(() => {
    if (!lectureOn || !finalTranscript) return;
    const newText = finalTranscript.slice(scannedLectureSuggRef.current.length);
    // Wait for at least ~20 new words before triggering a scan (was 40)
    if ((newText.match(/\S+/g) || []).length < 20) return;
    clearTimeout(lectureSuggTimerRef.current);
    lectureSuggTimerRef.current = setTimeout(() => {
      const noteText = notes.find(n => n.id === activeId)?.content || "";
      generateLectureSuggestions(activeId, noteText, finalTranscript);
    }, 3000);
  }, [finalTranscript, lectureOn]);

  /* ── Auto-generate answer when a question card opens with no answer yet ── */
  useEffect(() => {
    if (!activeLectureQ || activeLectureQ.q.answer) return;
    const qId = activeLectureQ.q.id;
    const qText = activeLectureQ.q.text;
    setLectureQGenerating(true);
    const noteContext = notes.map(n => `[${n.title}]:\n${htmlToText(n.content).slice(0, 400)}`).join("\n\n");
    ai(
      llmProvider, apiKey,
      `You are SunnyD, a knowledgeable academic assistant. A question was just raised in class and you need to give the student a smart, accurate answer they can use to contribute to the discussion.

CRITICAL RULES:
- You have broad, expert knowledge — USE IT. Never say you "don't have notes on this" or pretend not to know something you clearly know.
- Answer the question directly and accurately from your knowledge. The student's notes are additional context, not your only source.
- Write 1-2 confident, substantive sentences the student could actually say in class.
- Sound natural and like a student who did their reading — not like an AI hedging.
- NEVER say things like "based on the name it seems like..." or "I'm not sure but..." — give a real answer.

Return ONLY valid JSON: {"answer":"1-2 clear, accurate sentences"}`,
      `Question: "${qText}"\n\nStudent notes (for context):\n${noteContext.slice(0, 1200)}${noteMetaBlock(note)}`,
      400
    )
      .then(raw => {
        const m = raw.replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/);
        const parsed = m ? JSON.parse(m[0]) : null;
        const answer = parsed?.answer?.trim() || "";
        if (!answer) return;
        setLectureQs(prev => prev.map(q => q.id === qId ? { ...q, answer } : q));
        setActiveLectureQ(prev => prev?.q.id === qId ? { ...prev, q: { ...prev.q, answer } } : prev);
      })
      .catch(() => {})
      .finally(() => setLectureQGenerating(false));
  }, [activeLectureQ?.q?.id]); // only re-run when a different question is opened

  /* ── Expand a lecture Q into a long, well-structured answer ── */
  async function expandLectureAnswer(q) {
    const qId = q.id;
    setLectureQExpanding(true);
    try {
      const noteContext = notes.map(n => `[${n.title}]:\n${htmlToText(n.content).slice(0, 600)}`).join("\n\n");
      const transcript  = finalTranscript || "";
      const raw = await ai(
        llmProvider, apiKey,
        `You are SunnyD, an expert educational assistant helping a student engage deeply with a question raised in their lecture.
The student wants a DETAILED, well-structured answer they can use to understand the topic fully and contribute confidently in class.

Return ONLY valid JSON (no markdown wrapper): {"answer":"<your full answer in markdown>"}

CRITICAL RULES:
- You have broad, expert knowledge — USE IT. Answer thoroughly from what you know. The student's notes are context, not your only source.
- NEVER say you "don't have notes on this" or pretend not to know something. If the notes don't cover a topic, answer from your knowledge.
- Give a genuinely educational, accurate answer — as if a knowledgeable tutor is explaining it.

Your answer MUST:
- Be thorough (4-10 sentences or more, use paragraphs as needed)
- Use markdown formatting to improve clarity:
    • ## or ### for section headers when the answer covers multiple aspects
    • **bold** for key terms or important concepts
    • - bullet lists for enumerated points or examples
    • > blockquote for a key takeaway or definition
- Connect to the student's notes or lecture context where genuinely relevant
- End with a brief "**Key takeaway:**" line the student can reference quickly`,
        `Question: "${q.text}"

Student notes:
${noteContext.slice(0, 2000)}${noteMetaBlock(note)}

Recent lecture transcript:
"${transcript.slice(-800)}"`,
        900
      );
      const m = raw.replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/);
      const parsed = m ? (() => { try { return JSON.parse(m[0]); } catch { return null; } })() : null;
      const expandedAnswer = parsed?.answer?.trim() || q.answer;
      // Mark the question as expanded and store the long answer under expandedAnswer
      setLectureQs(prev => prev.map(x => x.id === qId ? { ...x, expandedAnswer } : x));
      setActiveLectureQ(prev => prev?.q.id === qId ? { ...prev, q: { ...prev.q, expandedAnswer } } : prev);
    } catch {}
    finally { setLectureQExpanding(false); }
  }

  async function detectLectureQuestions(currentTranscript) {
    const newText = currentTranscript.slice(scannedTranscriptRef.current.length).trim();
    if (!newText || newText.length < 12) return;

    // Quick client-side guard — only call LLM if question markers are present
    const qMarker = /\?|(^|\s)(what|how|why|when|where|who|could|can|would|should|is are|was|were|do|does|did|will|tell me|explain|describe)\b/i;
    if (!qMarker.test(newText)) {
      scannedTranscriptRef.current = currentTranscript;
      return;
    }

    scannedTranscriptRef.current = currentTranscript; // mark as scanned

    const noteContext = notes.map(n => `[${n.title}]:\n${n.content.slice(0, 400)}`).join("\n\n");
    let raw;
    try {
      raw = await ai(
        llmProvider, apiKey,
        `You analyze live lecture transcripts to detect genuine spoken questions and generate smart, accurate responses.

Return ONLY valid JSON, no markdown.
Schema: {"questions":[{"text":"exact phrase from transcript","answer":"1-2 confident, accurate sentences the student could say to contribute"}]}
If no clear questions exist, return {"questions":[]}

CRITICAL for answers:
- You have expert knowledge — use it. NEVER say "I don't have notes on this" or pretend not to know something you clearly know.
- Answer directly and accurately from your knowledge. The student's notes are context only.
- Sound like a prepared student, not an AI hedging. No "it seems like" or "based on the name".`,
        `New transcript segment: "${newText}"

Student's notes for context:
${noteContext.slice(0, 1200)}${noteMetaBlock(note)}`,
        500
      );
    } catch { return; }

    let parsed;
    try {
      const m = raw.replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    } catch { return; }

    if (!parsed?.questions?.length) return;

    setLectureQs(prev => {
      const existing = new Set(prev.map(q => q.text.trim().toLowerCase()));
      const fresh = parsed.questions
        .filter(q => q.text && currentTranscript.includes(q.text))
        .filter(q => !existing.has(q.text.trim().toLowerCase()))
        .map(q => ({ id: uid(), text: q.text.trim(), answer: q.answer?.trim() || "" }));
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
  }

  /* ── Lecture suggestions: find transcript content missing from the note ── */
  /* ── Add a Q&A to the note as structured content ── */
  /* ── Find the best paragraph in the notes to insert a Q&A after ── */
  function findBestAnchor(questionText, plainContent) {
    if (!plainContent || !plainContent.trim()) return null;
    // Common stop-words to ignore when matching
    const stop = new Set([
      'what','when','where','which','who','how','why','does','did','do',
      'the','and','for','that','this','with','are','was','were','is',
      'in','of','to','a','an','it','its','be','as','at','by','from',
      'have','has','had','not','but','about','can','will','would','should',
    ]);
    const keywords = questionText.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stop.has(w));
    if (keywords.length === 0) return null;

    // Score each non-trivial line by how many question keywords it contains
    const lines = plainContent.split(/\n+/).map(l => l.trim()).filter(l => l.length > 15 && l.length < 400);
    let best = { score: 0, line: null };
    for (const line of lines) {
      const lower = line.toLowerCase();
      const score = keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
      if (score > best.score) best = { score, line };
    }
    // Only anchor if at least one keyword matched; trim to 80 chars for findTextInDoc
    return best.score > 0 ? best.line.slice(0, 80) : null;
  }

  /* ── Build the Q&A HTML block with proper spacing and structure ── */
  function buildQAHtml(q) {
    const safeQ = q.text.trim();
    // Convert answer markdown to HTML, then label the first paragraph "A:"
    const answerMd = (q.answer || '').trim() || '(no answer yet)';
    const answerConverted = mdToHtml(answerMd);
    // Inject the A: label at the very start of the first <p>
    const labeledAnswer = answerConverted.replace(/^<p>/, '<p><strong>A:</strong>\u00a0');
    // Wrap: blank spacer → Q → A block(s) → blank spacer so it never mashes against nearby content
    return `<p></p><p><strong>Q:</strong>\u00a0${safeQ}</p>${labeledAnswer}<p></p>`;
  }

  function addQuestionToNotes(q) {
    const html = buildQAHtml(q);

    // Try to find the most relevant spot in the notes based on question keywords
    const anchor = findBestAnchor(q.text, content);
    let inserted = false;
    if (anchor) inserted = !!(editorRef.current?.insertAfterText(anchor, html));
    if (!inserted) editorRef.current?.appendContent(html);

    setNotedQIds(prev => new Set([...prev, q.id]));

    // Scroll to the inserted Q line and flash it orange
    setTimeout(() => {
      const scrollKey = `Q:\u00a0${q.text.trim().slice(0, 50)}`;
      editorRef.current?.scrollToText(scrollKey) ||
        editorRef.current?.scrollToText(q.text.trim().slice(0, 40));
      editorRef.current?.setInsertedHighlight(q.text.trim().slice(0, 50));
    }, 150);
    setTimeout(() => editorRef.current?.clearInsertedHighlight(), 9000);
  }

  async function generateLectureSuggestions(noteId, noteText, transcript) {
    if (!transcript.trim() || transcript.length < 80) return;
    // Only scan the new portion since last lecture-sugg scan
    const newTranscriptPart = transcript.slice(scannedLectureSuggRef.current.length).trim();
    if ((newTranscriptPart.match(/\S+/g) || []).length < 20) return;
    scannedLectureSuggRef.current = transcript;

    try {
      const raw = await ai(llmProvider, apiKey,
        `You are SunnyD, an intelligent note-taking assistant. The user is in a lecture. Compare the lecture transcript segment to the user's existing notes and identify SPECIFIC, RELEVANT pieces of information mentioned in the lecture that are MISSING from the notes and worth adding.

Return ONLY a valid JSON array — no markdown, no extra text.
Each item: {"headline":"<5-8 word headline>","preview":"<3-6 word teaser>","detail":"<2-3 sentence justification: why this matters and what specifically was said in the lecture>","apply":"<concise note-ready text to insert, written as a note, not a transcript quote>","textRef":"<exact phrase from the NOTES (10-80 chars) nearest to where this should be inserted, OR null if the content is entirely new with no related section in the notes>"}

CRITICAL — only return suggestions when something GENUINELY important is missing. Do NOT suggest things already covered in the notes. Do NOT suggest trivial or obvious things.
CRITICAL — textRef: use an exact phrase from the notes ONLY when there is a genuinely related passage nearby. If the content is brand-new with no relevant anchor in the notes, set textRef to null — do NOT invent a random anchor.
CRITICAL — apply: write in the SAME style, tone, and voice as the existing note — not like a transcript and not like a formal summary. If the note uses casual short sentences, do that. If it uses bullets, consider that. 2-4 sentences max. The text must flow naturally from whatever paragraph it will be inserted after — write as if the student themselves added it. You MAY use markdown (**bold**, *italic*, ## Heading 2, - bullet list, \`code\`) only if the existing note already uses that style.
Return [] if nothing important is missing.`,
        `Lecture segment (new content since last scan):\n"${newTranscriptPart.slice(0, 1500)}"\n\nCurrent note content:\n${noteText.slice(0, 1200) || "(empty)"}${noteMetaBlock(note)}`,
        800
      );

      const cleaned = raw.replace(/```json|```/g, "").trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      const arr = match ? JSON.parse(match[0]) : JSON.parse(cleaned);
      if (!Array.isArray(arr) || arr.length === 0) return;

      const newSugg = arr
        .filter(s => s.apply && s.headline)
        .map(s => ({ ...s, id: uid(), noteId, cat: "lecture" }));

      setSugg(p => {
        const others = p.filter(s => s.noteId !== noteId || s.cat !== "lecture");
        const existingLecture = p.filter(s => s.noteId === noteId && s.cat === "lecture");
        const existingHeadlines = new Set(existingLecture.map(s => s.headline?.trim().toLowerCase()));
        const fresh = newSugg.filter(s => !existingHeadlines.has(s.headline?.trim().toLowerCase()));
        // Cap lecture suggestions at 5 to avoid flooding the panel
        const combined = [...existingLecture, ...fresh].slice(0, 5);
        return [...others, ...combined];
      });
    } catch (e) {
      console.error("lecture sugg:", e);
    }
  }

  /* Format mm:ss from total seconds */
  function fmtDuration(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  /* ── Render finalTranscript with detected questions highlighted ── */
  function renderTranscriptText(text) {
    if (!text) return null;
    const visible = lectureQs.filter(q => text.includes(q.text));
    if (visible.length === 0) return text;

    const positioned = visible
      .map(q => ({ ...q, idx: text.indexOf(q.text) }))
      .filter(q => q.idx !== -1)
      .sort((a, b) => a.idx - b.idx);

    const parts = [];
    let pos = 0;
    for (const q of positioned) {
      if (q.idx < pos) continue;
      if (q.idx > pos) parts.push(<span key={`t-${pos}`}>{text.slice(pos, q.idx)}</span>);
      const isNoted = notedQIds.has(q.id);
      parts.push(
        <span
          key={q.id}
          className={`lecture-q-hl${q.answer ? " answered" : ""}${isNoted ? " noted" : ""}`}
          title={isNoted ? "Added to notes" : "Click for a suggested response"}
          onClick={e => {
            e.stopPropagation();
            setActiveLectureQ(prev => prev?.q.id === q.id ? null : { q, x: e.clientX, y: e.clientY });
          }}
        >
          {q.text}
          <span className="lecture-q-pip">{isNoted ? "✓" : "?"}</span>
        </span>
      );
      pos = q.idx + q.text.length;
    }
    if (pos < text.length) parts.push(<span key={`t-end`}>{text.slice(pos)}</span>);
    return parts;
  }

  /* ── Clear suggestion highlight state when switching notes ── */
  useEffect(() => {
    setHoveredSuggId(null);
    setDockedCard(null);
    setPanelHidden(false);
  }, [activeId]);

  /* ── Gradually reveal new suggestions one by one ── */
  useEffect(() => {
    const unseenIds = activeSugg.filter(s => !shownSuggIds.has(s.id)).map(s => s.id);
    if (unseenIds.length === 0) return;
    unseenIds.forEach((id, i) => {
      setTimeout(() => {
        newSuggIds.current.add(id);
        setShownSuggIds(prev => new Set([...prev, id]));
        setTimeout(() => { newSuggIds.current.delete(id); }, 14000);
      }, (i + 1) * 750);
    });
  }, [activeSugg.length, activeId]);

  /* ── Highlight layer: hovered suggestion + ghost ── */
  // Checks if a suggestion is a lecture suggestion that will append to end of note

  /* ── Fact check: adds to right-panel suggestions only (highlight on hover) ── */
  function isRejectableFactCheck(original, correction, replacement) {
    const c = (correction || "").toLowerCase();
    const r = (replacement || "").toLowerCase();
    const rejectPhrases = ["consult", "check sources", "reliable sources", "scholarly sources", "may vary", "methodolog", "differing", "verify", "confirm the exact", "often been reported", "often cited", "advisable to", "important to check"];
    if (rejectPhrases.some(p => c.includes(p) || r.includes(p))) return true;
    const norm = n => (n || "").replace(/,/g, "");
    const origNums = [...new Set(((original || "").match(/[\d,]+/g) || []).map(norm))];
    const replNums = [...new Set(((replacement || "").match(/[\d,]+/g) || []).map(norm))];
    if (origNums.length > 0 && origNums.every(on => replNums.includes(on))) return true;
    return false;
  }
  function isSimilarToDismissedFact(sentence) {
    const t = sentence.trim();
    if (dismissed.current.fact.has(t)) return true;
    const norm = s => (s || "").toLowerCase().replace(/\s+/g, " ");
    const nt = norm(t);
    for (const d of dismissed.current.fact) {
      const nd = norm(d);
      if (nt === nd) return true;
      if (nt.length >= 15 && nd.length >= 15 && (nt.includes(nd.slice(0, 25)) || nd.includes(nt.slice(0, 25)))) return true;
    }
    return false;
  }
  function isSimilarToResearchedSection(ref) {
    const t = (ref || "").trim();
    if (!t || t.length < 10) return false;
    if (dismissed.current.research.has(t)) return true;
    const norm = s => (s || "").toLowerCase().replace(/\s+/g, " ");
    const nt = norm(t);
    for (const r of dismissed.current.research) {
      const nr = norm(r);
      if (nt === nr) return true;
      if (nt.length >= 15 && nr.length >= 15 && (nt.includes(nr.slice(0, 30)) || nr.includes(nt.slice(0, 30)))) return true;
    }
    return false;
  }
  async function runFactCheck(text) {
    if (!suggestionsOn || busy) return;
    const sents = text.match(/[A-Z][^.!?\n]{20,}[.!?]/g) || [];
    for (const s of sents) {
      const t = s.trim();
      if (dismissed.current.fact.has(t) || checked.current.has(t) || isSimilarToDismissedFact(t)) continue;
      checked.current.add(t);
      setBusy(true); setStatus("Scanning…");
      try {
        const raw = await ai(llmProvider, apiKey,
          `You are SunnyD fact-checker. Find ONLY clear, verifiable factual errors.

Return check:true ONLY when the sentence contains a WRONG fact (wrong number, wrong date, wrong claim) that you can correct with a DIFFERENT fact. The replacement MUST change the actual information.

Return check:false when:
- The sentence is already correct
- You would only be confirming, rephrasing, qualifying, or adding context/caveats
- Your "correction" would say the same thing (e.g. "13,170 miles" → "around 13,170 miles" is NOT a correction)
- You would suggest "consult scholarly sources" or "measurements may vary" — that is NOT a factual correction

NEVER suggest qualifications, caveats, or "consult sources." Only flag when the fact is demonstrably WRONG and you have a DIFFERENT correct fact to substitute.

Reply ONLY with valid JSON, no markdown:
Inaccurate (wrong fact): {"check":true,"question":"?","correction":"Correct info.","replacement":"Corrected sentence with DIFFERENT factual content."}
Accurate or no real change: {"check":false}`,
          `Sentence: "${t}"`, 350);
        const p2 = JSON.parse(raw.replace(/```json|```/g, "").trim());
        if (p2.check) {
          if (isRejectableFactCheck(t, p2.correction, p2.replacement)) {
            dismissed.current.fact.add(t);
            break;
          }
          const correction = (p2.correction || "").trim();
          const preview = correction ? ("Correction: " + correction.slice(0, 45) + (correction.length > 45 ? "…" : "")) : "Inaccuracy detected";
          const sugg = {
            id: uid(), noteId: activeId, cat: "fact",
            headline: "Fact check", textRef: t,
            preview,
            detail: p2.correction,
            apply: p2.replacement,
          };
          const newRange = findSuggestionRange(text, sugg);
          const overlaps = (a, b) => a && b && a.start < b.end && a.end > b.start;
          setSugg(p => {
            const others = p.filter(s => s.noteId !== activeId);
            const forThis = p.filter(s => s.noteId === activeId);
            const nonOverlapping = forThis.filter(s => {
              const r = findSuggestionRange(text, s);
              return !r || !newRange || !overlaps(r, newRange);
            });
            return [...others, ...nonOverlapping, sugg];
          });
          setShownSuggIds(prev => new Set([...prev, sugg.id]));
        }
      } catch (e) { console.error(e); }
      finally { setBusy(false); setStatus(""); }
      break;
    }
  }

  /* ── Suggestion density config per mode ──
   *  maxOther = hard cap on non-fact suggestions (expand/clarity/explain/research).
   *  Fact suggestions are ALWAYS included regardless of mode — they are safety-critical.
   */
  const SUGG_CONFIG = {
    zen:      { maxOther: 2,  allowedOther: ["research"],           otherTone: "For NON-fact categories: only include \"research\" suggestions (0–2 max). Do NOT include expand, clarity, or explain — skip them entirely." },
    balanced: { maxOther: 3,  allowedOther: ["research","clarity","explain"],  otherTone: "For NON-fact categories: include research, clarity, and explain only (no expand). Return 2–3 total from those categories." },
    eager:    { maxOther: 9,  allowedOther: ["research","clarity","explain","expand"], otherTone: "For NON-fact categories (research, clarity, explain, expand): return 5–9. Be thorough across all those categories." },
  };

  const suggestionsOn = suggFreq !== "off";

  /* ── Generate suggestions: merges new ones, doesn't replace existing ── */
  async function generateSuggestions(noteId, text, allNotes) {
    if (!suggestionsOn) return;
    if (!text.trim() || text.length < 40) return;
    // Skip if content hasn't changed since last successful scan
    if (lastScannedContent.current[noteId] === text) return;

    // Cross-note context: include snippets from other notes
    const otherNotes = allNotes.filter(n => n.id !== noteId);
    const crossCtx = otherNotes.length > 0
      ? `\n\nFor context, the user's other notes:\n${otherNotes.map(n => `[${n.title}]:\n${n.content.slice(0, 400)}`).join("\n\n")}`
      : "";

    const prevContent = lastScannedContent.current[noteId] || "";
    const hasNewText = text.length > prevContent.length || text !== prevContent;
    const focusNew = hasNewText && prevContent.length > 20
      ? `\n\nIMPORTANT: The user has added or changed content since the last analysis. Focus suggestions on the NEW or CHANGED portions. Avoid suggesting for text that was already analyzed.`
      : "";

    const wc = (text.match(/\S+/g) || []).length;
    const { maxOther, allowedOther, otherTone } = SUGG_CONFIG[suggFreq] ?? SUGG_CONFIG.balanced;

    setBusy(true); setStatus("Analyzing…");
    try {
      const raw = await ai(llmProvider, apiKey,
        `You are SunnyD, an intelligent writing assistant. Analyze the active note and return suggestions.
Return ONLY a valid JSON array — no markdown, no extra text.

Each item schema:
{"cat":"<category>","headline":"<5-8 word headline>","preview":"<3-6 word teaser — must fit one line, no truncation>","detail":"<2-3 sentence detailed suggestion>","apply":"<replacement/addition text. CRITICAL: match the note's existing tone, voice, and formatting exactly — write as if the student wrote it. If the note uses plain casual prose, use that. If it uses bullets, consider bullets. For additions, begin with a natural transition so the text flows from what came before. You MAY use markdown (**bold**, *italic*, ## Heading 2, - bullet, 1. numbered, \`code\`) only if the surrounding note already uses that style — never force it.>","textRef":"<REQUIRED: exact phrase from the note this applies to>","articles":null}

CRITICAL — textRef: Every suggestion MUST have textRef. Copy the exact phrase from the note (10–80 chars) that this suggestion refers to. This enables highlighting. Never use null.

CRITICAL — NO DUPLICATES: Each suggestion MUST reference a DIFFERENT, NON-OVERLAPPING section of the note. Never suggest the same text twice. Each textRef must be unique.

CRITICAL — preview: Exactly 3–6 words. A short teaser shown in the panel. Never exceed 6 words.

Categories (use exact keys):
- "fact": genuinely wrong factual claims — ones where the note states something clearly and specifically incorrect. ALWAYS include ALL such errors. Preview must NOT repeat textRef — use a short correction teaser, e.g. "Correction: ~13,000 miles".
  NEVER flag: (a) approximations that are reasonably accurate (e.g. "about 50%" when the real value is 48–52% is fine), (b) claims the user has already hedged with words like "about", "roughly", "approximately", "around", "~", "nearly", "some" — hedged language is intentional and correct by definition, (c) minor rounding that doesn't change the meaning. Only flag facts that are clearly, significantly wrong in a way that would mislead a reader.
- "expand": ideas worth developing further
- "clarity": sentences that could be clearer or better structured
- "explain": concepts or terms that deserve a simpler explanation
- "research": cite key claims that are TRUE and IMPORTANT — only suggest when a claim deserves real sources. NEVER suggest research for a passage that ALREADY has inline citations (e.g. "Research supports this:", markdown links like [Smith et al.](url), or similar). FOR THESE ONLY:
  - Populate "articles": [{"title":"Short descriptive title","url":"REAL working URL","source":"Source name"}]
  - Use 2-3 REAL, VERIFIABLE URLs. Prefer: DOI (https://doi.org/10.1234/...), PubMed (https://pubmed.ncbi.nlm.nih.gov/12345678/), Nature, Science, .gov sites, or reputable journals. NO Wikipedia. URLs must be real and working — use your knowledge of real papers and sources.
  - Set "apply" to the inline text to add, with markdown links: e.g. "Research supports this: [Smith et al., Nature 2020](https://doi.org/10.1038/...)." Include 1-2 sentence context + links. Use the EXACT URLs from "articles".
  - "detail" must summarize the actual research findings and why they matter — include specific facts, numbers, or conclusions from the sources. Add inline markdown links in detail too: [source name](url).

QUANTITY RULES (MUST follow exactly):
1. "fact" category: include EVERY factual issue you find. Do not skip any. No cap.
2. ${otherTone}
${focusNew}`,
        `Active note:\n\n${text}${crossCtx}${noteMetaBlock(note)}`, 1500);

      const cleaned = raw.replace(/```json|```/g, "").trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      const arr = match ? JSON.parse(match[0]) : JSON.parse(cleaned);
      if (Array.isArray(arr) && arr.length > 0) {
        // Facts always pass through; non-facts filtered to allowed categories then capped
        // lecture cat never comes from this path but guard anyway
        const facts = arr.filter(s => s.cat === "fact");
        const others = arr.filter(s => s.cat !== "fact" && s.cat !== "question" && s.cat !== "lecture" && allowedOther.includes(s.cat)).slice(0, maxOther);
        const newSugg = [...facts, ...others].map(s => ({ ...s, id: uid(), noteId }));
        // Overlap check: two ranges overlap if a.start < b.end && a.end > b.start
        const overlaps = (a, b) => a && b && a.start < b.end && a.end > b.start;
        // Merge: keep existing valid suggestions, add new ones (no duplicate textRefs, no overlapping sections)
        setSugg(p => {
          const others = p.filter(s => s.noteId !== noteId);
          const forThis = p.filter(s => s.noteId === noteId);
          // Always preserve lecture suggestions — they come from a separate scan
          const lectureExisting = forThis.filter(s => s.cat === "lecture");
          const validExisting = forThis.filter(s => s.cat !== "lecture" && s.textRef && text.includes(s.textRef));
          const existingRanges = validExisting.map(s => findSuggestionRange(text, s)).filter(Boolean);
          const existingRefs = new Set(validExisting.map(s => (s.textRef || "").trim()));
          // Filter new: must have valid ref, not duplicate ref, not overlap with existing
          let candidates = newSugg.filter(s => {
            const ref = (s.textRef || "").trim();
            if (!ref || !text.includes(ref) || existingRefs.has(ref)) return false;
            if (s.cat === "fact" && isSimilarToDismissedFact(ref)) return false;
            if (s.cat === "research" && isSimilarToResearchedSection(ref)) return false;
            const r = findSuggestionRange(text, s);
            if (!r) return false;
            if (existingRanges.some(ex => overlaps(r, ex))) return false;
            return true;
          });
          // Among candidates, drop any that overlap with each other (keep first)
          const kept = [];
          const keptRanges = [];
          for (const s of candidates) {
            const r = findSuggestionRange(text, s);
            if (!r) continue;
            if (keptRanges.some(kr => overlaps(r, kr))) continue;
            kept.push(s);
            keptRanges.push(r);
          }
          // Facts always kept; non-facts filtered to allowed categories and capped; lecture preserved separately
          const keptFacts = kept.filter(s => s.cat === "fact");
          const keptOthers = kept.filter(s => s.cat !== "fact" && s.cat !== "lecture" && allowedOther.includes(s.cat));
          const existingOtherCount = validExisting.filter(s => s.cat !== "fact").length;
          const allowedNewOthers = Math.max(0, maxOther - existingOtherCount);
          const combined = [...validExisting, ...keptFacts, ...keptOthers.slice(0, allowedNewOthers), ...lectureExisting];
          return [...others, ...combined];
        });
        lastScannedContent.current[noteId] = text;
      } else if (Array.isArray(arr)) {
        lastScannedContent.current[noteId] = text;
      }
    } catch (e) {
      console.error("sugg:", e);
      delete lastScannedContent.current[noteId]; // Allow retry on next pause or note switch
    } finally { setBusy(false); setStatus(""); }
  }

  /* ── Ghost completion: only when mid-thought, never after a complete sentence ── */
  async function runGhost(text, cur) {
    if (ghostBusy.current) return;
    // Only complete when cursor is at the end of the text
    if (cur < text.length) return;
    // Never suggest after a complete sentence — user just finished; we don't know what they want next
    const trimmed = text.trim();
    if (/[.!?\n]$/.test(trimmed)) return;
    const frag = text.split(/[.!?\n]+/).filter(s => s.trim()).pop()?.trim();
    if (!frag || frag.length < 10) return;
    // Only suggest for clearly incomplete thoughts (e.g. ends mid-phrase, not a full clause)
    ghostBusy.current = true;
    setGhostThinking(true);
    try {
      const c = await ai(llmProvider, apiKey,
        `You are SunnyD. Complete the user's incomplete thought ONLY when they are clearly mid-sentence or mid-phrase.
Return ONLY the continuation — 1 short sentence, no quotes, no preamble, don't repeat what they wrote.
If the fragment could already be a complete sentence (they may have just forgotten a period), return nothing.`,
        `User paused mid-thought. Complete naturally only if clearly incomplete: "${frag}"`, 120);
      setGhostThinking(false);
      const continuation = c.trim();
      if (continuation) setGhost({ text: " " + continuation, pos: cur });
    } catch { setGhostThinking(false); }
    finally { ghostBusy.current = false; }
  }

  /* ── Editor onChange handler ── */
  const handleEditorChange = useCallback(({ text, html }) => {
    // Persist HTML into notes array
    setNotes(p => p.map(n => n.id === activeId ? { ...n, content: html } : n));
    setGhost(null); setGhostThinking(false);
    clearTimeout(timers.current.t); clearTimeout(timers.current.f);
    clearTimeout(timers.current.s);

    // Only remove suggestions whose textRef is gone; keep lecture suggestions with no textRef
    const removedIds = new Set();
    setSugg(p => {
      const filtered = p.filter(s => {
        if (s.noteId !== activeId) return true;
        if (!s.textRef) return s.cat === "lecture";
        if (!text.includes(s.textRef)) { removedIds.add(s.id); return false; }
        return true;
      });
      return filtered;
    });
    setShownSuggIds(prev => { const n = new Set(prev); removedIds.forEach(id => n.delete(id)); return n; });
    if (dockedCard?.suggestion && removedIds.has(dockedCard.suggestion.id)) {
      setDockedCard(null); setPanelHidden(false);
    }

    checked.current = new Set([...checked.current].filter(t => text.includes(t)));
    dismissed.current.fact = new Set([...dismissed.current.fact].filter(t => text.includes(t)));
    dismissed.current.research = new Set([...dismissed.current.research].filter(t => text.includes(t)));

    const snapId = activeId;
    const snapNotes = notes;
    timers.current.t = setTimeout(() => runGhost(text, text.length), 4800);
    if (suggestionsOn) {
      timers.current.f = setTimeout(() => runFactCheck(text), 5500);
      timers.current.s = setTimeout(() => generateSuggestions(snapId, text, snapNotes), 7000);
    }
  }, [activeId, dockedCard, notes, suggestionsOn]);

  const handleKeyDown = useCallback(e => {
    if (e.key === "Tab" && ghost) {
      e.preventDefault();
      editorRef.current?.insertAtCursor(ghost.text);
      setGhost(null);
      clearTimeout(timers.current.t); clearTimeout(timers.current.f);
      clearTimeout(timers.current.s);
    } else if (e.key === "Escape" && ghost) {
      e.preventDefault();
      setGhost(null);
    }
  }, [ghost]);

  /* ── Selection — reads from Tiptap editor ── */
  const handleMouseUp = e => {
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    setTimeout(() => {
      const selectedText = (editorRef.current?.getSelection() || "").trim();
      if (!selectedText) { setSelMenu(null); return; }
      const start = content.indexOf(selectedText);
      const end = start !== -1 ? start + selectedText.length : -1;
      // Use the actual selection rect for precise positioning; fall back to mouse pos
      const rect = editorRef.current?.getSelectionRect() || null;
      const fmt  = editorRef.current?.getFormatState()    || {};
      const anchorX = rect ? Math.round((rect.left + rect.right) / 2) : mouseX;
      // Place toolbar just above the selection; if near viewport top, place below
      const anchorY = rect
        ? (rect.top < 80 ? rect.bottom + 10 : rect.top - 10)
        : (mouseY < 80 ? mouseY + 10 : mouseY - 10);
      setSelMenu({ text: selectedText, start, end, x: anchorX, y: anchorY, rect, below: (rect ? rect.top < 80 : mouseY < 80), fmt });
    }, 25);
  };

  const handleSelAction = async action => {
    if (!selMenu) return;
    busyWithSelAction.current = true;
    clearTimeout(timers.current.s);
    clearTimeout(timers.current.f);
    const { text: t, start, end, x, y, below } = selMenu;
    const noteTitle = note?.title || "Untitled";
    const ctxBefore = content.slice(Math.max(0, start - 300), start);
    const ctxAfter  = content.slice(end, Math.min(content.length, end + 300));
    // Show thinking pill at same spot as toolbar, then hide toolbar
    setSelMenu(null);
    setSelThinking({ action, x, y, below });

    // Each action has a fixed op so behaviour is predictable
    const OP = { summarize: "replace", expand: "add_after", explain: "add_after" };
    const op = OP[action];

    const sysPrompts = {
      summarize:
        `You are SunnyD. Condense the selected passage into a shorter, clearer version that captures every key idea.
Return ONLY valid JSON (no markdown wrapper): {"text":"<replacement>","explanation":"<1 sentence>"}
The replacement text may use markdown (**bold**, *italic*, ## Heading, - bullet, \`code\`) where it naturally fits — don't overdo it.
Keep the tone of the original note. Do not truncate — the replacement should be complete.`,
      expand:
        `You are SunnyD. Write additional depth, context, or examples to place immediately after the selected passage.
Return ONLY valid JSON (no markdown wrapper): {"text":"<text to add after>","explanation":"<1 sentence>"}
Start your text with a newline (\\n) to form a natural paragraph break.
The text may use markdown (**bold**, *italic*, ## Heading, - bullet, \`code\`) where it naturally fits.
Match the tone of the note. Do not truncate.`,
      explain:
        `You are SunnyD. Write a plain-language explanation of the selected passage to add immediately after it.
Return ONLY valid JSON (no markdown wrapper): {"text":"<explanation to add after>","explanation":"<1 sentence>"}
Start your text with "\\n\\n> " to render as a callout-style blockquote, or with "\\n\\n" for a normal paragraph.
The text may use markdown (**bold**, *italic*, - bullet) where it helps clarity.
Keep it concise (2–4 sentences). Match the note tone.`,
    };
    const userMsg = `Note title: "${noteTitle}"${noteMetaBlock(note)}

Context before selection:
"${ctxBefore}"

Selected text:
"${t}"

Context after selection:
"${ctxAfter}"`;

    try {
      const raw = await ai(llmProvider, apiKey, sysPrompts[action], userMsg, 900);
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      let parsed = { text: raw, explanation: "" };
      if (match) try { parsed = JSON.parse(match[0]); } catch { }
      const text = (parsed.text ?? raw).trim();
      const explanation = (parsed.explanation ?? "").trim() ||
        { summarize: "Replacing your selection with a concise summary.", expand: "Adding expanded content after your selection.", explain: "Adding a plain-language explanation after your selection." }[action];
      setSelRes({ action, text, op, explanation, original: t, start, end, x, y, below });
    } catch (err) {
      const errMsg = err?.message?.includes("API key") ? "API key issue — check your key in the header." : "Something went wrong. Please try again.";
      setSelRes({ action, text: null, op, explanation: errMsg, original: t, start, end, x, y, below, isError: true });
      setTimeout(() => setSelRes(null), 3500);
    }
    finally { busyWithSelAction.current = false; setSelThinking(null); }
  };

  const applySuggestion = async s => {
    setSugg(p => p.map(x => x.id === s.id ? { ...x, applying: true } : x));

    // Activate the pulsing highlight and the pill overlay on the affected text
    if (s.textRef) {
      editorRef.current?.setApplyingHighlight(s.textRef);
      const pos = getPillPosition(s.textRef);
      setApplyingOverlay({ cat: s.cat, ...(pos || { top: 80, left: window.innerWidth / 2 - 130 }) });
    }

    /* Helper: dismiss pill + highlight with a smooth exit, flash inserted text, then housekeeping */
    const finalize = (appliedText) => {
      // Exit-animate the pill, then swap applying glow → inserted flash
      setApplyingOverlay(prev => prev ? { ...prev, exiting: true } : null);
      setTimeout(() => {
        setApplyingOverlay(null);
        editorRef.current?.clearApplyingHighlight();
        // Blink-then-glow the newly inserted text so the user can see exactly what changed
        const searchKey = (appliedText || "").trim();
        if (searchKey) {
          editorRef.current?.setInsertedHighlight(searchKey);
          // Keep the glow for 9 seconds then silently clear
          setTimeout(() => editorRef.current?.clearInsertedHighlight(), 9000);
        }
      }, 280);
      if (s.cat === "research" && s.textRef) dismissed.current.research.add(s.textRef.trim());
      setSugg(p => p.filter(x => {
        if (x.id === s.id) return false;
        if (s.cat === "research" && x.cat === "research" && isSimilarToResearchedSection((x.textRef || "").trim())) return false;
        return true;
      }));
      setStatus("");
      if (suggestionsOn) {
        lastScannedContent.current[activeId] = "";
        if (s.cat === "fact" && s.apply) {
          dismissed.current.fact.add(s.apply.trim());
          const appliedSents = (appliedText || "").match(/[A-Z][^.!?\n]{20,}[.!?]/g) || [];
          const key = s.apply.trim().slice(0, 35);
          for (const sent of appliedSents) {
            if (key.length >= 15 && sent.includes(key.slice(0, 20))) dismissed.current.fact.add(sent.trim());
          }
        }
        clearTimeout(timers.current.f);
        clearTimeout(timers.current.s);
        setTimeout(() => runFactCheck(editorRef.current?.getEditorContent() || content), 1500);
        setTimeout(() => generateSuggestions(activeId, editorRef.current?.getEditorContent() || content, notes), 2500);
      }
    };

    // ── Lecture / expand with no textRef → append rich content to end ──────────
    if ((s.cat === "lecture" || s.cat === "expand") && !s.textRef) {
      const insertion = s.apply || s.detail;
      editorRef.current?.appendContent(mdToHtml(insertion));
      finalize(insertion);
      return;
    }

    const textRef = s.textRef;
    const insertion = s.apply || s.detail;

    // ── Expand: insert rich content after the referenced section ─────────────
    if (s.cat === "expand") {
      const html = mdToHtml(insertion);
      const ok = textRef ? editorRef.current?.insertAfterText(textRef, html) : false;
      if (!ok) editorRef.current?.appendContent(html);
      finalize(insertion);
      return;
    }

    // ── Research: insert citation after the referenced section ────────────────
    if (s.cat === "research") {
      const html = mdToHtml(insertion);
      const ok = textRef ? editorRef.current?.insertAfterText(textRef, html) : false;
      if (!ok) editorRef.current?.appendContent(html);
      finalize(insertion);
      return;
    }

    // ── Fact / clarity: ask LLM to rewrite ONLY the affected passage ─────────
    setStatus("Weaving suggestion into notes…");
    try {
      // Pull surrounding context so the rewrite blends in seamlessly
      const refStart = content.indexOf(textRef || "");
      const ctxBefore = refStart > 0  ? content.slice(Math.max(0, refStart - 180), refStart).trim()             : "";
      const ctxAfter  = refStart >= 0 ? content.slice(refStart + (textRef || "").length, refStart + (textRef || "").length + 180).trim() : "";
      const surroundBlock = [
        ctxBefore && `Text immediately BEFORE the passage:\n"${ctxBefore}"`,
        ctxAfter  && `Text immediately AFTER the passage:\n"${ctxAfter}"`,
      ].filter(Boolean).join("\n\n");

      let systemPrompt, userPrompt;
      if (s.cat === "fact") {
        systemPrompt = `You are a writing assistant making a surgical factual correction inside a student's notes.
Return ONLY the corrected passage — no preamble, no explanation, no quotes around it.
CRITICAL FLOW RULES:
- Match the EXACT tone, voice, and formatting of the original passage (casual/formal, bullets/prose, tense).
- Your replacement must be a seamless drop-in — it should read as if the student wrote it themselves.
- Do NOT change sentence structure beyond what is needed for the factual fix.
- Do NOT add new information, headings, or sections not present in the original.
- Only use markdown if the original passage already uses markdown.`;
        userPrompt = `${surroundBlock}${surroundBlock ? "\n\n" : ""}Original passage: "${textRef}"
Factual correction needed: ${s.detail}
Suggested corrected text (use as a guide, adapt to fit naturally): ${s.apply || s.detail}
Return the corrected passage only:`;
      } else {
        systemPrompt = `You are a writing assistant making a clarity improvement inside a student's notes.
Return ONLY the rewritten passage — no preamble, no explanation, no quotes around it.
CRITICAL FLOW RULES:
- Match the EXACT tone, voice, and formatting of the original passage (casual/formal, bullets/prose, tense).
- Your rewrite must be a seamless drop-in — it should read as if the student wrote it themselves.
- Preserve the original length as closely as possible. Do NOT expand into multiple paragraphs.
- Do NOT add headings or new sections. Do NOT change the topic or add new information.
- Only use markdown if the original passage already uses markdown.`;
        userPrompt = `${surroundBlock}${surroundBlock ? "\n\n" : ""}Original passage: "${textRef}"
Clarity suggestion: ${s.detail}
Return the rewritten passage only:`;
      }

      const replacement = await ai(llmProvider, apiKey, systemPrompt, userPrompt, 600);
      if (replacement.trim() && textRef) {
        const ok = editorRef.current?.findAndReplaceText(textRef, mdToHtml(replacement.trim()));
        if (!ok) editorRef.current?.appendContent(mdToHtml(replacement.trim()));
      } else if (replacement.trim()) {
        editorRef.current?.appendContent(mdToHtml(replacement.trim()));
      }
      finalize(replacement.trim());
    } catch {
      if (insertion && textRef) {
        const ok = editorRef.current?.findAndReplaceText(textRef, mdToHtml(insertion));
        if (!ok) editorRef.current?.appendContent(mdToHtml(insertion));
      } else if (insertion) {
        editorRef.current?.appendContent(mdToHtml(insertion));
      }
      finalize(insertion);
    }
  };

  const weaveSelResult = () => {
    if (!selRes) return;
    clearTimeout(timers.current.s);
    clearTimeout(timers.current.f);
    const { original, text, op } = selRes;
    const html = mdToHtml(text);
    // Use Tiptap surgical methods — never slice plain-text (that destroys HTML formatting)
    if (op === "replace") {
      editorRef.current?.findAndReplaceText(original, html);
    } else if (op === "add_after") {
      editorRef.current?.insertAfterText(original, html);
    } else if (op === "add_before") {
      // insertAfterText doesn't support before; fall back to find-replace with original prepended
      editorRef.current?.findAndReplaceText(original, html + "<p>" + original + "</p>");
    } else if (op === "delete") {
      editorRef.current?.findAndReplaceText(original, html || "");
    }
    // Flash the applied text so user can see exactly what changed
    setTimeout(() => editorRef.current?.setInsertedHighlight(text.slice(0, 60).trim()), 120);
    setSelRes(null);
    lastScannedContent.current[activeId] = "";
    if (suggestionsOn) {
      setTimeout(() => runFactCheck(content), 1500);
      setTimeout(() => generateSuggestions(activeId, content, notes), 2500);
    }
  };

  const dismissSugg = id => {
    const s = suggestions.find(x => x.id === id);
    if (s?.cat === "fact" && s?.textRef) dismissed.current.fact.add(s.textRef);
    if (s?.cat === "research" && s?.textRef) dismissed.current.research.add(s.textRef.trim());
    setSugg(p => p.filter(x => x.id !== id));
    setShownSuggIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  /* ── Save notes to a file on disk (File System Access API) ── */
  const saveNotesToDisk = async () => {
    if (!supportsFileAccess()) return;
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "sunnyd-notes.json",
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
      });
      await setStoredFileHandle(handle);
      await writeToFile(handle, notes, activeId);
      fileHandleRef.current = handle;
      setSavingToDisk(true);
    } catch (e) {
      if (e.name !== "AbortError") console.error("Save to disk:", e);
    }
  };

  /* ── HTML → docx paragraphs helper ── */
  const htmlToDocxParagraphs = (html) => {
    if (!html) return [];
    const isHtml = html.trimStart().startsWith("<");
    if (!isHtml) {
      // Plain text fallback
      return html.split("\n").map(line =>
        line.trim() === ""
          ? new Paragraph({ text: "", spacing: { after: 80 } })
          : new Paragraph({ children: [new TextRun({ text: line, size: 24, font: "Calibri" })], spacing: { after: 120 } })
      );
    }
    const div = document.createElement("div");
    div.innerHTML = html;
    const paras = [];
    const processInline = (node) => {
      const runs = [];
      node.childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
          if (child.textContent) runs.push(new TextRun({ text: child.textContent, size: 24, font: "Calibri" }));
        } else if (child.tagName === "STRONG" || child.tagName === "B") {
          runs.push(new TextRun({ text: child.textContent, bold: true, size: 24, font: "Calibri" }));
        } else if (child.tagName === "EM" || child.tagName === "I") {
          runs.push(new TextRun({ text: child.textContent, italics: true, size: 24, font: "Calibri" }));
        } else if (child.tagName === "CODE") {
          runs.push(new TextRun({ text: child.textContent, font: "Courier New", size: 22 }));
        } else {
          runs.push(new TextRun({ text: child.textContent, size: 24, font: "Calibri" }));
        }
      });
      return runs;
    };
    div.childNodes.forEach(node => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === "H1") {
        paras.push(new Paragraph({ text: node.textContent, heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }));
      } else if (tag === "H2") {
        paras.push(new Paragraph({ text: node.textContent, heading: HeadingLevel.HEADING_2, spacing: { after: 160 } }));
      } else if (tag === "H3") {
        paras.push(new Paragraph({ text: node.textContent, heading: HeadingLevel.HEADING_3, spacing: { after: 140 } }));
      } else if (tag === "UL" || tag === "OL") {
        node.querySelectorAll("li").forEach(li => {
          paras.push(new Paragraph({ text: li.textContent, bullet: { level: 0 }, spacing: { after: 80 } }));
        });
      } else if (tag === "PRE" || tag === "CODE") {
        paras.push(new Paragraph({ children: [new TextRun({ text: node.textContent, font: "Courier New", size: 22 })], spacing: { after: 120 } }));
      } else {
        const text = node.textContent?.trim();
        if (!text) return;
        const runs = processInline(node);
        paras.push(new Paragraph({ children: runs.length ? runs : [new TextRun({ text, size: 24, font: "Calibri" })], spacing: { after: 120 } }));
      }
    });
    return paras;
  };

  /* ── Export notes to .docx ── */
  const exportToDocx = async (exportAll = false) => {
    const toExport = exportAll ? notes : notes.filter(n => n.id === activeId);
    const children = [];

    toExport.forEach((n, ni) => {
      if (ni > 0) {
        children.push(new Paragraph({ text: "", spacing: { after: 200 } }));
        children.push(new Paragraph({
          text: "─────────────────────────────────",
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }));
      }
      children.push(new Paragraph({
        text: n.title || "Untitled",
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 200 },
      }));
      children.push(...htmlToDocxParagraphs(n.content || ""));
    });

    const doc = new Document({
      creator: "SunnyD NoteTaker",
      title: exportAll ? "All Notes" : (toExport[0]?.title || "Note"),
      sections: [{ children }],
    });

    const blob = await Packer.toBlob(doc);
    const filename = exportAll
      ? `SunnyD_Notes_${new Date().toISOString().slice(0, 10)}.docx`
      : `${(toExport[0]?.title || "Note").replace(/[^a-z0-9]/gi, "_")}.docx`;
    saveAs(blob, filename);
  };

  const CARD_WIDTH = 300;
  const CARD_HEIGHT = 420;

  const getDockedCardPosition = useCallback((suggestion) => {
    const editorRect = docColRef.current?.getBoundingClientRect();
    const fallback = { top: 120, left: (editorRect?.right ?? 0) + 16 };

    const editorDom = editorRef.current?.getEditorDom();
    const range = findSuggestionRange(content, suggestion);
    if (!range || !editorDom || !editorRect) return fallback;

    const refIndex = range.start;
    const refLen = range.end - range.start;
    const walker = document.createTreeWalker(editorDom, NodeFilter.SHOW_TEXT);
    let node, offset = 0, targetRect = null;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (offset + len > refIndex) {
        const r = document.createRange();
        r.setStart(node, refIndex - offset);
        r.setEnd(node, Math.min(refIndex - offset + refLen, len));
        targetRect = r.getBoundingClientRect();
        break;
      }
      offset += len;
    }
    if (!targetRect) return fallback;
    let cardLeft = editorRect.right + 16;
    if (cardLeft + CARD_WIDTH > window.innerWidth) cardLeft = window.innerWidth - CARD_WIDTH - 16;
    const cardTop = Math.max(10, Math.min(targetRect.top, window.innerHeight - CARD_HEIGHT - 10));
    return { top: cardTop, left: cardLeft };
  }, [content]);

  const handleCardClick = (suggestion, e) => {
    e.stopPropagation();
    setPanelHidden(true);
    const pos = getDockedCardPosition(suggestion);
    setDockedCard({ suggestion, top: pos.top, left: pos.left });
  };

  const closeDocked = () => {
    setDockedCard(null);
    setPanelHidden(false);
  };

  useEffect(() => {
    const onKey = e => {
      if (e.key === "Escape" && noteSetupModal) { confirmNoteSetup(true); return; }
      if (e.key === "Escape" && dockedCard) closeDocked();
      if (e.key === "Escape" && selRes) setSelRes(null);
      if (e.key === "Escape" && selMenu) setSelMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dockedCard, selRes, selMenu, noteSetupModal]);

  /* ── Dismiss selection toolbar on scroll ── */
  useEffect(() => {
    const el = mainAreaRef.current;
    if (!el || !selMenu) return;
    const onScroll = () => setSelMenu(null);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [selMenu]);

  /* ── Global ⌘K / Ctrl+K to toggle search palette; ⌘N / Ctrl+N for new note ── */
  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const onKey = e => {
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        openNewNoteSetup();
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Weave overlay: removed (hl-layer replaced by Tiptap editor) ── */

  /* ── Remove stale suggestions when content changes (e.g. after applying) ── */
  useEffect(() => {
    const stale = suggestions.filter(s => s.noteId === activeId && s.textRef && !content.includes(s.textRef));
    if (stale.length === 0) return;
    const staleIds = new Set(stale.map(s => s.id));
    setSugg(p => p.filter(s => !staleIds.has(s.id)));
    setShownSuggIds(prev => { const n = new Set(prev); staleIds.forEach(id => n.delete(id)); return n; });
    if (dockedCard?.suggestion && staleIds.has(dockedCard.suggestion.id)) { setDockedCard(null); setPanelHidden(false); }
  }, [content, activeId, suggestions, dockedCard]);

  /* ── Init on note switch ── */
  useEffect(() => {
    if (!apiKey) return;
    checked.current = new Set();
    setGhost(null); setGhostThinking(false); setSelRes(null); setSelMenu(null); setSelThinking(null); setHoveredSuggId(null); setDockedCard(null); setPanelHidden(false);
    const snapNotes = notes;
    const t1 = suggestionsOn ? setTimeout(() => runFactCheck(content), 2500) : null;
    const t3 = suggestionsOn ? setTimeout(() => generateSuggestions(activeId, content, snapNotes), 5000) : null;
    return () => { if (t1) clearTimeout(t1); if (t3) clearTimeout(t3); };
  }, [activeId, apiKey, suggestionsOn]);

  /* ── Sorted shown suggestions by text position ── */
  const shownSugg = activeSugg.filter(s => shownSuggIds.has(s.id));
  const pendingCount = activeSugg.length - shownSugg.length;
  const sortedSugg = [...shownSugg].sort((a, b) => {
    const pa = a.textRef ? content.indexOf(a.textRef) : Infinity;
    const pb = b.textRef ? content.indexOf(b.textRef) : Infinity;
    return pa - pb;
  });

  const SUGG_CARD_H = 44;
  const SUGG_GAP = 8;
  const MIN_SPACING = SUGG_CARD_H + SUGG_GAP;

  const sortedSuggRef = useRef(sortedSugg);
  const contentRef = useRef(content);
  sortedSuggRef.current = sortedSugg;
  contentRef.current = content;

  const recalcSuggTops = useCallback(() => {
    try {
      const sugg = sortedSuggRef.current;
      const txt = contentRef.current;
      const panel = panelBodyRef.current;
      if (!panel || sugg.length === 0) {
        setSuggTops(prev => (Object.keys(prev).length === 0 ? prev : {}));
        return;
      }
      // Use the editor DOM for text-position-to-pixel mapping
      const editorDom = editorRef.current?.getEditorDom();
      const positions = {};
      for (const s of sugg) {
        if (!s.textRef) { positions[s.id] = null; continue; }
        // Try to find the text in the editor's DOM
        let found = false;
        if (editorDom) {
          const walker = document.createTreeWalker(editorDom, NodeFilter.SHOW_TEXT);
          let node, charOffset = 0;
          const refIndex = txt.indexOf(s.textRef);
          if (refIndex !== -1) {
            while ((node = walker.nextNode())) {
              const len = node.textContent.length;
              if (charOffset + len > refIndex) {
                const offsetInNode = Math.max(0, Math.min(refIndex - charOffset, len - 1));
                const r = document.createRange();
                r.setStart(node, offsetInNode);
                r.setEnd(node, Math.min(offsetInNode + 1, len));
                const rect = r.getBoundingClientRect();
                const panelRect = panel.getBoundingClientRect();
                positions[s.id] = rect.top - panelRect.top;
                found = true;
                break;
              }
              charOffset += len;
            }
          }
        }
        if (!found) {
          // Fallback: fraction-based positioning
          const idx = txt.indexOf(s.textRef);
          if (idx !== -1) {
            const panelHeight = panel.clientHeight || 600;
            positions[s.id] = Math.max(0, (idx / Math.max(txt.length, 1)) * Math.max(panelHeight, 200));
          } else {
            positions[s.id] = null;
          }
        }
      }
      // Sort by computed position (nulls go to end)
      const sorted = [...sugg].sort((a, b) => (positions[a.id] ?? 9999) - (positions[b.id] ?? 9999));
      // Assign fallback positions to null-textRef cards so they participate in collision avoidance
      let lastAssigned = 0;
      for (let i = 0; i < sorted.length; i++) {
        if (positions[sorted[i].id] == null) {
          positions[sorted[i].id] = Math.max(0, lastAssigned);
        } else {
          lastAssigned = positions[sorted[i].id];
        }
      }
      // Re-sort after filling nulls, then apply collision avoidance in a single forward pass
      sorted.sort((a, b) => positions[a.id] - positions[b.id]);
      // Clamp first card to minimum 0
      if (sorted.length > 0) positions[sorted[0].id] = Math.max(0, positions[sorted[0].id]);
      for (let i = 1; i < sorted.length; i++) {
        const prevTop = positions[sorted[i - 1].id];
        const currTop = positions[sorted[i].id];
        if (currTop < prevTop + MIN_SPACING) {
          positions[sorted[i].id] = prevTop + MIN_SPACING;
        }
      }
      setSuggTops(prev => {
        const keys = Object.keys(positions);
        if (keys.length !== Object.keys(prev).length) return positions;
        if (keys.some(k => prev[k] !== positions[k])) return positions;
        return prev;
      });
    } catch (e) {
      console.warn("recalcSuggTops:", e);
      setSuggTops(prev => (Object.keys(prev).length === 0 ? prev : {}));
    }
  }, []);

  const sortedSuggKey = sortedSugg.map(s => s.id).sort().join(",");
  useLayoutEffect(() => {
    recalcSuggTops();
  }, [content, sortedSuggKey, recalcSuggTops]);

  useEffect(() => {
    const main = mainAreaRef.current;
    const ann = annColRef.current;
    if (!main && !ann) return;
    const onScroll = () => requestAnimationFrame(recalcSuggTops);
    main?.addEventListener("scroll", onScroll, { passive: true });
    ann?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      main?.removeEventListener("scroll", onScroll);
      ann?.removeEventListener("scroll", onScroll);
    };
  }, [recalcSuggTops]);

  /* ── Wire hover/docked → editor highlight (skip while applying) ── */
  useEffect(() => {
    if (applyingSugg) return; // applying highlight takes precedence
    // Docked card keeps its textRef highlighted even after mouse leaves
    const dockedRef = dockedCard?.suggestion?.textRef;
    if (dockedRef) {
      editorRef.current?.setHoverHighlight(dockedRef);
      return;
    }
    // Hover highlight
    const hovRef = activeSugg.find(s => s.id === hoveredSuggId)?.textRef;
    if (hovRef) {
      editorRef.current?.setHoverHighlight(hovRef);
    } else {
      editorRef.current?.clearHoverHighlight();
    }
  }, [hoveredSuggId, activeSugg, applyingSugg, dockedCard]);

  // Skeletons only show while AI is generating suggestions — NOT when user runs selection actions (expand/summarize/explain)
  const showThinking = busy && activeSugg.length === 0 && !busyWithSelAction.current;

  const wc = (content.replace(/<[^>]*>/g, ' ').match(/\S+/g) || []).length;

  const SEL_ACTS = [
    { key: "summarize", icon: "◈", label: "Summarize" },
    { key: "expand",    icon: "⊕", label: "Expand"    },
    { key: "explain",   icon: "◉", label: "Explain"   },
  ];

  if (!apiKey) return <><style>{CSS}</style><KeyScreen onSave={saveKeys} /></>;

  return (
    <>
      <style>{CSS}</style>
      <div className="app" onClick={() => { setSelMenu(null); setExportOpen(false); }}>

        {/* Header */}
        <header className="hdr">
          <div className="logo">
            <div className="logo-sq">S</div>
            <span className="logo-name">SunnyD</span>
            <div className="logo-sep" />
            <span className="logo-tag">Intelligent Notes</span>
          </div>
          <div className={`hdr-pill${busy ? " live" : ""}`}>
            <div className="hdr-dot" />
            <span>{busy ? statusTxt : "Ready"}</span>
          </div>
          <div className="hdr-r">
            {browserSupportsSpeechRecognition && (
              <>
                <button
                  className={`lecture-btn${lectureOn ? " on" : ""}`}
                  onClick={() => setLectureOn(p => !p)}
                  title={lectureOn ? "Stop live transcription" : "Start live transcription"}
                >
                  {lectureOn && listening && !lecturePaused
                    ? <span className="lecture-rec-dot" style={{ width: 7, height: 7 }} />
                    : <span className="lecture-btn-ic">◉</span>}
                  <span>{lectureOn ? (lecturePaused ? "Paused" : "Recording") : "Lecture"}</span>
                </button>
                <span className="hdr-sep" />
              </>
            )}
            <span className="hdr-wc">{wc} words</span>
            <button
              type="button"
              className="hdr-podcast-btn"
              title="SunnyD Cast — podcast replay from your notes"
              onClick={e => {
                e.stopPropagation();
                setExportOpen(false);
                setPodcastMinimized(false);
                setPodcastOpen(true);
                try {
                  if (typeof speechSynthesis !== "undefined") speechSynthesis.getVoices();
                } catch {}
              }}
            >
              ☀️ SunnyD Cast
            </button>
            <div className="export-wrap" title="Export notes" onClick={e => e.stopPropagation()}>
              <button className="export-btn" onClick={() => setExportOpen(p => !p)}>
                ↓ Export
              </button>
              {exportOpen && (
                <div className="export-menu">
                  <button className="export-item" onClick={() => { exportToDocx(false); setExportOpen(false); }}>
                    <span className="export-item-ic">📄</span>
                    <span>
                      <span className="export-item-lbl">This note (.docx)</span>
                      <span className="export-item-desc">Open in Word or Google Docs</span>
                    </span>
                  </button>
                  <button className="export-item" onClick={() => { exportToDocx(true); setExportOpen(false); }}>
                    <span className="export-item-ic">📚</span>
                    <span>
                      <span className="export-item-lbl">All notes (.docx)</span>
                      <span className="export-item-desc">Export all notes in one file</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
            <select className="hdr-llm-select" value={llmProvider} onChange={e => setProviderAndLoadKey(e.target.value)} title="Switch LLM">
              {PROVIDERS.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <button className="btn-link" onClick={resetKey}>Change key</button>
          </div>
        </header>

        {lectureOn && (
          <div className="lecture-panel">
            {/* Header row: status label + action buttons */}
            <div className="lecture-panel-hdr">
              <span className="lecture-panel-lbl">
                {listening && !lecturePaused
                  ? <><span className="lecture-rec-dot" />Live transcription</>
                  : <span style={{ opacity: .65 }}>⏸ Paused</span>}
              </span>
              <div className="lecture-panel-actions">
                <button className="lecture-pause-btn" onClick={() => setLecturePaused(p => !p)}>
                  {lecturePaused ? "▶ Resume" : "⏸ Pause"}
                </button>
                <button className="lecture-panel-btn" onClick={() => setShowFullTranscript(p => !p)}>
                  {showFullTranscript ? "Collapse" : "Expand"}
                </button>
                <button className="lecture-panel-btn" onClick={() => {
                  resetTranscript();
                  setLectureQs([]);
                  setActiveLectureQ(null);
                  setNotedQIds(new Set());
                  setLectureSecs(0);
                  scannedTranscriptRef.current = "";
                  scannedLectureSuggRef.current = "";
                  setSugg(p => p.filter(s => s.cat !== "lecture"));
                }}>Clear</button>
              </div>
            </div>

            {/* Stats row */}
            {(finalTranscript || lectureSecs > 0) && (
              <div className="lecture-stats">
                <span className="lecture-stat">
                  <span>Duration</span>
                  <span className="lecture-stat-val">{fmtDuration(lectureSecs)}</span>
                </span>
                <span className="lecture-stat">
                  <span>Words</span>
                  <span className="lecture-stat-val">{(finalTranscript.match(/\S+/g) || []).length}</span>
                </span>
                {lectureQs.length > 0 && (
                  <span className="lecture-stat">
                    <span>Questions</span>
                    <span className="lecture-stat-val" style={{ color: "#5E38A0" }}>{lectureQs.length}</span>
                  </span>
                )}
              </div>
            )}

            {/* Transcript */}
            <div className={`lecture-transcript${showFullTranscript ? " expanded" : ""}`}>
              {transcript ? (
                <p className="lecture-text">
                  {renderTranscriptText(finalTranscript)}
                  {interimTranscript && <span className="lecture-interim"> {interimTranscript}</span>}
                  <span ref={transcriptEndRef} />
                </p>
              ) : (
                <p className="lecture-placeholder">
                  {lecturePaused
                    ? "Transcription paused. Click Resume to continue capturing."
                    : "Speak to see live transcription. Questions are automatically highlighted."}
                </p>
              )}
            </div>

            {/* Footer: question badge + expand hint */}
            {lectureQs.length > 0 && (
              <div className="lecture-footer">
                <span className="lecture-q-count">
                  {lectureQs.filter(q => notedQIds.has(q.id)).length > 0
                    ? `${lectureQs.filter(q => notedQIds.has(q.id)).length}/${lectureQs.length} questions added to notes`
                    : `${lectureQs.length} question${lectureQs.length > 1 ? "s" : ""} — click to respond`}
                </span>
                {!showFullTranscript && finalTranscript && (
                  <span style={{ fontSize: 10, color: "var(--ink3)", cursor: "pointer" }} onClick={() => setShowFullTranscript(true)}>
                    Show full transcript ↓
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Lecture question answer card */}
        {activeLectureQ && (() => {
          const q = activeLectureQ.q;
          const isNoted    = notedQIds.has(q.id);
          const isExpanded = !!(q.expandedAnswer);
          // Display the expanded answer if available, otherwise the short one
          const displayAnswer = isExpanded ? q.expandedAnswer : q.answer;

          // Smart positioning: prefer below-right of click, keep fully on screen
          const cardW  = 390;
          // Card height grows when expanded; use a loose estimate for initial placement only
          const cardH  = isExpanded ? 560 : 300;
          const cardLeft = Math.max(12, Math.min(activeLectureQ.x - 40, window.innerWidth - cardW - 12));
          const cardTop  = activeLectureQ.y + 16 + cardH > window.innerHeight
            ? Math.max(10, activeLectureQ.y - cardH - 8)
            : activeLectureQ.y + 16;

          return (
            <div
              className="lecture-q-card"
              style={{ top: cardTop, left: cardLeft, width: cardW }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="lecture-q-card-hdr">
                <span className="lecture-q-badge">
                  {isNoted ? "✓ Added to notes" : isExpanded ? "⊕ Detailed response" : "Suggested response"}
                </span>
                <button className="x-btn" onClick={() => {
                  setActiveLectureQ(null);
                  setLectureQCopied(false);
                  setLectureQAdded(false);
                  setLectureQExpanding(false);
                }}>×</button>
              </div>

              {/* Question quote */}
              <div className="lecture-q-question">{q.text}</div>

              {/* Answer / loading states */}
              {(lectureQRefreshing || lectureQGenerating || lectureQExpanding) ? (
                <div className="lecture-q-loading">
                  <ThinkDots />
                  <span>
                    {lectureQRefreshing  ? "Regenerating…"
                     : lectureQExpanding ? "Expanding response…"
                     :                    "Drafting response…"}
                  </span>
                </div>
              ) : displayAnswer ? (
                <>
                  {/* Answer body — compact or expanded, renders markdown as HTML */}
                  <div
                    className={`lecture-q-answer ${isExpanded ? "expanded" : "compact"}`}
                    dangerouslySetInnerHTML={{ __html: mdToHtml(displayAnswer) }}
                  />

                  {/* Action bar */}
                  <div className="lecture-q-btns">
                    {/* Add to Notes */}
                    <button
                      className={`lecture-q-add-btn${lectureQAdded || isNoted ? " noted" : ""}`}
                      onClick={() => {
                        if (isNoted) return;
                        // Add whichever answer is currently showing
                        addQuestionToNotes({ ...q, answer: displayAnswer });
                        setLectureQAdded(true);
                        setTimeout(() => { setActiveLectureQ(null); setLectureQAdded(false); }, 1200);
                      }}
                    >
                      {lectureQAdded || isNoted ? "✓ Added" : "＋ Add to Notes"}
                    </button>

                    {/* Expand / Collapse */}
                    <button
                      className={`lecture-q-expand-btn${isExpanded ? " active" : ""}`}
                      title={isExpanded ? "Show concise answer" : "Get a detailed, structured answer"}
                      onClick={() => {
                        if (isExpanded) {
                          // Collapse back to the short answer
                          setLectureQs(prev => prev.map(x => x.id === q.id ? { ...x, expandedAnswer: null } : x));
                          setActiveLectureQ(prev => prev?.q.id === q.id ? { ...prev, q: { ...prev.q, expandedAnswer: null } } : prev);
                        } else {
                          expandLectureAnswer(q);
                        }
                      }}
                    >
                      {isExpanded ? "⊖ Collapse" : "⊕ Expand"}
                    </button>

                    {/* Copy */}
                    <button
                      className="lecture-panel-btn"
                      style={{ flexShrink: 0 }}
                      onClick={() => {
                        const txt = `Q: ${q.text}\nA: ${displayAnswer}`;
                        navigator.clipboard.writeText(txt).catch(() => {
                          const el = document.createElement("textarea");
                          el.value = txt; document.body.appendChild(el); el.select();
                          document.execCommand("copy"); document.body.removeChild(el);
                        });
                        setLectureQCopied(true);
                        setTimeout(() => setLectureQCopied(false), 1800);
                      }}
                    >
                      {lectureQCopied ? "Copied!" : "Copy"}
                    </button>

                    {/* Refresh (only for short answer) */}
                    {!isExpanded && (
                      <button
                        className="lecture-q-refresh-btn"
                        title="Regenerate concise response"
                        onClick={async () => {
                          const qId = q.id; const qText = q.text;
                          setLectureQRefreshing(true);
                          try {
                            const noteContext = notes.map(n => `[${n.title}]:\n${htmlToText(n.content).slice(0, 400)}`).join("\n\n");
                            const raw = await ai(
                              llmProvider, apiKey,
                              `You are SunnyD, a knowledgeable academic assistant. A question was just raised in class and you need to give the student a smart, accurate answer they can use to contribute to the discussion.

CRITICAL RULES:
- You have broad, expert knowledge — USE IT. Never say you "don't have notes on this" or pretend not to know something you clearly know.
- Answer the question directly and accurately from your knowledge. The student's notes are additional context, not your only source.
- Write 1-2 confident, substantive sentences the student could actually say in class.
- NEVER hedge with "based on the name it seems like" or "I think it might be" — give a real answer.

Return ONLY valid JSON: {"answer":"1-2 clear, accurate sentences"}`,
                              `Question: "${qText}"\n\nStudent notes (for context):\n${noteContext.slice(0, 1200)}${noteMetaBlock(note)}`,
                              400
                            );
                            const m = raw.replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/);
                            const parsed = m ? (() => { try { return JSON.parse(m[0]); } catch { return null; } })() : null;
                            const newAnswer = parsed?.answer?.trim() || q.answer;
                            setLectureQs(prev => prev.map(x => x.id === qId ? { ...x, answer: newAnswer } : x));
                            setActiveLectureQ(prev => prev ? { ...prev, q: { ...prev.q, answer: newAnswer } } : prev);
                          } catch {}
                          finally { setLectureQRefreshing(false); }
                        }}
                      >↺</button>
                    )}
                  </div>
                </>
              ) : (
                <div className="lecture-q-loading"><ThinkDots /><span>Drafting response…</span></div>
              )}
            </div>
          );
        })()}

        <div className="sugg-freq-bar">
          <span className="sugg-freq-lbl">Suggestions:</span>
          {[
            { key: "off", label: "Off", desc: "No suggestions" },
            { key: "zen", label: "Zen", desc: "At least ~1 per 85 words" },
            { key: "balanced", label: "Just Right", desc: "At least ~1 per 45 words" },
            { key: "eager", label: "Eager", desc: "At least ~1 per 22 words" },
          ].map(({ key, label, desc }) => (
            <button key={key} className={`sugg-freq-btn${suggFreq === key ? " on" : ""}`} onClick={() => setSuggFreqAndSave(key)} title={desc}>
              {label}
            </button>
          ))}
        </div>

        <div className="layout">

          {/* Notes sidebar */}
          <aside className="notes-sb">
            <div className="sb-top-row">
              <button className="new-btn" title={`New note (${MOD_KEY}+N)`} onClick={() => openNewNoteSetup()}>+ New Note</button>
              <button className="search-btn" title={`Search notes (${MOD_KEY}+K)`} onClick={() => setSearchOpen(true)}>⌕</button>
            </div>
            {notes.map(n => {
              const switchNote = () => { setActiveId(n.id); setGhost(null); setGhostThinking(false); setSelMenu(null); setSelThinking(null); setSelRes(null); setHoveredSuggId(null); setDockedCard(null); setPanelHidden(false); };
              return (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  title={n.title || "Untitled"}
                  className={`note-row${n.id === activeId ? " on" : ""}`}
                  onClick={switchNote}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchNote(); } }}
                >
                  <div className="nr-pip" />
                  <span className="nr-lbl">{n.title || "Untitled"}</span>
                </div>
              );
            })}
            <div className="sb-footer">
              {savingToDisk ? (
                <div key={lastSavedAt} className="sb-autosave sb-disk just-saved">✓ Saved to disk</div>
              ) : (
                <>
                  <div key={lastSavedAt} className="sb-autosave just-saved">✓ Notes saved locally</div>
                  {supportsFileAccess() && (
                    <button type="button" className="sb-disk-btn" onClick={saveNotesToDisk}>
                      Save to file on disk
                    </button>
                  )}
                </>
              )}
              <div className="sb-ttl">How it works</div>
              {[
                ["Fact checks",  "Right panel — hover to highlight"],
                ["Completion",   "Tab to accept"],
                ["Selection",    "Highlight text to transform"],
                ["New note",     `${MOD_KEY}+N`],
                ["Search",       `${MOD_KEY}+K`],
              ].map(([h, d]) => (
                <div key={h} className="sb-item"><div className="sb-h">{h}</div><div className="sb-d">{d}</div></div>
              ))}
            </div>
          </aside>

          {/* Main area: editor + annotation column scroll together */}
          <div ref={mainAreaRef} className="main-area" onMouseUp={handleMouseUp} onClick={e => e.stopPropagation()}>
            <div className="main-inner">

              {/* Document column — click to close docked card */}
              <div ref={docColRef} className="doc-col" onClick={() => dockedCard && closeDocked()}>
                <div className="margin-line" />
                <input className="title-inp" value={note.title} onChange={e => setTitle(e.target.value)} placeholder="Untitled" />
                <div className="meta-row">
                  <span>{new Date(note.createdAt || Date.now()).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
                  {activeSugg.length > 0 && <span className="ann-badge">{activeSugg.length} suggestions</span>}
                </div>
                {/* Note metadata chips — shown when at least one field is set */}
                {(note.subject || note.professor || note.goal) && (
                  <div className="note-meta-chips">
                    {note.subject   && <span className="note-meta-chip"><span className="note-meta-chip-icon">📚</span>{note.subject}</span>}
                    {note.professor && <span className="note-meta-chip"><span className="note-meta-chip-icon">👤</span>{note.professor}</span>}
                    {note.goal      && <span className="note-meta-chip"><span className="note-meta-chip-icon">🎯</span>{note.goal}</span>}
                    <button className="note-meta-edit-btn" title="Edit note details" onClick={openEditNoteMeta}>✎ edit</button>
                  </div>
                )}
                {/* Prompt to add metadata if none set yet */}
                {!note.subject && !note.professor && !note.goal && (
                  <div style={{ paddingBottom: 4 }}>
                    <button className="note-meta-edit-btn" style={{ fontSize: 11.5, color: 'var(--ink3)', opacity: .7 }} onClick={openEditNoteMeta}>
                      + add subject &amp; professor for smarter suggestions
                    </button>
                  </div>
                )}
                <div className="divider" />
                <div className={`ta-wrap${dockedCard ? " docked-open" : ""}`}>
                  <NoteEditor
                    key={activeId}
                    ref={editorRef}
                    content={noteHtml}
                    onChange={handleEditorChange}
                    onKeyDown={handleKeyDown}
                  />
                  {/* Weave pill rendered via portal — anchored to the affected text */}
                  {applyingOverlay && createPortal(
                    (() => {
                      const cat = CATS[applyingOverlay.cat] || CATS.expand;
                      const msgs = {
                        fact:     "Correcting passage",
                        clarity:  "Clarifying passage",
                        expand:   "Expanding section",
                        research: "Adding citation",
                        lecture:  "Inserting notes",
                      };
                      return (
                        <div
                          className={`weave-pill${applyingOverlay.exiting ? " exiting" : ""}`}
                          style={{ top: applyingOverlay.top, left: applyingOverlay.left }}
                        >
                          <span className="weave-pill-dot" style={{ background: cat.color }} />
                          <span className="weave-pill-label" style={{ color: cat.color }}>{cat.label}</span>
                          <span className="weave-pill-sep">·</span>
                          <span className="weave-pill-msg">{msgs[applyingOverlay.cat] || "Updating"}</span>
                          <span className="weave-pill-dots" style={{ color: cat.color }}>
                            <span /><span /><span />
                          </span>
                        </div>
                      );
                    })(),
                    document.body
                  )}
                  {/* Result card is now a floating portal — rendered elsewhere */}
                </div>

                {/* Hint bar: loading state while ghost is fetching, or Tab/Esc when ready */}
                {ghostThinking && !ghost && (
                  <div className="ghost-hint">
                    <span className="ghost-hint-txt" style={{ opacity: .5 }}>thinking…</span>
                    <ThinkDots />
                  </div>
                )}
                {ghost && (
                  <div className="ghost-hint">
                    <span className="ghost-hint-txt">"{ghost.text.trim().slice(0, 60)}{ghost.text.length > 60 ? "…" : ""}"</span>
                    <kbd className="kbd">Tab</kbd>
                    <span className="ghost-esc">accept</span>
                    <span style={{ color: "var(--rule2)", fontSize: 10 }}>·</span>
                    <kbd className="kbd">Esc</kbd>
                    <span className="ghost-esc">dismiss</span>
                  </div>
                )}

              </div>

              {/* Annotation column — slides off when card is docked */}
              <div ref={annColRef} className={`ann-col sugg-panel${panelHidden ? " hidden" : ""}`}>
                <div className="ann-col-hdr">
                  {showThinking
                    ? <span className="ann-col-hdr-reading">SunnyD<span className="ann-col-hdr-dots"><span /><span /><span /></span></span>
                    : activeSugg.length > 0
                      ? `${shownSugg.length} suggestion${shownSugg.length !== 1 ? "s" : ""}`
                      : "Suggestions"}
                </div>

                {showThinking && <ReadingState status={statusTxt} />}

                <div
                  ref={panelBodyRef}
                  className="ann-col-body"
                  style={{ minHeight: sortedSugg.length > 0 ? Math.max(sortedSugg.length * MIN_SPACING, ...sortedSugg.map((s, i) => (suggTops[s.id] ?? i * MIN_SPACING) + SUGG_CARD_H)) + 60 : 0 }}
                >
                  {sortedSugg.map((s, index) => (
                    <div
                      key={s.id}
                      style={{
                        position: "absolute",
                        top: suggTops[s.id] ?? index * MIN_SPACING,
                        left: 8,
                        width: "calc(100% - 16px)",
                        transition: "top 0.25s cubic-bezier(.22,1,.36,1)",
                      }}
                    >
                      <AnnCard
                        s={s}
                        onDismiss={dismissSugg}
                        isNew={newSuggIds.current.has(s.id)}
                        onHover={id => setHoveredSuggId(id)}
                        onLeave={() => setHoveredSuggId(null)}
                        onCardClick={handleCardClick}
                      />
                    </div>
                  ))}
                </div>

                {activeSugg.length === 0 && !busy && (
                  <p className="ann-empty">
                    {suggestionsOn ? "SunnyD reads your notes as you write and surfaces insights here." : "Suggestions are off. Turn them on above to get AI suggestions."}
                  </p>
                )}
              </div>

            </div>
          </div>
        </div>

        {/* Selection card */}
        {/* ── Compact selection toolbar ── */}
        {selMenu && (
          <div
            className="sel-toolbar"
            style={{
              left: selMenu.x,
              top: selMenu.below ? selMenu.y : Math.max(8, selMenu.y - 72),
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Row 1 — AI actions */}
            <div className="sel-toolbar-acts">
              {SEL_ACTS.map(({ key, icon, label }, i) => (
                <React.Fragment key={key}>
                  {i > 0 && <div className="sel-toolbar-sep" />}
                  <button className="sel-toolbar-btn" onClick={() => handleSelAction(key)}>
                    <span className="sel-toolbar-btn-ic">{icon}</span>
                    {label}
                  </button>
                </React.Fragment>
              ))}
            </div>

            {/* Divider */}
            <div className="sel-toolbar-sep-h" />

            {/* Row 2 — Text formatting */}
            <div className="sel-toolbar-fmts">
              {[
                { type: 'bold',       content: <strong style={{fontSize:12}}>B</strong>,  title: 'Bold' },
                { type: 'italic',     content: <em    style={{fontSize:12,fontFamily:'Georgia,serif'}}>I</em>, title: 'Italic' },
                null, // separator
                { type: 'h1',         content: <span  style={{fontSize:10,fontWeight:800,letterSpacing:'-.02em'}}>H1</span>, title: 'Heading 1' },
                { type: 'h2',         content: <span  style={{fontSize:10,fontWeight:800,letterSpacing:'-.02em'}}>H2</span>, title: 'Heading 2' },
                null,
                { type: 'bulletList', content: <span  style={{fontSize:14,lineHeight:1}}>≡</span>, title: 'Bullet list' },
                { type: 'code',       content: <span  style={{fontSize:10,fontFamily:'monospace',letterSpacing:'-.02em'}}>&lt;/&gt;</span>, title: 'Code' },
              ].map((item, idx) =>
                item === null
                  ? <div key={`fsep-${idx}`} className="sel-toolbar-fmt-sep" />
                  : (
                    <button
                      key={item.type}
                      className={`sel-toolbar-fmt-btn${selMenu.fmt?.[item.type] ? ' fmt-active' : ''}`}
                      title={item.title}
                      onMouseDown={e => e.preventDefault()} // keep editor selection alive
                      onClick={() => {
                        editorRef.current?.applyFormat(item.type);
                        setSelMenu(p => p ? { ...p, fmt: { ...p.fmt, [item.type]: !p.fmt?.[item.type] } } : p);
                      }}
                    >
                      {item.content}
                    </button>
                  )
              )}
            </div>
          </div>
        )}

        {/* ── Thinking pill while AI processes ── */}
        {selThinking && (
          <div
            className="sel-thinking-pill"
            style={{
              left: selThinking.x,
              top: selThinking.below ? selThinking.y : Math.max(8, selThinking.y - 40),
            }}
          >
            <span style={{ fontSize: 13 }}>◌</span>
            {{ summarize: "Summarizing…", expand: "Expanding…", explain: "Explaining…" }[selThinking.action]}
          </div>
        )}

        {/* ── Floating result preview card ── */}
        {selRes && (() => {
          const cardW = 420;
          const vpW = window.innerWidth;
          const vpH = window.innerHeight;
          // Anchor card below the thinking pill / toolbar position
          let cardLeft = Math.min(Math.max(8, selRes.x - cardW / 2), vpW - cardW - 8);
          const toolbarBottom = selRes.below ? selRes.y + 40 : selRes.y + 6;
          let cardTop = toolbarBottom + 10;
          if (cardTop + 320 > vpH) cardTop = Math.max(8, selRes.y - 340);
          return (
            <div
              className="sel-result-card"
              style={{ left: cardLeft, top: cardTop }}
              onClick={e => e.stopPropagation()}
            >
              <div className="sel-result-hdr">
                <span className="sel-result-badge">
                  {{ summarize: "◈ Summarize", expand: "⊕ Expand", explain: "◉ Explain" }[selRes.action]}
                </span>
                <span className={`sel-result-op ${selRes.op === "replace" ? "replace" : "add"}`}>
                  {selRes.op === "replace" ? "replaces" : "adds after"}
                </span>
                <span className="sel-result-orig">"{selRes.original.slice(0, 55)}{selRes.original.length > 55 ? "…" : ""}"</span>
                <button className="sel-result-close" onClick={() => setSelRes(null)}>×</button>
              </div>
              {selRes.isError ? (
                <div className="sel-result-body" style={{ color: "var(--red)", fontStyle: "italic" }}>{selRes.explanation}</div>
              ) : (
                <>
                  <div className="sel-result-body" dangerouslySetInnerHTML={{ __html: mdToHtml(selRes.text) }} />
                  {selRes.explanation && <div className="sel-result-expl">{selRes.explanation}</div>}
                </>
              )}
              <div className="sel-result-btns">
                {!selRes.isError && <button className="btn-fill" style={{ flex: 1 }} onClick={weaveSelResult}>✓ Apply</button>}
                <button className="btn-out" onClick={() => setSelRes(null)}>Dismiss</button>
              </div>
            </div>
          );
        })()}

        {podcastOpen && createPortal(
          <div className={podcastMinimized ? "podcast-shell podcast-shell--minimized" : "podcast-shell"}>
            <div
              className={`note-setup-overlay${podcastMinimized ? " podcast-overlay--ghost" : ""}`}
              onClick={podcastMinimized ? undefined : handlePodcastBackdropClick}
            >
              <div
                className="note-setup-modal podcast-modal"
                onClick={e => {
                  if (!podcastMinimized) e.stopPropagation();
                }}
                style={
                  podcastMinimized
                    ? {
                        position: "absolute",
                        left: -9999,
                        top: 0,
                        width: 440,
                        maxWidth: "100vw",
                        opacity: 0,
                        pointerEvents: "none",
                        overflow: "hidden",
                      }
                    : undefined
                }
              >
                {!podcastMinimized && (
                  <div className="note-setup-hdr sunnyd-cast-hdr">
                    <div className="note-setup-hdr-top">
                      <span className="note-setup-icon">☀️</span>
                      <span className="note-setup-title">SunnyD Cast</span>
                      {podcastPhase === "ready" && (
                        <button
                          type="button"
                          className="podcast-minimize-top-btn"
                          onClick={dockPodcastMinimized}
                          aria-label="Minimize and keep playing over notes"
                          title="Minimize over notes"
                        >
                          ◱
                        </button>
                      )}
                      <button type="button" className="x-btn" style={{ marginLeft: "auto" }} onClick={closePodcastModal} aria-label="Close">
                        ×
                      </button>
                    </div>
                    <span className="sunnyd-cast-badge">Study replay</span>
                    <p className="note-setup-sub">
                      SunnyD turns your notes (and lecture transcript, if you have one) into a short two-host podcast so you can relearn. Dee and Ray are the voices.
                    </p>
                  </div>
                )}
                <div className="note-setup-body" style={{ paddingTop: podcastMinimized ? 0 : 12 }}>
                {!podcastMinimized && (
                  <>
                    <div className="podcast-disclosure">
                      SunnyD builds a script from your notes, then Dee and Ray read it. The finished audio is rendered here so you can replay and relearn.
                    </div>

                    <div className="podcast-length-row">
                      <span className="podcast-length-label" id="podcast-length-label">
                        Episode length (about)
                      </span>
                      <input
                        type="range"
                        className="podcast-length-slider"
                        min={2}
                        max={10}
                        step={1}
                        value={clampPodcastMinutes(podcastMaxMinutes)}
                        onChange={e => setPodcastMaxMinutes(clampPodcastMinutes(Number(e.target.value)))}
                        disabled={podcastPhase === "script" || podcastPhase === "tts"}
                        aria-labelledby="podcast-length-label"
                        aria-valuetext={`${clampPodcastMinutes(podcastMaxMinutes)} minutes max`}
                      />
                      <span className="podcast-length-val">{clampPodcastMinutes(podcastMaxMinutes)} min</span>
                    </div>
                    <p className="podcast-length-hint">Targets spoken time for the next generate or regenerate.</p>
                  </>
                )}

                {(podcastPhase === "script" || podcastPhase === "tts") && (
                  <div className="pop-thinking" style={{ marginTop: 0 }}>
                    <div className="pop-thinking-dots">
                      <span /><span /><span />
                    </div>
                    <span className="pop-thinking-txt">{podcastMsg || "Working…"}</span>
                  </div>
                )}
                {podcastPhase === "tts" && podcastTtsProg.total > 0 && (
                  <div className="podcast-progress-bar">
                    <div
                      className="podcast-progress-fill"
                      style={{ width: `${Math.min(100, (podcastTtsProg.cur / podcastTtsProg.total) * 100)}%` }}
                    />
                  </div>
                )}

                {podcastPhase === "error" && podcastErr && <div className="podcast-err">{podcastErr}</div>}

                {!podcastMinimized && (podcastPhase === "ready" || (podcastPhase === "error" && podcastTurns.length > 0)) && podcastTitle && (
                  <p className="podcast-progress" style={{ marginBottom: 6 }}>
                    {podcastTitle}
                    {podcastPhase === "ready" && podcastVoiceKind === "openai" && (
                      <span style={{ display: "block", fontSize: 10, fontWeight: 600, color: "#A85F00", marginTop: 4, letterSpacing: "0.06em" }}>
                        SUNNYD CAST · HIGH QUALITY
                      </span>
                    )}
                    {podcastPhase === "ready" && podcastVoiceKind === "kokoro" && (
                      <span style={{ display: "block", fontSize: 10, fontWeight: 600, color: "#5E38A0", marginTop: 4, letterSpacing: "0.06em" }}>
                        SUNNYD CAST · ON THIS DEVICE
                      </span>
                    )}
                  </p>
                )}
                {!podcastMinimized && podcastPhase === "ready" && podcastMsg && (
                  <p style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.5, margin: "0 0 8px" }}>{podcastMsg}</p>
                )}

                {!podcastMinimized && podcastTurns.length > 0 && (podcastPhase === "ready" || podcastPhase === "error") && (
                  <div className="podcast-speakers">
                    {(() => {
                      const deeName = podcastTurns.find(t => t.id === "host_a")?.displayName || "Dee";
                      const rayName = podcastTurns.find(t => t.id === "host_b")?.displayName || "Ray";
                      const useFileAnalyser = !!(podcastAudioUrl && !podcastBrowserMode && podcastPhase === "ready");
                      return (
                        <>
                          <PodcastWavePanel
                            label={deeName}
                            variant="dee"
                            isActive={podcastActiveSpeaker === "host_a"}
                            analyserRef={podcastAnalyserRef}
                            audioRef={podcastAudioRef}
                            useAnalyserPath={useFileAnalyser}
                            simulateActive={podcastSpeaking && podcastActiveSpeaker === "host_a"}
                          />
                          <PodcastWavePanel
                            label={rayName}
                            variant="ray"
                            isActive={podcastActiveSpeaker === "host_b"}
                            analyserRef={podcastAnalyserRef}
                            audioRef={podcastAudioRef}
                            useAnalyserPath={useFileAnalyser}
                            simulateActive={podcastSpeaking && podcastActiveSpeaker === "host_b"}
                          />
                        </>
                      );
                    })()}
                  </div>
                )}

                {podcastPhase === "ready" && podcastAudioUrl && (
                  <audio
                    ref={podcastAudioRef}
                    key={podcastAudioUrl}
                    className="podcast-audio"
                    controls={!podcastMinimized}
                    src={podcastAudioUrl}
                    preload="metadata"
                    onLoadedMetadata={syncPodcastSpeakerFromAudio}
                    onSeeked={syncPodcastSpeakerFromAudio}
                    onEnded={() => {
                      lastPodcastSpeakerRef.current = null;
                      setPodcastActiveSpeaker(null);
                    }}
                  />
                )}

                {!podcastMinimized && podcastPhase === "ready" && podcastQuestionOpen && (
                  <PodcastQuestionPanel
                    questionText={podcastQuestionText}
                    setQuestionText={setPodcastQuestionText}
                    answer={podcastQuestionAnswer}
                    busy={podcastQuestionBusy}
                    onSubmit={submitPodcastQuestion}
                    onCloseResume={closePodcastQuestionResume}
                    noApiKey={!apiKey?.trim()}
                  />
                )}

                {!podcastMinimized && podcastPhase === "ready" && (
                  <div className="podcast-actions">
                    <button type="button" className="lecture-panel-btn podcast-q-open-btn" onClick={openPodcastQuestion} disabled={podcastQuestionBusy}>
                      ? Ask about this moment
                    </button>
                    {podcastTurns.length > 0 && (!podcastAudioUrl || podcastBrowserMode) && (
                      <>
                        <button
                          type="button"
                          className="note-setup-go"
                          style={{ boxShadow: "none" }}
                          disabled={podcastSpeaking}
                          onClick={playPodcastWebSpeech}
                        >
                          {podcastSpeaking ? "Playing…" : "▶ Play (speaker)"}
                        </button>
                        {podcastSpeaking && (
                          <button type="button" className="note-setup-skip" onClick={stopPodcastWebSpeech}>
                            Stop
                          </button>
                        )}
                      </>
                    )}
                    {podcastAudioUrl && (
                      <button
                        type="button"
                        className="lecture-panel-btn"
                        onClick={() => {
                          const safe = ("sunnyd-cast-" + (podcastTitle || "episode")).replace(/[^\w\s-]+/g, "").replace(/\s+/g, "-").slice(0, 72) || "sunnyd-cast-episode";
                          const a = document.createElement("a");
                          a.href = podcastAudioUrl;
                          a.download = `${safe}.wav`;
                          a.rel = "noopener";
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                        }}
                      >
                        ⬇ Download episode
                      </button>
                    )}
                  </div>
                )}

                {!podcastMinimized && (
                <div className="note-setup-footer" style={{ marginTop: 6, flexWrap: "wrap", justifyContent: "space-between" }}>
                  <button type="button" className="note-setup-skip" onClick={closePodcastModal}>
                    Close
                  </button>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {podcastPhase === "ready" && (
                      <button type="button" className="lecture-panel-btn" onClick={dockPodcastMinimized}>
                        Minimize · keep playing
                      </button>
                    )}
                    {(podcastPhase === "idle" || podcastPhase === "error" || podcastPhase === "ready") && podcastPhase !== "script" && podcastPhase !== "tts" && (
                      <button
                        type="button"
                        className="note-setup-go"
                        disabled={podcastPhase === "script" || podcastPhase === "tts"}
                        onClick={() => runStudyPodcast()}
                      >
                        {podcastPhase === "ready" ? "Regenerate" : "Generate SunnyD Cast"}
                      </button>
                    )}
                    {podcastPhase === "ready" && (
                      <button type="button" className="lecture-panel-btn" onClick={resetPodcastSession}>
                        New episode
                      </button>
                    )}
                  </div>
                </div>
                )}
              </div>
            </div>
          </div>
        </div>,
          document.body
        )}

        {podcastOpen && podcastMinimized && podcastPhase === "ready" &&
          createPortal(
            (() => {
              const deeName = podcastTurns.find(t => t.id === "host_a")?.displayName || "Dee";
              const rayName = podcastTurns.find(t => t.id === "host_b")?.displayName || "Ray";
              const useFileAnalyser = !!(podcastAudioUrl && !podcastBrowserMode);
              const waveBase = {
                analyserRef: podcastAnalyserRef,
                audioRef: podcastAudioRef,
                useAnalyserPath: useFileAnalyser,
              };
              return (
                <PodcastFloatingDock
                  position={podcastFloatPos}
                  setPosition={setPodcastFloatPos}
                  title={podcastTitle}
                  wavePropsDee={{
                    variant: "dee",
                    label: deeName,
                    ...waveBase,
                    isActive: podcastActiveSpeaker === "host_a",
                    simulateActive: podcastSpeaking && podcastActiveSpeaker === "host_a",
                  }}
                  wavePropsRay={{
                    variant: "ray",
                    label: rayName,
                    ...waveBase,
                    isActive: podcastActiveSpeaker === "host_b",
                    simulateActive: podcastSpeaking && podcastActiveSpeaker === "host_b",
                  }}
                  audioRef={podcastAudioRef}
                  hasFileAudio={!!podcastAudioUrl && !podcastBrowserMode}
                  webSpeech={
                    podcastBrowserMode && podcastTurns.length > 0
                      ? { speaking: podcastSpeaking, onPlay: playPodcastWebSpeech, onStop: stopPodcastWebSpeech }
                      : null
                  }
                  onExpand={expandPodcastFromDock}
                  onClose={closePodcastModal}
                  onQuestion={openPodcastQuestion}
                  questionOpen={podcastQuestionOpen}
                  questionText={podcastQuestionText}
                  setQuestionText={setPodcastQuestionText}
                  questionAnswer={podcastQuestionAnswer}
                  questionBusy={podcastQuestionBusy}
                  onQuestionSubmit={submitPodcastQuestion}
                  onQuestionCloseResume={closePodcastQuestionResume}
                  noApiKey={!apiKey?.trim()}
                />
              );
            })(),
            document.body
          )}

        {/* ── Note setup modal (new note or edit metadata) ── */}
        {noteSetupModal && createPortal(
          <div className="note-setup-overlay" onClick={() => confirmNoteSetup(true)}>
            <div className="note-setup-modal" onClick={e => e.stopPropagation()}>
              <div className="note-setup-hdr">
                <div className="note-setup-hdr-top">
                  <span className="note-setup-icon">📚</span>
                  <span className="note-setup-title">
                    {noteSetupModal.pendingId !== null ? "Set up your note" : "Edit note details"}
                  </span>
                </div>
                <p className="note-setup-sub">
                  {noteSetupModal.pendingId !== null
                    ? "SunnyD will personalise suggestions, Q&A answers, and more — all fields are optional."
                    : "Update your note details to keep SunnyD's suggestions accurate."}
                </p>
              </div>
              <div className="note-setup-body">
                <div className="note-setup-field">
                  <label className="note-setup-label">Subject / Course</label>
                  <input
                    className="note-setup-input"
                    placeholder="e.g. Biology 101, ECON 202…"
                    value={noteSetupModal.subject}
                    onChange={e => setNoteSetupModal(p => ({ ...p, subject: e.target.value }))}
                    autoFocus
                    onKeyDown={e => e.key === "Enter" && confirmNoteSetup()}
                  />
                </div>
                <div className="note-setup-field">
                  <label className="note-setup-label">Professor / Instructor</label>
                  <input
                    className="note-setup-input"
                    placeholder="e.g. Professor Smith, Dr. Patel…"
                    value={noteSetupModal.professor}
                    onChange={e => setNoteSetupModal(p => ({ ...p, professor: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && confirmNoteSetup()}
                  />
                </div>
                <div className="note-setup-field">
                  <label className="note-setup-label">Your goal for these notes</label>
                  <input
                    className="note-setup-input"
                    placeholder="e.g. Midterm prep, final project, just following along…"
                    value={noteSetupModal.goal}
                    onChange={e => setNoteSetupModal(p => ({ ...p, goal: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && confirmNoteSetup()}
                  />
                </div>
              </div>
              <div className="note-setup-footer">
                <button className="note-setup-skip" onClick={() => confirmNoteSetup(true)}>
                  Skip →
                </button>
                <button className="note-setup-go" onClick={() => confirmNoteSetup(false)}>
                  {noteSetupModal.pendingId !== null ? "Let's go →" : "Save"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Annotation popover — questions only (fact-checks are in right panel) */}
        {/* Floating docked card */}
        {dockedCard?.suggestion && (
          <div
            className="docked-card"
            style={{ position: "fixed", top: dockedCard.top, left: dockedCard.left, zIndex: 9999 }}
            onClick={e => e.stopPropagation()}
          >
            {(() => {
              const s = dockedCard.suggestion;
              const cat = CATS[s.cat] || CATS.expand;
              return (
                <>
                  <div className="dc-header">
                    <span className="dc-dot" style={{ background: cat.color }} />
                    <span className="dc-type" style={{ color: cat.color }}>{cat.label}</span>
                    <button className="dc-close" onClick={closeDocked}>×</button>
                  </div>
                  <div className="dc-body">{parseWithLinks(s.detail, `dc-${s.id}`)}</div>
                  {s.cat === "research" && s.articles?.length > 0 && (
                    <div className="dc-articles">
                      {s.articles.slice(0, 3).map((a, i) => (
                        <a key={i} className="dc-art-link" href={a.url} target="_blank" rel="noopener noreferrer">
                          <span className="dc-art-src">{a.source || "Source"}</span>
                          <span className="dc-art-title">{a.title || a.url}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="dc-btns">
                    <button className="dc-apply" onClick={() => { applySuggestion(s); closeDocked(); }}>
                      ✓ Apply
                    </button>
                    <button className="dc-decline" onClick={() => { dismissSugg(s.id); closeDocked(); }}>
                      ✕ Decline
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {searchOpen && (
        <SearchPalette
          notes={notes}
          onSelectNote={id => { setActiveId(id); setGhost(null); setGhostThinking(false); setHoveredSuggId(null); setDockedCard(null); setPanelHidden(false); }}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </>
  );
}
