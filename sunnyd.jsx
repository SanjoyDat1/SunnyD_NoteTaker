import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";

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

/* ─── Seed ───────────────────────────────────────────────────────────────── */
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

/* ─── ThinkingCard (skeleton while AI works) ─────────────────────────────── */
function ThinkingCard({ delay = 0 }) {
  return (
    <div className="ann-card ann-thinking" style={{ animationDelay: `${delay}ms` }}>
      <div className="ann-card-inner">
        <div className="ann-tag">
          <span className="ann-tag-dot" style={{ background: "var(--rule2)" }} />
          <ThinkDots />
        </div>
        <div className="ann-thinking-skel">
          <div className="ann-skel" style={{ width: "78%" }} />
          <div className="ann-skel" style={{ width: "54%", marginTop: 7 }} />
        </div>
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
.key-screen{display:flex;align-items:center;justify-content:center;height:100vh;background:var(--paper);padding:24px;}
.key-card{width:100%;max-width:400px;background:var(--page);border-radius:4px;border:1px solid var(--rule2);box-shadow:0 4px 24px var(--sh);padding:40px;}
.key-mark{width:34px;height:34px;background:var(--ink);color:var(--paper);border-radius:4px;display:flex;align-items:center;justify-content:center;font-family:'DM Sans',sans-serif;font-weight:700;font-size:14px;margin-bottom:20px;}
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
.hdr-sep{width:1px;height:14px;background:var(--rule2);opacity:.6;}
.hdr-wc{font-size:11px;color:var(--ink3);opacity:.6;}
.btn-link{font-size:11px;color:var(--ink3);background:none;border:none;cursor:pointer;padding:3px 7px;border-radius:4px;transition:background .15s;}
.btn-link:hover{background:var(--paper);color:var(--ink2);}

/* ── Lecture toggle & transcript ── */
.lecture-btn{display:flex;align-items:center;gap:6px;padding:5px 12px;border-radius:6px;border:1px solid var(--rule);background:var(--page);font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;color:var(--ink2);cursor:pointer;transition:all .2s;}
.lecture-btn:hover{border-color:var(--rule2);color:var(--ink);background:var(--paper);}
.lecture-btn.on{background:var(--ink);color:var(--paper);border-color:var(--ink);}
.lecture-btn.on:hover{opacity:.9;}
.lecture-btn-ic{font-size:8px;opacity:.9;}
.lecture-btn.on .lecture-btn-ic{color:#7DD4A0;}
.lecture-panel{background:linear-gradient(180deg,var(--paper) 0%,#F5F0E8 100%);border-bottom:1px solid var(--rule);padding:12px 18px;animation:lectureSlideIn .3s cubic-bezier(.22,1,.36,1);}
@keyframes lectureSlideIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
.lecture-panel-hdr{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;flex-wrap:wrap;}
.lecture-panel-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--ink3);}
.lecture-panel-actions{display:flex;gap:6px;}
.lecture-panel-btn{padding:4px 10px;border-radius:5px;border:1px solid var(--rule);background:var(--page);font-family:'DM Sans',sans-serif;font-size:10px;font-weight:600;color:var(--ink2);cursor:pointer;transition:all .15s;}
.lecture-panel-btn:hover{background:var(--paper);border-color:var(--rule2);color:var(--ink);}
.lecture-transcript{max-height:52px;overflow:hidden;transition:max-height .3s cubic-bezier(.22,1,.36,1);}
.lecture-transcript.expanded{max-height:300px;overflow-y:auto;}
.lecture-text{font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.7;color:var(--ink);margin:0;word-break:break-word;}
.lecture-interim{color:var(--ink3);opacity:.8;}
.lecture-placeholder{font-size:13px;color:var(--ink3);font-style:italic;margin:0;}
.lecture-q-count{font-size:10px;font-weight:600;color:#5E38A0;margin-top:7px;letter-spacing:.01em;}

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
.lecture-q-card{position:fixed;z-index:10000;width:340px;background:var(--page);border:1px solid var(--rule2);border-radius:12px;box-shadow:0 12px 40px rgba(50,35,15,.15),0 4px 12px rgba(50,35,15,.07);overflow:hidden;animation:cardRise .2s cubic-bezier(.22,1,.36,1);}
.lecture-q-card-hdr{padding:11px 16px;background:linear-gradient(180deg,var(--paper) 0%,rgba(248,244,237,.7) 100%);border-bottom:1px solid var(--rule);display:flex;align-items:center;justify-content:space-between;}
.lecture-q-badge{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#5E38A0;}
.lecture-q-question{font-family:'DM Sans',sans-serif;font-size:13px;color:var(--ink);font-weight:500;padding:14px 16px 0;line-height:1.55;font-style:italic;}
.lecture-q-answer{font-family:'DM Sans',sans-serif;font-size:13.5px;line-height:1.72;color:var(--ink2);padding:10px 16px 16px;font-weight:400;}
.lecture-q-loading{display:flex;align-items:center;gap:8px;padding:16px;color:var(--ink3);font-size:12px;font-weight:500;}
.lecture-q-btns{padding:11px 16px;background:var(--paper);border-top:1px solid var(--rule);display:flex;gap:8px;align-items:center;}
.lecture-q-refresh-btn{margin-left:auto;width:28px;height:28px;border-radius:50%;border:1px solid var(--rule2);background:var(--page);color:var(--ink3);font-size:15px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s,border-color .15s,transform .2s;line-height:1;}
.lecture-q-refresh-btn:hover{background:var(--paper);border-color:var(--ink3);color:var(--ink);transform:rotate(45deg);}

/* ── Layout ── */
.layout{display:flex;flex:1;overflow:hidden;}

/* ── Notes sidebar ── */
.notes-sb{width:170px;flex-shrink:0;background:var(--paper);border-right:1px solid var(--rule);display:flex;flex-direction:column;padding:11px 8px;overflow-y:auto;}
.new-btn{width:100%;padding:8px 10px;margin-bottom:9px;background:var(--ink);color:var(--paper);border:none;border-radius:5px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;cursor:pointer;transition:opacity .18s;}
.new-btn:hover{opacity:.78;}
.note-row{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:5px;cursor:pointer;transition:background .12s;margin-bottom:1px;}
.note-row:hover{background:rgba(50,35,15,.05);}
.note-row.on{background:rgba(50,35,15,.09);}
.nr-pip{width:3px;height:3px;border-radius:50%;background:var(--ink3);flex-shrink:0;opacity:.4;}
.note-row.on .nr-pip{opacity:1;background:var(--ink);}
.nr-lbl{font-size:12px;color:var(--ink2);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.note-row.on .nr-lbl{color:var(--ink);font-weight:600;}
.sb-footer{margin-top:auto;padding-top:14px;border-top:1px solid var(--rule);}
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
.hl-layer{position:absolute;inset:0;font-family:'DM Sans',sans-serif;font-size:16px;line-height:1.85;white-space:pre-wrap;word-break:break-word;color:var(--ink);pointer-events:none;overflow:hidden;z-index:2;}
.hl-layer.has-sel-preview{pointer-events:auto;z-index:2;overflow:visible;}
.hf{text-decoration:underline;text-decoration-style:wavy;text-decoration-color:rgba(160,105,30,.5);text-decoration-thickness:1.5px;text-underline-offset:3px;background:rgba(210,160,60,.1);border-radius:2px;}
.hf.fresh{animation:annFresh .6s ease forwards;}
@keyframes annFresh{0%{background:rgba(210,160,60,.32)}100%{background:rgba(210,160,60,.1)}}
.hq{background:rgba(90,105,160,.09);border-bottom:1.5px solid rgba(70,88,150,.28);border-radius:2px 2px 0 0;}
.hq.fresh{animation:annFreshQ .6s ease forwards;}
@keyframes annFreshQ{0%{background:rgba(90,105,160,.26)}100%{background:rgba(90,105,160,.09)}}
.ta{position:relative;z-index:1;display:block;width:100%;min-height:460px;background:transparent;color:transparent;caret-color:var(--ink);font-family:'DM Sans',sans-serif;font-size:16px;line-height:1.85;padding:0;border:none;outline:none;resize:none;word-break:break-word;}
.ta:read-only{cursor:default;}
.ta::placeholder{color:#C8C0B4;}
.hl-link{color:#0A6868;text-decoration:underline;text-underline-offset:2px;pointer-events:auto;cursor:pointer;}
.hl-link:hover{color:#085555;}
.ghost-inline{color:rgba(155,148,138,0.75);animation:ghostFadeIn .35s ease forwards;}
@keyframes ghostFadeIn{from{opacity:0}to{opacity:1}}
.ghost-thinking-inline{color:var(--ink3);margin-left:3px;}

/* ── Ghost hint bar (Tab/Esc hint shown when ghost is active) ── */
.ghost-hint{display:flex;align-items:center;gap:7px;margin-top:8px;padding:6px 12px;background:var(--paper);border:1px solid var(--rule);border-radius:5px;opacity:0;animation:fadeSoft .2s ease forwards;}
.ghost-hint-txt{font-size:10.5px;color:var(--ink3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.kbd{padding:2px 7px;background:var(--page);border:1px solid var(--rule2);border-radius:4px;font-size:10px;font-weight:600;color:var(--ink2);}
.ghost-esc{font-size:10px;color:#C0B8AE;}

/* ── Annotation column ── */
.ann-col{width:260px;flex-shrink:0;min-height:0;padding:24px 14px 80px 14px;background:var(--paper);border-left:1px solid rgba(215,205,188,.55);overflow-y:auto;}
.ann-col-hdr{font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:.18em;color:var(--ink3);opacity:.4;margin-bottom:10px;padding:0;}
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
.ann-thinking{opacity:0;animation:annEnter .5s ease forwards;height:auto;min-height:44px;}
.ann-thinking .ann-card-inner{height:auto;padding:12px 14px;align-items:flex-start;}
.ann-thinking-skel{margin-left:auto;}
.ann-enter{opacity:0;animation:annEnter .55s cubic-bezier(.22,1,.36,1) forwards;}
@keyframes annEnter{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:translateX(0)}}

/* Weave overlay — blur text behind, cream tint, typing animation */
.weave-overlay{position:absolute;z-index:10;display:flex;align-items:flex-start;padding:10px 14px;background:rgba(248,244,237,.22);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(215,205,188,.5);border-radius:10px;pointer-events:auto;animation:weaveIn .5s cubic-bezier(.22,1,.36,1) forwards;box-shadow:0 2px 12px rgba(50,35,15,.06);overflow-y:auto;max-height:200px;}
.weave-overlay .weave-typing{font-family:'DM Sans',sans-serif;font-size:16px;line-height:1.85;color:var(--ink);white-space:pre-wrap;word-break:break-word;}
.weave-overlay .weave-cursor{display:inline-block;width:2px;height:1.05em;background:var(--ink);margin-left:1px;vertical-align:text-bottom;animation:weaveCursor 1s step-end infinite;}
@keyframes weaveIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
@keyframes weaveCursor{0%,50%{opacity:1}51%,100%{opacity:0}}

/* Suggestion textRef highlight in editor */
.hs{border-radius:2px;transition:background .2s ease,box-shadow .2s ease;animation:hsIn .3s ease forwards;}
@keyframes hsIn{from{opacity:.3}to{opacity:1}}

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

/* ── Selection card ── */
.sel-card{position:fixed;z-index:9999;transform:translateX(-50%);background:var(--page);border:1px solid var(--rule2);border-radius:12px;box-shadow:0 12px 40px rgba(50,35,15,.14),0 4px 12px rgba(50,35,15,.06);padding:6px;animation:cardRise .2s cubic-bezier(.22,1,.36,1);min-width:260px;}
@keyframes cardRise{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.sel-hd{padding:8px 12px 8px;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:var(--ink3);border-bottom:1px solid var(--rule);margin-bottom:2px;opacity:.9;}
.sel-act{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;border-radius:8px;background:none;border:none;cursor:pointer;text-align:left;font-family:'DM Sans',sans-serif;transition:all .15s;}
.sel-act:hover{background:linear-gradient(135deg,var(--paper) 0%,rgba(248,244,237,.8) 100%);}
.sel-act-ic{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,var(--paper) 0%,#EDE7DC 100%);border:1px solid var(--rule);display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--ink2);flex-shrink:0;}
.sel-act:hover .sel-act-ic{background:linear-gradient(135deg,#EDE7DC 0%,#E5DDD4 100%);border-color:var(--rule2);}
.sel-act-lbl{font-size:13px;font-weight:600;color:var(--ink);line-height:1.25;}
.sel-act-desc{font-size:11px;color:var(--ink3);line-height:1.35;margin-top:1px;}

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
        <div className="key-mark">S</div>
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
  const [notes,       setNotes]       = useState(SEED);
  const [activeId,    setActiveId]    = useState(1);
  const [suggestions, setSugg]        = useState([]);
  const [shownSuggIds,   setShownSuggIds]   = useState(new Set());
  const [hoveredSuggId,  setHoveredSuggId]  = useState(null);
  const [dockedCard,     setDockedCard]     = useState(null);
  const [panelHidden,    setPanelHidden]    = useState(false);
  const [ghost,       setGhost]       = useState(null);
  const [ghostThinking, setGhostThinking] = useState(false);
  const [selMenu,     setSelMenu]     = useState(null);
  const [selRes,      setSelRes]      = useState(null);
  const [busy,        setBusy]        = useState(false);
  const [statusTxt,   setStatus]      = useState("");
  const [copied,      setCopied]      = useState(false);
  const [weaveRect,   setWeaveRect]   = useState(null);
  const [suggFreq,    setSuggFreq]    = useState(() => { try { return sessionStorage.getItem("sd_suggFreq") || "balanced"; } catch { return "balanced"; } });
  const [lectureOn,   setLectureOn]   = useState(false);
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [lectureQs,   setLectureQs]   = useState([]); // detected questions in transcript
  const [activeLectureQ, setActiveLectureQ] = useState(null); // { q, x, y }
  const [lectureQCopied, setLectureQCopied] = useState(false);
  const [lectureQRefreshing, setLectureQRefreshing] = useState(false);

  const { transcript, interimTranscript, finalTranscript, listening, resetTranscript, browserSupportsSpeechRecognition } = useSpeechRecognition({ clearTranscriptOnListen: false });

  const taRef       = useRef(null);
  const hlRef       = useRef(null);
  const docColRef   = useRef(null);
  const taWrapRef   = useRef(null);
  const mainAreaRef = useRef(null);
  const annColRef   = useRef(null);
  const panelBodyRef = useRef(null);
  const [suggTops, setSuggTops] = useState({});
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
  const content    = note.content;
  const setContent = v => setNotes(p => p.map(n => n.id === activeId ? { ...n, content: v } : n));
  const setTitle   = v => setNotes(p => p.map(n => n.id === activeId ? { ...n, title:   v } : n));
  const activeSugg = suggestions.filter(s => s.noteId === activeId && (!s.textRef || content.includes(s.textRef)));
  const applyingSugg = suggestions.find(s => s.applying);

  /* ── Lecture mode: start/stop speech recognition ── */
  useEffect(() => {
    if (!browserSupportsSpeechRecognition) return;
    if (lectureOn) {
      // lang: en-US gives Chrome's cloud STT the best accuracy hint
      SpeechRecognition.startListening({ continuous: true, language: "en-US" });
    } else {
      SpeechRecognition.stopListening();
      setShowFullTranscript(false);
      setLectureQs([]);
      setActiveLectureQ(null);
      scannedTranscriptRef.current = "";
      scannedLectureSuggRef.current = "";
      // Remove lecture suggestions when lecture mode turns off
      setSugg(p => p.filter(s => s.cat !== "lecture"));
    }
    return () => { if (lectureOn) SpeechRecognition.stopListening(); };
  }, [lectureOn, browserSupportsSpeechRecognition]);

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
    // Wait for at least ~40 new words before triggering a scan
    if ((newText.match(/\S+/g) || []).length < 40) return;
    clearTimeout(lectureSuggTimerRef.current);
    lectureSuggTimerRef.current = setTimeout(() => {
      const noteText = notes.find(n => n.id === activeId)?.content || "";
      generateLectureSuggestions(activeId, noteText, finalTranscript);
    }, 3500);
  }, [finalTranscript, lectureOn]);

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
        `You analyze live lecture transcripts to detect genuine spoken questions and generate helpful responses.
Return ONLY valid JSON, no markdown.
Schema: {"questions":[{"text":"exact phrase from transcript","answer":"1-2 sentences the student could say to contribute, grounded in their notes"}]}
If no clear questions exist, return {"questions":[]}`,
        `New transcript segment: "${newText}"

Student's notes for context:
${noteContext.slice(0, 1200)}`,
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
  async function generateLectureSuggestions(noteId, noteText, transcript) {
    if (!transcript.trim() || transcript.length < 80) return;
    // Only scan the new portion since last lecture-sugg scan
    const newTranscriptPart = transcript.slice(scannedLectureSuggRef.current.length).trim();
    if ((newTranscriptPart.match(/\S+/g) || []).length < 40) return;
    scannedLectureSuggRef.current = transcript;

    try {
      const raw = await ai(llmProvider, apiKey,
        `You are SunnyD, an intelligent note-taking assistant. The user is in a lecture. Compare the lecture transcript segment to the user's existing notes and identify SPECIFIC, RELEVANT pieces of information mentioned in the lecture that are MISSING from the notes and worth adding.

Return ONLY a valid JSON array — no markdown, no extra text.
Each item: {"headline":"<5-8 word headline>","preview":"<3-6 word teaser>","detail":"<2-3 sentence justification: why this matters and what specifically was said in the lecture>","apply":"<concise note-ready text to insert, written as a note, not a transcript quote>","textRef":"<exact phrase from the NOTES (10-80 chars) nearest to where this should be inserted, OR null if the content is entirely new with no related section in the notes>"}

CRITICAL — only return suggestions when something GENUINELY important is missing. Do NOT suggest things already covered in the notes. Do NOT suggest trivial or obvious things.
CRITICAL — textRef: use an exact phrase from the notes ONLY when there is a genuinely related passage nearby. If the content is brand-new with no relevant anchor in the notes, set textRef to null — do NOT invent a random anchor.
CRITICAL — apply: write in note style (concise, clear) not transcript style. 2-4 sentences max.
Return [] if nothing important is missing.`,
        `Lecture segment (new content since last scan):\n"${newTranscriptPart.slice(0, 1500)}"\n\nCurrent note content:\n${noteText.slice(0, 1200) || "(empty)"}`,
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
      parts.push(
        <span
          key={q.id}
          className={`lecture-q-hl${q.answer ? " answered" : ""}`}
          title="Click for a suggested response"
          onClick={e => {
            e.stopPropagation();
            setActiveLectureQ(prev => prev?.q.id === q.id ? null : { q, x: e.clientX, y: e.clientY });
          }}
        >
          {q.text}
          <span className="lecture-q-pip">?</span>
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
  const isAppendSugg = s => s?.cat === "lecture" && !s?.textRef;

  function renderHL() {
    // Suggestion highlight on hover or when card is expanded — use fuzzy matching if textRef doesn't match
    const suggToHighlight = hoveredSuggId;
    const hovSugg = suggToHighlight ? activeSugg.find(s => s.id === suggToHighlight) : null;
    const suggRange = (() => {
      if (!hovSugg) return null;
      if (isAppendSugg(hovSugg)) return null; // handled by end-of-note marker
      const range = findSuggestionRange(content, hovSugg);
      if (!range) return null;
      const cat = CATS[hovSugg.cat] || CATS.expand;
      return { id: "shl", ...range, kind: "sugg", cat };
    })();

    // Docked card href highlight — category-colored light tint + solid border
    const dockedSugg = dockedCard?.suggestion;
    const dockedRange = (() => {
      if (!dockedSugg) return null;
      if (isAppendSugg(dockedSugg)) return null; // handled by end-of-note marker
      const r = findSuggestionRange(content, dockedSugg);
      if (!r) return null;
      const cat = CATS[dockedSugg.cat] || CATS.expand;
      return { id: dockedSugg.id, ...r, kind: "ref", cat };
    })();

    const overlaps = (a, b) => a.start < b.end && a.end > b.start;

    // Merge and sort all ranges
    const baseRanges = [];
    if (suggRange && (!dockedRange || !overlaps(suggRange, dockedRange))) baseRanges.push(suggRange);
    if (dockedRange) baseRanges.push(dockedRange);
    const ranges = baseRanges.sort((a, b) => a.start - b.start);

    const sel = selRes;
    const selStart = sel?.start ?? -1;
    const selEnd = sel?.end ?? -1;
    const hasSel = sel && selStart >= 0 && selEnd <= content.length;

    const renderRange = (r) => {
      const addHref = dockedRange && overlaps(r, dockedRange);
      const hrefStyle = dockedRange?.cat ? { background: dockedRange.cat.bg, border: `1px solid ${dockedRange.cat.color}`, borderRadius: "3px" } : {};
      if (r.kind === "ref") return <span key="href" className="href" style={{ whiteSpace: "pre-wrap", ...hrefStyle }}>{content.slice(r.start, r.end)}</span>;
      return (
        <span key="shl" className="hs" style={{ whiteSpace: "pre-wrap", background: r.cat.bg, boxShadow: `0 0 0 1.5px ${r.cat.border}`, borderRadius: "2px" }}>
          {content.slice(r.start, r.end)}
        </span>
      );
    };

    const renderSegment = (segStart, segEnd, excludeSel, keyPrefix) => {
      const segRanges = excludeSel && hasSel ? ranges.filter(r => r.end <= selStart || r.start >= selEnd) : ranges;
      const segRangesFiltered = segRanges.filter(r => r.start < segEnd && r.end > segStart);
      const out = [];
      let p = segStart;
      for (const r of segRangesFiltered.sort((a, b) => a.start - b.start)) {
        if (r.start < p) continue;
        if (r.start > p) out.push(<span key={`${keyPrefix}-${p}`}>{parseWithLinks(content.slice(p, r.start), `${keyPrefix}-${p}`)}</span>);
        out.push(renderRange(r));
        p = r.end;
      }
      if (p < segEnd) out.push(<span key={`${keyPrefix}-${p}`}>{parseWithLinks(content.slice(p, segEnd), `${keyPrefix}-${p}`)}</span>);
      return out;
    };

    if (hasSel) {
      const selText = content.slice(selStart, selEnd);
      const showStrike = sel.op === "replace" || sel.op === "delete";
      const showAdd = !!sel.text;
      return (
        <>
          {renderSegment(0, selStart, true, "pre")}
          {showAdd && sel.op === "add_before" && (
            <span key="add-before" className="sel-inline-add" style={{ whiteSpace: "pre-wrap" }}>{sel.text}{"\n\n"}</span>
          )}
          <span key="sel" className={showStrike ? "sel-strike" : "sel-pending"} style={{ whiteSpace: "pre-wrap" }}>{selText}</span>
          {showAdd && (sel.op === "replace" || sel.op === "add_after" || (sel.op === "delete" && sel.text)) && (
            <span key="add-inline" className="sel-inline-add" style={{ whiteSpace: "pre-wrap" }}>{(sel.op === "add_after" ? "\n\n" : "")}{sel.text}</span>
          )}
          <div key="preview" className="sel-inline-preview" onClick={e => e.stopPropagation()}>
            <div className="sel-preview-hdr">
              <span className="sel-preview-badge">{sel.action === "summarize" ? "Summary" : sel.action === "expand" ? "Expanded" : "Explanation"}</span>
            </div>
            {sel.text && <div className="sel-preview-body">{sel.text}</div>}
            {sel.explanation && sel.text && <div className="sel-preview-hint">{sel.explanation}</div>}
            {sel.explanation && !sel.text && <div className="sel-overview">{sel.explanation}</div>}
            <div className="sel-preview-btns">
              <button className="btn-apply" onClick={e => { e.stopPropagation(); weaveSelResult(); }}>Apply</button>
              <button className="btn-decline" onClick={e => { e.stopPropagation(); setSelRes(null); }}>Decline</button>
            </div>
          </div>
          {renderSegment(selEnd, content.length, true, "post")}
          {ghostThinking && !ghost && <span key="gt" className="ghost-thinking-inline"><span className="think-dots"><span /><span /><span /></span></span>}
          {ghost && <span key="gh" className="ghost-inline">{ghost.text}</span>}
        </>
      );
    }

    const out = [];
    let p = 0;
    for (const r of ranges) {
      if (r.start < p) continue;
      if (r.start > p) out.push(<span key={`t${p}`}>{parseWithLinks(content.slice(p, r.start), `t${p}`)}</span>);
      out.push(renderRange(r));
      p = r.end;
    }
    if (p < content.length) out.push(<span key="tend">{parseWithLinks(content.slice(p), "tend")}</span>);
    if (p === 0 && content.length === 0) out.push(<span key="empty" />);

    // End-of-note append marker for lecture suggestions with no textRef
    const activeAppendSugg = (hovSugg && isAppendSugg(hovSugg)) || (dockedSugg && isAppendSugg(dockedSugg));
    if (activeAppendSugg) {
      out.push(
        <span key="append-marker" id="lecture-append-marker" className="lecture-append-marker">
          <span className="lecture-append-pip">✦</span>
          <span className="lecture-append-label">New content will be added here</span>
        </span>
      );
    }

    // Inline ghost: thinking dots or completion text
    if (ghostThinking && !ghost) {
      out.push(
        <span key="ghost-think" className="ghost-thinking-inline">
          <span className="think-dots"><span /><span /><span /></span>
        </span>
      );
    }
    if (ghost) {
      out.push(<span key="ghost-text" className="ghost-inline">{ghost.text}</span>);
    }

    return out;
  }

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
{"cat":"<category>","headline":"<5-8 word headline>","preview":"<3-6 word teaser — must fit one line, no truncation>","detail":"<2-3 sentence detailed suggestion>","apply":"<replacement/addition text or null>","textRef":"<REQUIRED: exact phrase from the note this applies to>","articles":null}

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
        `Active note:\n\n${text}${crossCtx}`, 1500);

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

  /* ── Resize ── */
  const resize = useCallback(() => {
    const ta = taRef.current;
    if (ta) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }
  }, []);

  /* ── Input ── */
  const handleChange = e => {
    const v = e.target.value;
    const cur = e.target.selectionEnd;
    setContent(v); setGhost(null); setGhostThinking(false); resize();
    clearTimeout(timers.current.t); clearTimeout(timers.current.f);
    clearTimeout(timers.current.s);

    // Only remove suggestions whose textRef is gone (user deleted/replaced that text)
    // Lecture suggestions with no textRef are kept — they anchor to end-of-note
    const removedIds = new Set();
    setSugg(p => {
      const filtered = p.filter(s => {
        if (s.noteId !== activeId) return true;
        if (!s.textRef) return s.cat === "lecture"; // keep lecture suggestions without textRef
        if (!v.includes(s.textRef)) { removedIds.add(s.id); return false; }
        return true;
      });
      return filtered;
    });
    setShownSuggIds(prev => { const n = new Set(prev); removedIds.forEach(id => n.delete(id)); return n; });
    if (dockedCard?.suggestion && removedIds.has(dockedCard.suggestion.id)) {
      setDockedCard(null); setPanelHidden(false);
    }

    // Only clear checked/dismissed for text no longer in content
    checked.current = new Set([...checked.current].filter(t => v.includes(t)));
    dismissed.current.fact = new Set([...dismissed.current.fact].filter(t => v.includes(t)));
    dismissed.current.research = new Set([...dismissed.current.research].filter(t => v.includes(t)));

    const snapId = activeId;
    const snapNotes = notes;
    timers.current.t = setTimeout(() => runGhost(v, cur), 4800);
    if (suggestionsOn) {
      timers.current.f = setTimeout(() => runFactCheck(v), 5500);
      timers.current.s = setTimeout(() => generateSuggestions(snapId, v, snapNotes), 7000);
    }
  };

  const handleKeyDown = e => {
    if (e.key === "Tab" && ghost) {
      e.preventDefault();
      const pos = ghost.pos;
      const accepted = content.slice(0, pos) + ghost.text + content.slice(pos);
      const newPos = pos + ghost.text.length;
      setContent(accepted);
      setGhost(null);
      clearTimeout(timers.current.t); clearTimeout(timers.current.f);
      clearTimeout(timers.current.s);
      const removedIds = new Set();
      setSugg(p => p.filter(s => {
        if (s.noteId !== activeId) return true;
        if (!s.textRef) return s.cat === "lecture"; // keep lecture suggestions without textRef
        if (!accepted.includes(s.textRef)) { removedIds.add(s.id); return false; }
        return true;
      }));
      setShownSuggIds(prev => { const n = new Set(prev); removedIds.forEach(id => n.delete(id)); return n; });
      if (dockedCard?.suggestion && removedIds.has(dockedCard.suggestion.id)) { setDockedCard(null); setPanelHidden(false); }
      checked.current = new Set([...checked.current].filter(t => accepted.includes(t)));
      dismissed.current.fact = new Set([...dismissed.current.fact].filter(t => accepted.includes(t)));
      dismissed.current.research = new Set([...dismissed.current.research].filter(t => accepted.includes(t)));
      if (suggestionsOn) {
        timers.current.f = setTimeout(() => runFactCheck(accepted), 5500);
        timers.current.s = setTimeout(() => generateSuggestions(activeId, accepted, notes), 7000);
      }
      setTimeout(() => { if (taRef.current) { taRef.current.selectionStart = taRef.current.selectionEnd = newPos; } resize(); }, 0);
    } else if (e.key === "Escape" && ghost) {
      e.preventDefault();
      setGhost(null);
    }
    // Note: regular typing clears ghost via handleChange
  };

  const syncScroll = () => { if (hlRef.current && taRef.current) hlRef.current.scrollTop = taRef.current.scrollTop; };

  /* ── Selection — reads from textarea, not window.getSelection() ── */
  const handleMouseUp = e => {
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    setTimeout(() => {
      const ta = taRef.current;
      if (!ta) { setSelMenu(null); return; }
      const { selectionStart: start, selectionEnd: end } = ta;
      if (start === end) { setSelMenu(null); return; }
      const text = ta.value.slice(start, end).trim();
      if (text.length < 10) { setSelMenu(null); return; }
      setSelMenu({ text, start, end, x: mouseX, y: mouseY - 10 });
    }, 25);
  };

  const handleSelAction = async action => {
    if (!selMenu) return;
    busyWithSelAction.current = true;
    clearTimeout(timers.current.s);
    clearTimeout(timers.current.f);
    const { text: t, start, end } = selMenu;
    const fullContext = content;
    const noteTitle = note?.title || "Untitled";
    const ctxBefore = content.slice(Math.max(0, start - 220), start);
    const ctxAfter = content.slice(end, Math.min(content.length, end + 220));
    const isStartOfSentence = /(^|[.!?\n]\s*)$/.test(ctxBefore);
    const isEndOfSentence = /^([.!?]|\s|$)/.test(ctxAfter) || ctxAfter.length === 0;
    const isMidSentence = !isStartOfSentence && !isEndOfSentence;
    setSelMenu(null);
    setBusy(true); setStatus({ summarize: "Summarizing…", expand: "Expanding…", explain: "Explaining…" }[action]);
    const sys = `You are SunnyD. Return ONLY valid JSON, no markdown. Schema: {"op":"replace"|"add_after"|"add_before"|"delete","text":"...","explanation":"..."}
- "replace": replace the selection with your response (use for summarize or when rewriting)
- "add_after": keep selection, add your response after it. Your "text" MUST include any leading space, punctuation, or newlines for natural flow (e.g. " (i.e., ...)" or " — " for inline; newline for new paragraph).
- "add_before": keep selection, add your response before it. Your "text" MUST include trailing space or newlines for natural flow.
- "delete": remove the selection, put your response in "text" if replacing with something shorter.
"explanation": REQUIRED. 1–2 sentences max. Brief overview of what SunnyD will do.`;
    const otherNotes = notes.filter(n => n.id !== activeId);
    const crossCtx = otherNotes.length > 0
      ? `\n\nOther notes (for topic context):\n${otherNotes.map(n => `[${n.title}]: ${n.content.slice(0, 200)}${n.content.length > 200 ? "…" : ""}`).join("\n\n")}`
      : "";
    const ctxBlock = `Note title: "${noteTitle}"

Text BEFORE the selection (for flow):
"${ctxBefore}"

Selected text:
"${t}"

Text AFTER the selection (for flow):
"${ctxAfter}"

Insertion context: Selection is ${isMidSentence ? "mid-sentence" : isStartOfSentence ? "at start of sentence" : "at end of sentence"}. Match the surrounding tone and structure.${crossCtx}`;
    const cfg = {
      summarize: ["Summarize ONLY the selected text. Return a concise 2–3 sentence summary that captures the key points of what the user selected. Your response MUST be a direct condensation of the selection — do not add external context, opinions, or unrelated information. Preserve the main ideas. Do not truncate.", `${ctxBlock}\n\nFull note:\n\n${fullContext}`],
      expand:    ["Expand with depth, context, examples in 4–6 sentences. Do not truncate. Use add_after. Your text must include leading newlines if starting a new paragraph.", `${ctxBlock}\n\nFull note:\n\n${fullContext}`],
      explain:   ["Explain the selected term or phrase simply for a curious learner. Keep the original selection. Use add_after. Your explanation must flow naturally — use a parenthetical (like this), an em dash —, or a colon : depending on context. For mid-sentence: start your text with the connector, e.g. ' (i.e., ...)' or ' — '. For end of sentence: use ' — ' or newline for a new sentence. Do not truncate. Match the note tone.", ctxBlock],
    };
    try {
      const raw = await ai(llmProvider, apiKey, sys + " " + cfg[action][0], cfg[action][1], 900);
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      let parsed = { op: "replace", text: raw };
      if (match) try { parsed = JSON.parse(match[0]); } catch { }
      const op = ["replace", "add_after", "add_before", "delete"].includes(parsed.op) ? parsed.op : "replace";
      const text = (parsed.text ?? raw).trim();
      let explanation = (parsed.explanation ?? "").trim();
      if (!explanation) explanation = action === "expand" ? "Adding expanded content after your selection." : action === "summarize" ? "Replacing with a concise summary." : "Applying the suggested change.";
      setSelRes({ action, text, op, explanation, original: t, start, end });
    } catch { setSelRes(null); }
    finally { busyWithSelAction.current = false; setBusy(false); setStatus(""); }
  };

  const applySuggestion = async s => {
    const currentContent = content; // capture at click-time before async gap
    setSugg(p => p.map(x => x.id === s.id ? { ...x, applying: true } : x));
    setStatus("Weaving suggestion into notes…");

    // Lecture suggestions with no textRef = brand-new content → append to end directly
    if (s.cat === "lecture" && !s.textRef) {
      const insertion = s.apply || s.detail;
      const newContent = currentContent.trimEnd() + "\n\n" + insertion;
      setContent(newContent);
      setSugg(p => p.filter(x => x.id !== s.id));
      setStatus("");
      lastScannedContent.current[activeId] = "";
      setTimeout(resize, 0);
      clearTimeout(timers.current.s);
      timers.current.s = setTimeout(() => generateSuggestions(activeId, newContent, notes), 2500);
      return;
    }

    const articlesJson = s.articles && Array.isArray(s.articles) && s.articles.length > 0
      ? JSON.stringify(s.articles)
      : "[]";

    let newContent = null;
    try {
      const weaved = await ai(
        llmProvider,
        apiKey,
        `You are SunnyD. Integrate a writing suggestion into the user's notes.

Return ONLY the complete updated notes text — no preamble, no markdown fences, just the revised text.

By type:
- "fact": Replace the inaccurate passage with the corrected information.
- "clarity": Rewrite the unclear passage to be clearer; preserve the original meaning.
- "expand": Add the expanded content after the referenced paragraph, separated by a blank line.
- "research": Add a brief inline citation AFTER the referenced section. Use the provided articles to create markdown links: [link text](url). Example: "Research supports this: [Smith et al., Nature 2020](https://doi.org/...)." Include 1-2 sentence context + links. Use REAL URLs from the articles.`,
        `Suggestion type: ${s.cat}
Referenced section: "${s.textRef || ""}"
Suggestion: ${s.detail}
${s.cat === "research" ? `Articles to cite (use these exact URLs): ${articlesJson}\n` : ""}
Text to integrate (use as-is or adapt): ${s.apply || s.detail}

Current notes:
${currentContent}`,
        1800
      );

      if (weaved.trim()) {
        newContent = weaved.trim();
        setContent(newContent);
      }
    } catch {
      // Graceful fallback: simple positional insert
      const insertion = s.apply || s.detail;
      if (insertion && s.textRef) {
        const idx = currentContent.indexOf(s.textRef);
        if (idx !== -1) {
          newContent = currentContent.slice(0, idx + s.textRef.length) + "\n\n" + insertion + currentContent.slice(idx + s.textRef.length);
          setContent(newContent);
          if (s.cat === "research" && s.textRef) dismissed.current.research.add(s.textRef.trim());
          setSugg(p => p.filter(x => {
            if (x.id === s.id) return false;
            if (s.cat === "research" && x.cat === "research" && isSimilarToResearchedSection((x.textRef || "").trim())) return false;
            return true;
          }));
          lastScannedContent.current[activeId] = "";
          if (suggestionsOn && newContent) {
            if (s.cat === "fact" && s.apply) {
              dismissed.current.fact.add(s.apply.trim());
              const appliedSents = newContent.match(/[A-Z][^.!?\n]{20,}[.!?]/g) || [];
              const key = s.apply.trim().slice(0, 35);
              for (const sent of appliedSents) {
                if (key.length >= 15 && sent.includes(key.slice(0, 20))) dismissed.current.fact.add(sent.trim());
              }
            }
            clearTimeout(timers.current.f);
            clearTimeout(timers.current.s);
            setTimeout(() => runFactCheck(newContent), 1500);
            setTimeout(() => generateSuggestions(activeId, newContent, notes), 2500);
          }
          setTimeout(resize, 0);
          return;
        }
      }
      if (insertion) {
        newContent = currentContent + "\n\n" + insertion;
        setContent(newContent);
      }
    } finally {
      if (s.cat === "research" && s.textRef) dismissed.current.research.add(s.textRef.trim());
      setSugg(p => p.filter(x => {
        if (x.id === s.id) return false;
        if (s.cat === "research" && x.cat === "research" && isSimilarToResearchedSection((x.textRef || "").trim())) return false;
        return true;
      }));
      setStatus("");
      if (newContent && suggestionsOn) {
        lastScannedContent.current[activeId] = "";
        if (s.cat === "fact" && s.apply) {
          dismissed.current.fact.add(s.apply.trim());
          const appliedSents = newContent.match(/[A-Z][^.!?\n]{20,}[.!?]/g) || [];
          const key = s.apply.trim().slice(0, 35);
          for (const sent of appliedSents) {
            if (key.length >= 15 && sent.includes(key.slice(0, 20))) dismissed.current.fact.add(sent.trim());
          }
        }
        clearTimeout(timers.current.f);
        clearTimeout(timers.current.s);
        setTimeout(() => runFactCheck(newContent), 1500);
        setTimeout(() => generateSuggestions(activeId, newContent, notes), 2500);
      }
      setTimeout(resize, 0);
    }
  };

  const weaveSelResult = () => {
    if (!selRes) return;
    clearTimeout(timers.current.s);
    clearTimeout(timers.current.f);
    const { start, end, text, op } = selRes;
    let next = content;
    if (op === "replace") next = content.slice(0, start) + text + content.slice(end);
    else if (op === "add_after") next = content.slice(0, end) + (text || "") + content.slice(end);
    else if (op === "add_before") next = content.slice(0, start) + (text || "") + content.slice(start);
    else if (op === "delete") next = content.slice(0, start) + (text || "") + content.slice(end);
    setContent(next);
    setSelRes(null);
    lastScannedContent.current[activeId] = "";
    if (suggestionsOn) {
      setTimeout(() => runFactCheck(next), 1500);
      setTimeout(() => generateSuggestions(activeId, next, notes), 2500);
    }
    setTimeout(resize, 0);
  };

  const dismissSugg = id => {
    const s = suggestions.find(x => x.id === id);
    if (s?.cat === "fact" && s?.textRef) dismissed.current.fact.add(s.textRef);
    if (s?.cat === "research" && s?.textRef) dismissed.current.research.add(s.textRef.trim());
    setSugg(p => p.filter(x => x.id !== id));
    setShownSuggIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const CARD_WIDTH = 300;
  const CARD_HEIGHT = 420;

  const getDockedCardPosition = useCallback((suggestion) => {
    const hlLayer = hlRef.current;
    const editorRect = docColRef.current?.getBoundingClientRect();

    // Lecture append suggestions — position card next to the end-of-note marker
    if (isAppendSugg(suggestion)) {
      const marker = hlLayer?.querySelector("#lecture-append-marker");
      if (marker && editorRect) {
        const markerRect = marker.getBoundingClientRect();
        const top = Math.min(markerRect.top, window.innerHeight - CARD_HEIGHT - 16);
        return { top: Math.max(top, 80), left: editorRect.right + 16 };
      }
      return { top: 120, left: (editorRect?.right ?? 0) + 16 };
    }

    const range = findSuggestionRange(content, suggestion);
    if (!range) return { top: 120, left: (editorRect?.right ?? 0) + 16 };
    const refIndex = range.start;
    if (!hlLayer) return { top: 120, left: (editorRect?.right ?? 0) + 16 };
    const refLen = range.end - range.start;
    const walker = document.createTreeWalker(hlLayer, NodeFilter.SHOW_TEXT);
    let node, offset = 0, found = false, targetRect = null;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (offset + len > refIndex && !found) {
        found = true;
        const r = document.createRange();
        r.setStart(node, refIndex - offset);
        r.setEnd(node, Math.min(refIndex - offset + refLen, len));
        targetRect = r.getBoundingClientRect();
        break;
      }
      offset += len;
    }
    if (!targetRect || !editorRect) return { top: 120, left: editorRect.right + 16 };
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
      if (e.key === "Escape" && dockedCard) closeDocked();
      if (e.key === "Escape" && selRes) setSelRes(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dockedCard, selRes]);

  /* ── Weave overlay: measure textRef rect when applying ── */
  useLayoutEffect(() => {
    if (!applyingSugg) { setWeaveRect(null); return; }
    const range = findSuggestionRange(content, applyingSugg);
    const hl = hlRef.current;
    const wrap = taWrapRef.current;
    if (!range || !hl || !wrap) { setWeaveRect(null); return; }
    const walker = document.createTreeWalker(hl, NodeFilter.SHOW_TEXT);
    let node, offset = 0, startNode = null, startOff = 0, endNode = null, endOff = 0;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      const nEnd = offset + len;
      if (startNode == null && offset <= range.start && range.start < nEnd) {
        startNode = node; startOff = range.start - offset;
      }
      if (endNode == null && offset < range.end && range.end <= nEnd) {
        endNode = node; endOff = range.end - offset;
        break;
      }
      offset = nEnd;
    }
    if (!startNode || !endNode) { setWeaveRect(null); return; }
    const r = document.createRange();
    r.setStart(startNode, startOff);
    r.setEnd(endNode, endOff);
    const targetRect = r.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    setWeaveRect({
      top: targetRect.top - wrapRect.top,
      left: targetRect.left - wrapRect.left,
      width: targetRect.width,
      height: targetRect.height,
    });
  }, [applyingSugg, content]);

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
    setGhost(null); setGhostThinking(false); setSelRes(null); setHoveredSuggId(null); setDockedCard(null); setPanelHidden(false);
    const snapNotes = notes;
    const t1 = suggestionsOn ? setTimeout(() => runFactCheck(content), 2500) : null;
    const t3 = suggestionsOn ? setTimeout(() => generateSuggestions(activeId, content, snapNotes), 5000) : null;
    setTimeout(resize, 50);
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
      const hl = hlRef.current;
      const panel = panelBodyRef.current;
      if (!hl || !panel || sugg.length === 0) {
        setSuggTops(prev => (Object.keys(prev).length === 0 ? prev : {}));
        return;
      }
      const panelRect = panel.getBoundingClientRect();
      const positions = {};
      for (const s of sugg) {
        const range = findSuggestionRange(txt, s);
        if (!range) continue;
        const refIndex = range.start;
        const walker = document.createTreeWalker(hl, NodeFilter.SHOW_TEXT);
        let node, charOffset = 0;
        let found = false;
        while ((node = walker.nextNode())) {
          const len = node.textContent.length;
          if (charOffset + len > refIndex) {
            const offsetInNode = Math.max(0, Math.min(refIndex - charOffset, len - 1));
            const r = document.createRange();
            r.setStart(node, offsetInNode);
            r.setEnd(node, Math.min(offsetInNode + 1, len));
            const rect = r.getBoundingClientRect();
            positions[s.id] = rect.top - panelRect.top;
            found = true;
            break;
          }
          charOffset += len;
        }
        if (!found) positions[s.id] = null;
      }
      const sorted = [...sugg].sort((a, b) => (positions[a.id] ?? 9999) - (positions[b.id] ?? 9999));
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const prevTop = positions[prev.id];
        const currTop = positions[curr.id];
        if (prevTop != null && currTop != null && currTop < prevTop + MIN_SPACING) {
          positions[curr.id] = prevTop + MIN_SPACING;
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
    const ta = taRef.current;
    const ann = annColRef.current;
    if (!main && !ta && !ann) return;
    const onScroll = () => requestAnimationFrame(recalcSuggTops);
    main?.addEventListener("scroll", onScroll, { passive: true });
    ta?.addEventListener("scroll", onScroll, { passive: true });
    ann?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      main?.removeEventListener("scroll", onScroll);
      ta?.removeEventListener("scroll", onScroll);
      ann?.removeEventListener("scroll", onScroll);
    };
  }, [recalcSuggTops]);

  // Skeletons only show while AI is generating suggestions — NOT when user runs selection actions (expand/summarize/explain)
  const showThinking = busy && activeSugg.length === 0 && !busyWithSelAction.current;

  const wc = (content.match(/\S+/g) || []).length;

  const SEL_ACTS = [
    { key: "summarize", icon: "◈", label: "Summarize", desc: "Condense into key points" },
    { key: "expand",    icon: "⊕", label: "Expand",    desc: "Add depth and context" },
    { key: "explain",   icon: "◉", label: "Explain",   desc: "Break it down simply" },
  ];

  if (!apiKey) return <><style>{CSS}</style><KeyScreen onSave={saveKeys} /></>;

  return (
    <>
      <style>{CSS}</style>
      <div className="app" onClick={() => setSelMenu(null)}>

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
                  <span className="lecture-btn-ic">{lectureOn && listening ? "●" : "◉"}</span>
                  <span>Lecture</span>
                </button>
                <span className="hdr-sep" />
              </>
            )}
            <span className="hdr-wc">{wc} words</span>
            <select className="hdr-llm-select" value={llmProvider} onChange={e => setProviderAndLoadKey(e.target.value)} title="Switch LLM">
              {PROVIDERS.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <button className="btn-link" onClick={resetKey}>Change key</button>
          </div>
        </header>

        {lectureOn && (
          <div className="lecture-panel">
            <div className="lecture-panel-hdr">
              <span className="lecture-panel-lbl">
                {listening ? "Live transcription" : "Paused — click Lecture to resume"}
              </span>
              <div className="lecture-panel-actions">
                <button className="lecture-panel-btn" onClick={() => setShowFullTranscript(p => !p)}>
                  {showFullTranscript ? "Hide full transcript" : "View full transcript"}
                </button>
                <button className="lecture-panel-btn" onClick={() => {
                  resetTranscript();
                  setLectureQs([]);
                  setActiveLectureQ(null);
                  scannedTranscriptRef.current = "";
                  scannedLectureSuggRef.current = "";
                  setSugg(p => p.filter(s => s.cat !== "lecture"));
                }}>Clear</button>
              </div>
            </div>
            <div className={`lecture-transcript${showFullTranscript ? " expanded" : ""}`}>
              {transcript ? (
                <p className="lecture-text">
                  {renderTranscriptText(finalTranscript)}
                  {interimTranscript && <span className="lecture-interim"> {interimTranscript}</span>}
                  <span ref={transcriptEndRef} />
                </p>
              ) : (
                <p className="lecture-placeholder">Speak to see transcription… Detected questions will be highlighted.</p>
              )}
            </div>
            {lectureQs.length > 0 && (
              <div className="lecture-q-count">
                {lectureQs.length} question{lectureQs.length > 1 ? "s" : ""} detected — click to see suggested responses
              </div>
            )}
          </div>
        )}

        {/* Lecture question answer card */}
        {activeLectureQ && (
          <div
            className="lecture-q-card"
            style={{
              top: Math.min(activeLectureQ.y + 12, window.innerHeight - 280),
              left: Math.min(Math.max(activeLectureQ.x - 160, 12), window.innerWidth - 370),
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="lecture-q-card-hdr">
              <span className="lecture-q-badge">Suggested response</span>
              <button className="x-btn" onClick={() => setActiveLectureQ(null)}>×</button>
            </div>
            <div className="lecture-q-question">"{activeLectureQ.q.text}"</div>
            {lectureQRefreshing ? (
              <div className="lecture-q-loading">
                <ThinkDots />
                <span>Refreshing response…</span>
              </div>
            ) : activeLectureQ.q.answer ? (
              <>
                <div className="lecture-q-answer">{activeLectureQ.q.answer}</div>
                <div className="lecture-q-btns">
                  <button className="btn-apply" style={{ fontSize: 11, padding: "7px 16px" }}
                    onClick={() => {
                      const text = `Q: ${activeLectureQ.q.text}\n${activeLectureQ.q.answer}`;
                      navigator.clipboard.writeText(text).catch(() => {
                        const el = document.createElement("textarea");
                        el.value = text;
                        document.body.appendChild(el);
                        el.select();
                        document.execCommand("copy");
                        document.body.removeChild(el);
                      });
                      setLectureQCopied(true);
                      setTimeout(() => setLectureQCopied(false), 1800);
                    }}>
                    {lectureQCopied ? "Copied!" : "Copy"}
                  </button>
                  <button className="lecture-q-refresh-btn" title="Regenerate response"
                    onClick={async () => {
                      const qId = activeLectureQ.q.id;
                      const qText = activeLectureQ.q.text;
                      setLectureQRefreshing(true);
                      try {
                        const noteContext = notes.map(n => `[${n.title}]:\n${n.content.slice(0, 400)}`).join("\n\n");
                        const raw = await ai(
                          llmProvider, apiKey,
                          `You analyze live lecture transcripts to detect genuine spoken questions and generate helpful responses.
Return ONLY valid JSON, no markdown.
Schema: {"questions":[{"text":"exact phrase from transcript","answer":"1-2 sentences the student could say to contribute, grounded in their notes"}]}`,
                          `Question: "${qText}"\n\nStudent's notes for context:\n${noteContext.slice(0, 1200)}`,
                          500
                        );
                        const m = raw.replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/);
                        const parsed = m ? JSON.parse(m[0]) : null;
                        const newAnswer = parsed?.questions?.[0]?.answer?.trim() || activeLectureQ.q.answer;
                        setLectureQs(prev => prev.map(q => q.id === qId ? { ...q, answer: newAnswer } : q));
                        setActiveLectureQ(prev => prev ? { ...prev, q: { ...prev.q, answer: newAnswer } } : prev);
                      } catch { /* keep old answer on failure */ }
                      finally { setLectureQRefreshing(false); }
                    }}>
                    ↺
                  </button>
                  <button className="btn-decline" style={{ fontSize: 11, padding: "7px 14px" }}
                    onClick={() => {
                      const qId = activeLectureQ.q.id;
                      setLectureQs(prev => prev.filter(q => q.id !== qId));
                      setActiveLectureQ(null);
                      setLectureQCopied(false);
                    }}>
                    Dismiss
                  </button>
                </div>
              </>
            ) : (
              <div className="lecture-q-loading">
                <ThinkDots />
                <span>Generating response…</span>
              </div>
            )}
          </div>
        )}

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
            <button className="new-btn" onClick={() => {
              const id = Date.now();
              setNotes(p => [...p, { id, title: "Untitled", content: "" }]);
              setActiveId(id); setPop(null); setGhost(null); setSelRes(null); setGhostThinking(false); setHoveredSuggId(null); setDockedCard(null); setPanelHidden(false);
            }}>+ New Note</button>
            {notes.map(n => (
              <div key={n.id} className={`note-row${n.id === activeId ? " on" : ""}`}
                onClick={() => { setActiveId(n.id); setGhost(null); setGhostThinking(false); setHoveredSuggId(null); setDockedCard(null); setPanelHidden(false); }}>
                <div className="nr-pip" />
                <span className="nr-lbl">{n.title || "Untitled"}</span>
              </div>
            ))}
            <div className="sb-footer">
              <div className="sb-ttl">How it works</div>
              {[
                ["Fact checks",  "Right panel — hover to highlight"],
                ["Completion",   "Tab to accept"],
                ["Selection",    "Highlight text to transform"],
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
                  <span>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
                  {activeSugg.length > 0 && <span className="ann-badge">{activeSugg.length} suggestions</span>}
                </div>
                <div className="divider" />
                <div ref={taWrapRef} className="ta-wrap">
                  <div ref={hlRef} className={`hl-layer${selRes ? " has-sel-preview" : ""}`} aria-hidden="true">{renderHL()}</div>
                  <textarea ref={taRef} className="ta" value={content}
                    readOnly={!!applyingSugg || !!selRes}
                    onChange={handleChange} onKeyDown={handleKeyDown}
                    onScroll={syncScroll}
                    placeholder="Start writing — SunnyD will assist as you go." />
                  {applyingSugg && weaveRect && (
                    <div
                      className="weave-overlay"
                      style={{
                        top: Math.max(0, weaveRect.top - 4),
                        left: Math.max(0, weaveRect.left - 6),
                        minWidth: Math.max(180, weaveRect.width + 12),
                        minHeight: Math.max(40, weaveRect.height + 8),
                      }}
                    >
                      <div className="weave-typing">
                        <TypeWriter text={((applyingSugg.apply || applyingSugg.detail) || "Weaving…").slice(0, 280)} speed={18} />
                        <span className="weave-cursor" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Hint bar: shows Tab/Esc when ghost is visible */}
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
                  {activeSugg.length > 0
                    ? `${shownSugg.length} suggestion${shownSugg.length !== 1 ? "s" : ""}`
                    : "Suggestions"}
                </div>

                {showThinking && (
                  <>
                    <ThinkingCard delay={0} />
                    <ThinkingCard delay={220} />
                    <ThinkingCard delay={440} />
                  </>
                )}

                <div
                  ref={panelBodyRef}
                  className="ann-col-body"
                  style={{ minHeight: sortedSugg.length > 0 ? sortedSugg.length * MIN_SPACING + 100 : 0 }}
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
        {selMenu && (
          <div className="sel-card" style={{ left: selMenu.x, top: Math.max(10, selMenu.y - 148) }} onClick={e => e.stopPropagation()}>
            <div className="sel-hd">What should SunnyD do?</div>
            {SEL_ACTS.map(({ key, icon, label, desc }) => (
              <button key={key} className="sel-act" onClick={() => handleSelAction(key)}>
                <div className="sel-act-ic">{icon}</div>
                <div><div className="sel-act-lbl">{label}</div><div className="sel-act-desc">{desc}</div></div>
              </button>
            ))}
          </div>
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
    </>
  );
}
