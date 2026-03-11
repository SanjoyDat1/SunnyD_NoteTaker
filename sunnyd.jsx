import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";

/* ─── OpenAI ─────────────────────────────────────────────────────────────── */
async function ai(apiKey, system, user, max = 900) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: max,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.choices?.[0]?.message?.content?.trim() || "";
}

/* ─── Seed ───────────────────────────────────────────────────────────────── */
const SEED = [
  {
    id: 1, title: "Research Notes",
    content: "The Great Wall of China is approximately 500 miles long and was built entirely during the Ming Dynasty.\n\nQuantum entanglement allows particles to instantaneously affect each other regardless of distance, which means information could theoretically travel faster than light.\n\nWhat is the difference between RNA and DNA?\n\nClimate change is primarily driven by human activities, especially the burning of fossil fuels. Rising CO2 levels have increased by about 50% since pre-industrial times.",
  },
  {
    id: 2, title: "Ideas",
    content: "The Industrial Revolution began in Britain around 1760 and was primarily driven by the invention of the steam engine by James Watt.\n\nHow does photosynthesis actually work?\n\nArtificial intelligence could transform education by providing personalized tutoring at scale.",
  },
];

let _n = 0;
const uid = () => `a${++_n}_${Date.now()}`;

/* ─── Categories ─────────────────────────────────────────────────────────── */
const CATS = {
  fact:     { label: "Fact Check",  color: "#C04500", bg: "#FFF2EA", border: "#EFAA7A", icon: "⚠" },
  expand:   { label: "Expand",      color: "#1A6835", bg: "#EDFAF2", border: "#7DD4A0", icon: "✦" },
  clarity:  { label: "Clarity",     color: "#1448AA", bg: "#EEF3FF", border: "#88BCEE", icon: "≋" },
  explain:  { label: "Explain",     color: "#0A6868", bg: "#EDFAFA", border: "#7ECCCC", icon: "◉" },
  question: { label: "Question",    color: "#5E38A0", bg: "#F5F0FF", border: "#B498E8", icon: "?" },
  research: { label: "Research",    color: "#0A6868", bg: "#EDFAFA", border: "#7ECCCC", icon: "⊞" },
};

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
    <div className="ann-card ann-thinking" style={{ borderLeftColor: "var(--rule2)", animationDelay: `${delay}ms` }}>
      <div className="ann-header">
        <div className="ann-tag" style={{ color: "var(--ink3)" }}>
          <span className="ann-tag-dot" style={{ background: "var(--rule2)" }} />
          <ThinkDots />
        </div>
      </div>
      <div style={{ padding: "4px 14px 14px" }}>
        <div className="ann-skel" style={{ width: "78%" }} />
        <div className="ann-skel" style={{ width: "54%", marginTop: 7 }} />
      </div>
    </div>
  );
}

/* Truncate preview to complete words that fit one line (no ellipsis cut-off) */
function previewOneLine(text) {
  if (!text || typeof text !== "string") return "";
  const words = text.trim().split(/\s+/);
  const maxChars = 32;
  let out = "";
  for (const w of words) {
    if (out.length + (out ? 1 : 0) + w.length <= maxChars) out += (out ? " " : "") + w;
    else break;
  }
  return out || words[0]?.slice(0, maxChars) || "";
}

/* ─── AnnCard ────────────────────────────────────────────────────────────── */
function AnnCard({ s, onDismiss, isNew, onHover, onLeave, onCardClick }) {
  const cat = CATS[s.cat] || CATS.expand;
  const displayPreview = previewOneLine(s.preview);

  const handleCardClick = e => {
    if (s.applying) return;
    if (e.target.closest(".ann-dismiss")) return;
    onCardClick?.(s, e);
  };

  return (
    <div
      className={`ann-card${isNew ? " ann-enter" : ""}${s.applying ? " applying" : ""}`}
      style={{ borderLeftColor: cat.color }}
      onMouseEnter={() => onHover?.(s.id)}
      onMouseLeave={() => onLeave?.()}
      onClick={handleCardClick}
    >
      {/* Header: badge + expand toggle + dismiss */}
      <div className="ann-header">
        <div className="ann-tag" style={{ color: cat.color }}>
          <span className="ann-tag-dot" style={{ background: cat.color }} />
          <span>{cat.label}</span>
        </div>
        <button className="ann-dismiss" onClick={e => { e.stopPropagation(); onDismiss(s.id); }}>×</button>
      </div>

      {/* Preview: always visible, max 5 words so it never cuts off */}
      <p className="ann-preview">
        {isNew ? <TypeWriter text={displayPreview} speed={22} /> : displayPreview}
      </p>

      {/* ...more — opens floating card with Apply/Decline */}
      <div className="ann-actions" onClick={e => e.stopPropagation()}>
        {s.applying ? (
          <div className="ann-applying">
            <span className="think-dots"><span /><span /><span /></span>
            <span>Weaving into notes…</span>
          </div>
        ) : (
          <button className="btn-more" onClick={e => onCardClick?.(s, e)}>…more</button>
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
.hdr-r{display:flex;align-items:center;gap:10px;}
.hdr-wc{font-size:11px;color:var(--ink3);opacity:.6;}
.btn-link{font-size:11px;color:var(--ink3);background:none;border:none;cursor:pointer;padding:3px 7px;border-radius:4px;transition:background .15s;}
.btn-link:hover{background:var(--paper);color:var(--ink2);}

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
.hl-layer{position:absolute;inset:0;font-family:'DM Sans',sans-serif;font-size:16px;line-height:1.85;white-space:pre-wrap;word-break:break-word;color:var(--ink);pointer-events:none;overflow:hidden;z-index:0;}
.hf{text-decoration:underline;text-decoration-style:wavy;text-decoration-color:rgba(160,105,30,.5);text-decoration-thickness:1.5px;text-underline-offset:3px;background:rgba(210,160,60,.1);border-radius:2px;}
.hf.fresh{animation:annFresh .6s ease forwards;}
@keyframes annFresh{0%{background:rgba(210,160,60,.32)}100%{background:rgba(210,160,60,.1)}}
.hq{background:rgba(90,105,160,.09);border-bottom:1.5px solid rgba(70,88,150,.28);border-radius:2px 2px 0 0;}
.hq.fresh{animation:annFreshQ .6s ease forwards;}
@keyframes annFreshQ{0%{background:rgba(90,105,160,.26)}100%{background:rgba(90,105,160,.09)}}
.ta{position:relative;z-index:1;display:block;width:100%;min-height:460px;background:transparent;color:transparent;caret-color:var(--ink);font-family:'DM Sans',sans-serif;font-size:16px;line-height:1.85;padding:0;border:none;outline:none;resize:none;word-break:break-word;}
.ta:read-only{cursor:default;}
.ta::placeholder{color:#C8C0B4;}
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
.ann-empty{padding:12px 0;font-family:'DM Sans',sans-serif;font-size:11px;color:var(--ink3);line-height:1.5;opacity:.65;}

/* ── Annotation cards (compact one-liner) ── */
.ann-card{
  background:var(--page);
  border-left:2px solid var(--rule2);
  border-radius:0 5px 5px 0;
  margin-bottom:6px;
  overflow:hidden;
  transition:box-shadow .2s,transform .18s;
  box-shadow:0 1px 3px rgba(50,35,15,.04);
}
.ann-card:hover{box-shadow:0 2px 8px rgba(50,35,15,.08);transform:translateX(2px);}
.ann-card.expanded{box-shadow:0 2px 8px rgba(50,35,15,.08);}
.ann-thinking{opacity:0;animation:annEnter .5s ease forwards;}
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

/* Preview — one-liner with ellipsis */
.ann-preview{padding:3px 10px 6px;font-family:'DM Sans',sans-serif;font-size:11px;color:var(--ink);line-height:1.35;cursor:pointer;user-select:none;font-weight:400;white-space:nowrap;overflow:visible;}

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
.sel-card{position:fixed;z-index:9999;transform:translateX(-50%);background:var(--page);border:1px solid var(--rule2);border-radius:10px;box-shadow:0 8px 28px rgba(50,35,15,.12);padding:5px;animation:cardRise .18s cubic-bezier(.22,1,.36,1);min-width:236px;}
@keyframes cardRise{from{opacity:0;transform:translateX(-50%) translateY(7px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.sel-hd{padding:6px 10px 7px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--ink3);border-bottom:1px solid var(--rule);margin-bottom:3px;}
.sel-act{display:flex;align-items:center;gap:9px;width:100%;padding:8px 10px;border-radius:7px;background:none;border:none;cursor:pointer;text-align:left;font-family:'DM Sans',sans-serif;transition:background .1s;}
.sel-act:hover{background:var(--paper);}
.sel-act-ic{width:26px;height:26px;border-radius:5px;background:var(--paper);border:1px solid var(--rule);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--ink2);flex-shrink:0;}
.sel-act-lbl{font-size:12.5px;font-weight:600;color:var(--ink);line-height:1.2;}
.sel-act-desc{font-size:10px;color:var(--ink3);}

/* ── Sel result panel ── */
.sel-panel{margin-top:18px;padding:18px 20px;background:var(--paper);border:1px solid var(--rule);border-radius:6px;opacity:0;animation:fadeSoft .25s ease forwards;}
.sp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
.sp-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--ink3);}
.sp-orig{font-family:'DM Sans',sans-serif;font-size:12px;color:#BCB4A8;margin-bottom:12px;line-height:1.5;padding-left:10px;border-left:2px solid var(--rule2);}
.sp-body{font-size:14.5px;color:var(--ink2);line-height:1.72;font-family:'DM Sans',sans-serif;font-weight:400;}
.sp-btns{display:flex;gap:7px;margin-top:14px;flex-wrap:wrap;}

/* ── Pop ── */
.pop{position:fixed;z-index:9998;width:330px;background:var(--page);border-radius:10px;border:1px solid var(--rule2);box-shadow:0 10px 34px rgba(50,35,15,.1);padding:16px 18px;animation:cardRise .18s cubic-bezier(.22,1,.36,1);}
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

/* ─── Key Screen ─────────────────────────────────────────────────────────── */
function KeyScreen({ onSave }) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const k = val.trim();
    if (!k) { setErr("Please enter your API key."); return; }
    if (!k.startsWith("sk-")) { setErr("Key should start with sk-"); return; }
    setLoading(true); setErr("");
    try {
      await ai(k, "Reply with the single word: ready", "ping", 5);
      onSave(k);
    } catch (e) {
      const msg = e.message || "";
      if (msg.includes("maximum") || msg.includes("token") || msg.includes("content")) {
        onSave(k);
      } else {
        setErr("Could not connect: " + msg.slice(0, 80));
      }
    } finally { setLoading(false); }
  };

  return (
    <div className="key-screen">
      <div className="key-card">
        <div className="key-mark">S</div>
        <div className="key-title">Welcome to SunnyD</div>
        <div className="key-sub">An open-source intelligent notepad. Your API key stays in your browser — it's never stored on any server.</div>
        <label className="key-lbl">OpenAI API Key</label>
        <input className="key-inp" type="password" placeholder="sk-..." value={val}
          onChange={e => { setVal(e.target.value); setErr(""); }}
          onKeyDown={e => e.key === "Enter" && !loading && submit()} autoFocus />
        {err && <div className="key-err">{err}</div>}
        <button className="key-btn" onClick={submit} disabled={loading || !val.trim()}>
          {loading ? "Connecting…" : "Get Started"}
        </button>
        <div className="key-note">
          Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>
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

/* ─── QPop ────────────────────────────────────────────────────────────────── */
function QPop({ ann, onWeave, onDismiss, onClose, onGetAnswer }) {
  const [prev, setPrev] = useState(false);
  const [fetchingAnswer, setFetchingAnswer] = useState(false);
  const socratic = ann.data?.socraticGuide;
  const direct = ann.data?.directAnswer;

  const handleGetAnswer = async () => {
    setFetchingAnswer(true);
    await onGetAnswer(ann.id, ann.text);
    setFetchingAnswer(false);
  };

  return (
    <>
      <div className="pop-hd"><span className="pop-type">Question</span><button className="x-btn" onClick={onClose}>×</button></div>
      <p className="pop-txt">{ann.text}</p>
      {!socratic && !direct && <div className="ldots"><span /><span /><span /></div>}
      {socratic && !direct && (
        <>
          {!fetchingAnswer ? (
            <>
              <div className="pop-socratic">
                <div className="pop-socratic-lbl">Think it through</div>
                <div className="pop-ans">{socratic}</div>
              </div>
              <div className="pop-btns">
                <button className="btn-fill" onClick={handleGetAnswer}>Give me the answer</button>
                <button className="btn-out" onClick={onDismiss}>Dismiss</button>
              </div>
            </>
          ) : (
            <div className="pop-thinking">
              <span className="pop-thinking-txt">Thinking</span>
              <div className="pop-thinking-dots"><span /><span /><span /></div>
            </div>
          )}
        </>
      )}
      {direct && !prev && (
        <div className="pop-direct-wrap" style={{ animation: "fadeSoft .35s ease-out forwards" }}>
          <div className="pop-ans">{direct}</div>
          <div className="pop-btns">
            <button className="btn-fill" onClick={() => setPrev(true)}>Weave into notes</button>
            <button className="btn-out" onClick={onDismiss}>Dismiss</button>
          </div>
        </div>
      )}
      {direct && prev && (
        <><div className="pop-prev"><span className="pop-prev-lbl">Will add after question</span>{direct}</div>
        <div className="pop-btns">
          <button className="btn-fill" onClick={onWeave}>✓ Confirm</button>
          <button className="btn-out" onClick={() => setPrev(false)}>Back</button>
        </div></>
      )}
    </>
  );
}

/* ─── Main ───────────────────────────────────────────────────────────────── */
export default function SunnyDNotes() {
  const [apiKey,      setApiKey]      = useState(() => { try { return sessionStorage.getItem("sd_key") || ""; } catch { return ""; } });
  const [notes,       setNotes]       = useState(SEED);
  const [activeId,    setActiveId]    = useState(1);
  const [anns,        setAnns]        = useState([]);
  const [suggestions, setSugg]        = useState([]);
  const [shownSuggIds,   setShownSuggIds]   = useState(new Set());
  const [hoveredSuggId,  setHoveredSuggId]  = useState(null);
  const [dockedCard,     setDockedCard]     = useState(null);
  const [panelHidden,    setPanelHidden]    = useState(false);
  const [pop,            setPop]            = useState(null);
  const [ghost,       setGhost]       = useState(null);
  const [ghostThinking, setGhostThinking] = useState(false);
  const [selMenu,     setSelMenu]     = useState(null);
  const [selRes,      setSelRes]      = useState(null);
  const [busy,        setBusy]        = useState(false);
  const [statusTxt,   setStatus]      = useState("");
  const [copied,      setCopied]      = useState(false);
  const [weaveRect,   setWeaveRect]   = useState(null);

  const taRef       = useRef(null);
  const hlRef       = useRef(null);
  const docColRef   = useRef(null);
  const taWrapRef   = useRef(null);
  const timers      = useRef({});
  const dismissed   = useRef({ fact: new Set(), q: new Set() });
  const checked     = useRef(new Set());
  const processedQ  = useRef(new Set());
  const lastScannedContent = useRef({});
  const ghostBusy   = useRef(false);
  const newSuggIds  = useRef(new Set());

  const saveKey  = k => { try { sessionStorage.setItem("sd_key", k); } catch {} setApiKey(k); };
  const resetKey = () => { try { sessionStorage.removeItem("sd_key"); } catch {} setApiKey(""); };

  const note       = notes.find(n => n.id === activeId) || notes[0];
  const content    = note.content;
  const setContent = v => setNotes(p => p.map(n => n.id === activeId ? { ...n, content: v } : n));
  const setTitle   = v => setNotes(p => p.map(n => n.id === activeId ? { ...n, title:   v } : n));
  const activeAnns = anns.filter(a => a.noteId === activeId && content.includes(a.text));
  const activeSugg = suggestions.filter(s => s.noteId === activeId);
  const applyingSugg = suggestions.find(s => s.applying);

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

  /* ── Positions ── */
  const getPos = useCallback((text, list) => {
    const seen = new Set();
    return list.map(a => {
      const i = text.indexOf(a.text);
      if (i === -1 || seen.has(i)) return null;
      seen.add(i);
      return { ...a, start: i, end: i + a.text.length };
    }).filter(Boolean).sort((a, b) => a.start - b.start);
  }, []);

  /* ── Highlight layer: inline annotations (questions only) + hovered suggestion + ghost ── */
  const questionAnns = activeAnns.filter(a => a.type === "q");
  function renderHL() {
    // Inline highlights: questions only (fact-checks appear as right-panel suggestions, highlighted on hover)
    const annRanges = getPos(content, questionAnns).map(a => ({
      id: a.id, start: a.start, end: a.end, kind: "ann",
      cls: (a.type === "fact" ? "hf" : "hq") + (a.fresh ? " fresh" : ""),
    }));

    // Suggestion highlight on hover or when card is expanded — use fuzzy matching if textRef doesn't match
    const suggToHighlight = hoveredSuggId;
    const hovSugg = suggToHighlight ? activeSugg.find(s => s.id === suggToHighlight) : null;
    const suggRange = (() => {
      if (!hovSugg) return null;
      const range = findSuggestionRange(content, hovSugg);
      if (!range) return null;
      const cat = CATS[hovSugg.cat] || CATS.expand;
      return { id: "shl", ...range, kind: "sugg", cat };
    })();

    // Docked card href highlight — category-colored light tint + solid border
    const dockedSugg = dockedCard?.suggestion;
    const dockedRange = (() => {
      if (!dockedSugg) return null;
      const r = findSuggestionRange(content, dockedSugg);
      if (!r) return null;
      const cat = CATS[dockedSugg.cat] || CATS.expand;
      return { id: dockedSugg.id, ...r, kind: "ref", cat };
    })();

    const overlaps = (a, b) => a.start < b.end && a.end > b.start;

    // Merge and sort all ranges; docked (href) overrides sugg for same span
    const baseRanges = [...annRanges];
    if (suggRange && (!dockedRange || !overlaps(suggRange, dockedRange))) baseRanges.push(suggRange);
    if (dockedRange) baseRanges.push(dockedRange);
    const ranges = baseRanges.sort((a, b) => a.start - b.start);

    const out = [];
    let p = 0;

    for (const r of ranges) {
      if (r.start < p) continue;
      if (r.start > p) out.push(<span key={`t${p}`} style={{ whiteSpace: "pre-wrap" }}>{content.slice(p, r.start)}</span>);

      const addHref = dockedRange && overlaps(r, dockedRange);
      const hrefStyle = dockedRange?.cat ? { background: dockedRange.cat.bg, border: `1px solid ${dockedRange.cat.color}`, borderRadius: "3px" } : {};
      if (r.kind === "ann") {
        const cls = r.cls + (addHref ? " href" : "");
        out.push(<span key={r.id} className={cls} style={{ whiteSpace: "pre-wrap", ...(addHref ? hrefStyle : {}) }}>{content.slice(r.start, r.end)}</span>);
      } else if (r.kind === "ref") {
        out.push(<span key="href" className="href" style={{ whiteSpace: "pre-wrap", ...hrefStyle }}>{content.slice(r.start, r.end)}</span>);
      } else {
        // Suggestion highlight: use category bg + border colors for a natural glow
        out.push(
          <span
            key="shl"
            className="hs"
            style={{
              whiteSpace: "pre-wrap",
              background: r.cat.bg,
              boxShadow: `0 0 0 1.5px ${r.cat.border}`,
              borderRadius: "2px",
            }}
          >
            {content.slice(r.start, r.end)}
          </span>
        );
      }
      p = r.end;
    }

    if (p < content.length) out.push(<span key="tend" style={{ whiteSpace: "pre-wrap" }}>{content.slice(p)}</span>);
    if (p === 0 && content.length === 0) out.push(<span key="empty" />);

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

  /* ── Click → popover (questions only; fact-checks are in right panel) ── */
  const handleTaClick = e => {
    const cursor = taRef.current?.selectionStart ?? 0;
    const hit = getPos(content, questionAnns).find(a => cursor >= a.start && cursor <= a.end);
    if (!hit) { setPop(null); return; }
    const x = Math.min(e.clientX, window.innerWidth - 350);
    const y = e.clientY + 18;
    setPop({ id: hit.id, x, y });
    setAnns(p => p.map(a => a.id === hit.id ? { ...a, fresh: false } : a));
    if (hit.type === "q" && !hit.data?.answer) fetchQAns(hit.id, hit.text);
  };

  const fetchQAns = async (id, question) => {
    try {
      const guide = await ai(apiKey,
        `You are SunnyD, a Socratic tutor. Do NOT give the answer. Instead, ask 2–3 guiding questions that lead the learner to discover the answer themselves. Each question should build on the previous. Be concise. Return only the questions, one per line.`,
        question, 400);
      setAnns(p => p.map(a => a.id === id ? { ...a, data: { ...a.data, socraticGuide: guide.trim() } } : a));
    } catch { setPop(null); }
  };

  const fetchDirectAnswer = async (id, question) => {
    try {
      const ans = await ai(apiKey,
        "You are SunnyD. Answer the question fully and accurately in 2–4 complete sentences. Never truncate.",
        question, 500);
      setAnns(p => p.map(a => a.id === id ? { ...a, data: { ...a.data, directAnswer: ans } } : a));
    } catch { setPop(null); }
  };

  /* ── Fact check: adds to right-panel suggestions only (highlight on hover) ── */
  async function runFactCheck(text) {
    if (busy) return;
    const sents = text.match(/[A-Z][^.!?\n]{20,}[.!?]/g) || [];
    for (const s of sents) {
      const t = s.trim();
      if (dismissed.current.fact.has(t) || checked.current.has(t)) continue;
      checked.current.add(t);
      setBusy(true); setStatus("Scanning…");
      try {
        const raw = await ai(apiKey,
          `You are SunnyD fact-checker. Examine the sentence for a verifiable inaccuracy.
Reply ONLY with valid JSON, no markdown:
Inaccurate: {"check":true,"question":"Socratic question?","correction":"Correct info in 1–2 sentences.","replacement":"Corrected version of the original sentence."}
Accurate or opinion: {"check":false}`,
          `Sentence: "${t}"`, 350);
        const p2 = JSON.parse(raw.replace(/```json|```/g, "").trim());
        if (p2.check) {
          const sugg = {
            id: uid(), noteId: activeId, cat: "fact",
            headline: "Fact check", textRef: t,
            preview: (p2.correction || "").slice(0, 60) + (p2.correction?.length > 60 ? "…" : ""),
            detail: p2.correction,
            apply: p2.replacement,
          };
          setSugg(p => [...p.filter(s => s.noteId !== activeId || s.textRef !== t), sugg]);
          setShownSuggIds(prev => new Set([...prev, sugg.id]));
        }
      } catch (e) { console.error(e); }
      finally { setBusy(false); setStatus(""); }
      break;
    }
  }

  /* ── Generate suggestions: re-scans every pause, uses all notes for context ── */
  async function generateSuggestions(noteId, text, allNotes) {
    if (!text.trim() || text.length < 40) return;
    // Skip if content hasn't changed since last successful scan
    if (lastScannedContent.current[noteId] === text) return;

    // Cross-note context: include snippets from other notes
    const otherNotes = allNotes.filter(n => n.id !== noteId);
    const crossCtx = otherNotes.length > 0
      ? `\n\nFor context, the user's other notes:\n${otherNotes.map(n => `[${n.title}]:\n${n.content.slice(0, 400)}`).join("\n\n")}`
      : "";

    // Clear existing suggestions for this note so new ones replace them
    setSugg(p => p.filter(s => s.noteId !== noteId));

    setBusy(true); setStatus("Analyzing…");
    try {
      const raw = await ai(apiKey,
        `You are SunnyD, an intelligent writing assistant. Analyze the active note and return fresh, specific suggestions.
Return ONLY a valid JSON array — no markdown, no extra text.

Each item schema:
{"cat":"<category>","headline":"<5-8 word headline>","preview":"<3-6 word teaser — must fit one line, no truncation>","detail":"<2-3 sentence detailed suggestion>","apply":"<replacement/addition text or null>","textRef":"<REQUIRED: exact phrase from the note this applies to>","articles":null}

CRITICAL — textRef: Every suggestion MUST have textRef. Copy the exact phrase from the note (10–80 chars) that this suggestion refers to. This enables highlighting. Never use null.

CRITICAL — preview: Exactly 3–6 words. A short teaser shown in the panel. Full detail goes in "detail" (shown when user clicks "...more"). Never exceed 6 words.

Categories (use exact keys) — do NOT suggest "question"; questions are handled inline when detected:
- "fact": factual claims that need verification or correction
- "expand": ideas worth developing further
- "clarity": sentences that could be clearer or better structured
- "explain": concepts or terms that deserve a simpler explanation
- "research": cite key claims that are TRUE and IMPORTANT — only suggest when a claim deserves a peer-reviewed source. FOR THESE ONLY, populate "articles":
  [{"title":"Article title","url":"https://doi.org/... or journal URL","source":"Journal Name (e.g. Nature, Science, PubMed)"}]
  Use 2-3 real peer-reviewed article URLs (DOI, PubMed, or journal links). Do NOT use Wikipedia.

Generate 1-3 per category only where genuinely helpful.`,
        `Active note:\n\n${text}${crossCtx}`, 1500);

      const cleaned = raw.replace(/```json|```/g, "").trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      const arr = match ? JSON.parse(match[0]) : JSON.parse(cleaned);
      if (Array.isArray(arr) && arr.length > 0) {
        const newSugg = arr
          .filter(s => s.cat !== "question") // Questions are inline-only, not in suggestion panel
          .map(s => ({ ...s, id: uid(), noteId }));
        setSugg(p => [...p.filter(s => s.noteId !== noteId), ...newSugg]);
        lastScannedContent.current[noteId] = text; // Only cache on success so we retry on failure
      } else if (Array.isArray(arr)) {
        lastScannedContent.current[noteId] = text; // Empty array is valid — nothing to suggest
      }
    } catch (e) {
      console.error("sugg:", e);
      delete lastScannedContent.current[noteId]; // Allow retry on next pause or note switch
    } finally { setBusy(false); setStatus(""); }
  }

  /* ── Q scan: detect all questions inline (highlighted, click to get answer) ── */
  function scanQ(text) {
    const candidates = [];
    for (const line of text.split("\n")) {
      const parts = line.split(/(?<=[?])/);
      for (const p of parts) {
        const t = p.trim();
        if (t.endsWith("?") && t.length > 8 && text.includes(t)) candidates.push(t);
      }
    }
    for (const t of [...new Set(candidates)]) {
      if (dismissed.current.q.has(t) || processedQ.current.has(t)) continue;
      processedQ.current.add(t);
      setTimeout(() => setAnns(p => p.some(a => a.text === t && a.noteId === activeId) ? p
        : [...p, { id: uid(), noteId: activeId, text: t, type: "q", fresh: true, data: {} }]), 1500);
    }
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
      const c = await ai(apiKey,
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
    setContent(v); setGhost(null); setGhostThinking(false); setPop(null); resize();
    clearTimeout(timers.current.t); clearTimeout(timers.current.f);
    clearTimeout(timers.current.q); clearTimeout(timers.current.s);
    const cur = e.target.selectionEnd;
    // Snapshot activeId and notes at call time to avoid stale closures
    const snapId = activeId;
    const snapNotes = notes;
    timers.current.t = setTimeout(() => runGhost(v, cur), 4800);
    timers.current.f = setTimeout(() => runFactCheck(v), 5500);
    timers.current.q = setTimeout(() => scanQ(v), 2200);
    timers.current.s = setTimeout(() => generateSuggestions(snapId, v, snapNotes), 5000);
  };

  const handleKeyDown = e => {
    if (e.key === "Tab" && ghost) {
      e.preventDefault();
      const pos = ghost.pos;
      const accepted = content.slice(0, pos) + ghost.text + content.slice(pos);
      setContent(accepted);
      setGhost(null);
      const newPos = pos + ghost.text.length;
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
      setSelMenu({ text, x: mouseX, y: mouseY - 10 });
    }, 25);
  };

  const handleSelAction = async action => {
    if (!selMenu) return;
    const t = selMenu.text; setSelMenu(null);
    setBusy(true); setStatus({ summarize: "Summarizing…", expand: "Expanding…", explain: "Explaining…" }[action]);
    const cfg = {
      summarize: ["Summarize in 2–3 complete sentences. Do not truncate.", `Summarize:\n\n"${t}"`],
      expand:    ["Expand with depth, context, and examples in 4–6 complete sentences. Do not truncate.", `Expand:\n\n"${t}"`],
      explain:   ["Explain simply in 2–4 complete sentences for a curious learner. Do not truncate.", `Explain:\n\n"${t}"`],
    };
    try {
      const result = await ai(apiKey, "You are SunnyD. " + cfg[action][0], cfg[action][1], 900);
      setSelRes({ action, text: result, original: t });
    } catch { }
    finally { setBusy(false); setStatus(""); }
  };

  /* ── Weave / apply ── */
  const weaveAnswer = id => {
    const a = anns.find(x => x.id === id);
    const ans = a?.data?.directAnswer || a?.data?.answer;
    if (!ans) return;
    const idx = content.indexOf(a.text);
    if (idx === -1) return;
    setContent(content.slice(0, idx + a.text.length) + "\n\n" + ans + content.slice(idx + a.text.length));
    setAnns(p => p.filter(x => x.id !== id)); setPop(null); setTimeout(resize, 0);
  };

  const applyCorrection = ann => {
    const idx = content.indexOf(ann.text);
    if (idx === -1) return;
    setContent(content.slice(0, idx) + ann.data.replacement + content.slice(idx + ann.text.length));
    setAnns(p => p.filter(x => x.id !== ann.id)); setPop(null); setTimeout(resize, 0);
  };

  const applySuggestion = async s => {
    const currentContent = content; // capture at click-time before async gap
    // Mark this card as "applying" so it shows the weaving spinner
    setSugg(p => p.map(x => x.id === s.id ? { ...x, applying: true } : x));
    setStatus("Weaving suggestion into notes…");

    try {
      const weaved = await ai(
        apiKey,
        `You are SunnyD. Your job is to intelligently integrate a writing suggestion into the user's notes.

Return ONLY the complete updated notes text — no preamble, no explanation, no markdown fences, just the revised text.

Instructions by suggestion type:
- "fact": Replace the inaccurate passage with the corrected information, keeping the same sentence structure.
- "clarity": Rewrite the unclear passage to be clearer and more precise; preserve the original meaning.
- "expand": Add the expanded content immediately after the referenced paragraph, separated by a blank line.
- "research": Add a brief context note or citation inline after the referenced section.

Maintain the user's voice and writing style throughout.`,
        `Suggestion type: ${s.cat}
Referenced section: "${s.textRef || ""}"
Suggestion: ${s.detail}
Text to integrate: ${s.apply || s.detail}

Current notes:
${currentContent}`,
        1800
      );

      if (weaved.trim()) {
        setContent(weaved.trim());
      }
    } catch {
      // Graceful fallback: simple positional insert
      if (s.apply || s.detail) {
        const insertion = s.apply || s.detail;
        if (s.textRef) {
          const idx = currentContent.indexOf(s.textRef);
          if (idx !== -1) {
            setContent(currentContent.slice(0, idx + s.textRef.length) + "\n\n" + insertion + currentContent.slice(idx + s.textRef.length));
            setSugg(p => p.filter(x => x.id !== s.id)); setTimeout(resize, 0); return;
          }
        }
        setContent(currentContent + "\n\n" + insertion);
      }
    } finally {
      setSugg(p => p.filter(x => x.id !== s.id));
      setStatus("");
      setTimeout(resize, 0);
    }
  };

  const weaveSelResult = () => {
    if (!selRes) return;
    const idx = content.indexOf(selRes.original);
    if (idx !== -1) setContent(content.slice(0, idx + selRes.original.length) + "\n\n" + selRes.text + content.slice(idx + selRes.original.length));
    setSelRes(null); setTimeout(resize, 0);
  };

  const dismiss = id => {
    const a = anns.find(x => x.id === id);
    if (a) dismissed.current[a.type === "fact" ? "fact" : "q"].add(a.text);
    setAnns(p => p.filter(x => x.id !== id)); setPop(null);
  };

  const dismissSugg = id => {
    const s = suggestions.find(x => x.id === id);
    if (s?.cat === "fact" && s?.textRef) dismissed.current.fact.add(s.textRef);
    setSugg(p => p.filter(x => x.id !== id));
    setShownSuggIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const CARD_WIDTH = 300;
  const CARD_HEIGHT = 420;

  const getDockedCardPosition = useCallback((suggestion) => {
    const hlLayer = hlRef.current;
    const editorRect = docColRef.current?.getBoundingClientRect();
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
    const onKey = e => { if (e.key === "Escape" && dockedCard) closeDocked(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dockedCard]);

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

  /* ── Init on note switch ── */
  useEffect(() => {
    if (!apiKey) return;
    checked.current = new Set(); processedQ.current = new Set();
    setGhost(null); setGhostThinking(false); setPop(null); setSelRes(null); setHoveredSuggId(null); setDockedCard(null); setPanelHidden(false);
    const snapNotes = notes;
    const t1 = setTimeout(() => runFactCheck(content), 2500);
    const t2 = setTimeout(() => scanQ(content), 1800);
    const t3 = setTimeout(() => generateSuggestions(activeId, content, snapNotes), 3500);
    setTimeout(resize, 50);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [activeId, apiKey]);

  /* ── Sorted shown suggestions by text position ── */
  const shownSugg = activeSugg.filter(s => shownSuggIds.has(s.id));
  const pendingCount = activeSugg.length - shownSugg.length;
  const sortedSugg = [...shownSugg].sort((a, b) => {
    const pa = a.textRef ? content.indexOf(a.textRef) : Infinity;
    const pb = b.textRef ? content.indexOf(b.textRef) : Infinity;
    return pa - pb;
  });
  // Skeletons only show while AI is working with zero results yet — disappear the moment any card arrives
  const showThinking = busy && activeSugg.length === 0;

  const popAnn = pop ? anns.find(a => a.id === pop.id) : null;
  const wc = (content.match(/\S+/g) || []).length;

  const SEL_ACTS = [
    { key: "summarize", icon: "◈", label: "Summarize", desc: "Condense into key points" },
    { key: "expand",    icon: "⊕", label: "Expand",    desc: "Add depth and context" },
    { key: "explain",   icon: "◉", label: "Explain",   desc: "Break it down simply" },
  ];

  if (!apiKey) return <><style>{CSS}</style><KeyScreen onSave={saveKey} /></>;

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
            <span className="hdr-wc">{wc} words</span>
            <button className="btn-link" onClick={resetKey}>Change key</button>
          </div>
        </header>

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
                onClick={() => { setActiveId(n.id); setPop(null); setGhost(null); setGhostThinking(false); setHoveredSuggId(null); setDockedCard(null); setPanelHidden(false); }}>
                <div className="nr-pip" />
                <span className="nr-lbl">{n.title || "Untitled"}</span>
              </div>
            ))}
            <div className="sb-footer">
              <div className="sb-ttl">How it works</div>
              {[
                ["Fact checks",  "Right panel — hover to highlight"],
                ["Questions",    "Blue highlight — click"],
                ["Completion",   "Tab to accept"],
                ["Selection",    "Highlight text to transform"],
              ].map(([h, d]) => (
                <div key={h} className="sb-item"><div className="sb-h">{h}</div><div className="sb-d">{d}</div></div>
              ))}
            </div>
          </aside>

          {/* Main area: editor + annotation column scroll together */}
          <div className="main-area" onMouseUp={handleMouseUp} onClick={e => e.stopPropagation()}>
            <div className="main-inner">

              {/* Document column — click to close docked card */}
              <div ref={docColRef} className="doc-col" onClick={() => dockedCard && closeDocked()}>
                <div className="margin-line" />
                <input className="title-inp" value={note.title} onChange={e => setTitle(e.target.value)} placeholder="Untitled" />
                <div className="meta-row">
                  <span>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
                  {activeAnns.length > 0 && <span className="ann-badge">{activeAnns.length} inline</span>}
                  {activeSugg.length > 0 && <span className="ann-badge">{activeSugg.length} suggestions</span>}
                </div>
                <div className="divider" />
                <div ref={taWrapRef} className="ta-wrap">
                  <div ref={hlRef} className="hl-layer" aria-hidden="true">{renderHL()}</div>
                  <textarea ref={taRef} className="ta" value={content}
                    readOnly={!!applyingSugg}
                    onChange={handleChange} onKeyDown={handleKeyDown}
                    onScroll={syncScroll} onClick={handleTaClick}
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

                {/* Selection result */}
                {selRes && (
                  <div className="sel-panel">
                    <div className="sp-head">
                      <span className="sp-lbl">{selRes.action.charAt(0).toUpperCase() + selRes.action.slice(1)}</span>
                      <button className="x-btn" onClick={() => setSelRes(null)}>×</button>
                    </div>
                    <div className="sp-orig">"{selRes.original.length > 90 ? selRes.original.slice(0, 90) + "…" : selRes.original}"</div>
                    <div className="sp-body">{selRes.text}</div>
                    <div className="sp-btns">
                      <button className="btn-fill" onClick={weaveSelResult}>Weave into notes</button>
                      <button className="btn-ghost" onClick={() => { navigator.clipboard.writeText(selRes.text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</button>
                      <button className="btn-out" onClick={() => setSelRes(null)}>Close</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Annotation column — slides off when card is docked */}
              <div className={`ann-col sugg-panel${panelHidden ? " hidden" : ""}`}>
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

                {sortedSugg.map(s => (
                  <AnnCard
                    key={s.id}
                    s={s}
                    onDismiss={dismissSugg}
                    isNew={newSuggIds.current.has(s.id)}
                    onHover={id => setHoveredSuggId(id)}
                    onLeave={() => setHoveredSuggId(null)}
                    onCardClick={handleCardClick}
                  />
                ))}

                {activeSugg.length === 0 && !busy && (
                  <p className="ann-empty">SunnyD reads your notes as you write and surfaces insights here.</p>
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
        {pop && popAnn && popAnn.type === "q" && (
          <div className="pop" style={{ left: pop.x, top: pop.y }} onClick={e => e.stopPropagation()}>
            <QPop ann={popAnn} onWeave={() => weaveAnswer(popAnn.id)} onDismiss={() => dismiss(popAnn.id)} onClose={() => setPop(null)} onGetAnswer={fetchDirectAnswer} />
          </div>
        )}

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
                  <div className="dc-body">{s.detail}</div>
                  <div className="dc-btns">
                    {s.apply && (
                      <button className="dc-apply" onClick={() => { applySuggestion(s); closeDocked(); }}>
                        ✓ Apply
                      </button>
                    )}
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
