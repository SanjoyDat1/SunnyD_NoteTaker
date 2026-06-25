# ADR-004: The suggestion engine — categories and frequency modes

## Status

Accepted on 2025-03-20. Owned by the SunnyD team.

## Context

The core value of SunnyD is contextual suggestions while you write. But too many suggestions are
noisy and break flow, and different users want different levels of help.

## Decision

Suggestions are organized into categories — **Fact Check**, **Expand**, **Clarity**, **Explain**,
**Research** (real citations with URLs), and **Lecture** — and gated by a frequency control with
four modes: **Off**, **Zen** (fact checks + research), **Just Right** (adds clarity + explain),
and **Eager** (adds expand). Fact checks are always included regardless of mode, because
correctness is non-negotiable. Suggestions must quote verbatim source text (`sourceQuote`) so
they can be verified and are not hallucinated; hedged phrasing is deliberately not flagged.

## Consequences

- The Research feature only fires on claims that merit a source and skips already-cited
  passages, keeping citations relevant.
- Frequency lives in `sessionStorage` (`sd_suggFreq`).
- Requested by students (who want fact-checking and citations) and by focus-seekers (who want
  Zen mode).
- Metric to watch: suggestion acceptance rate by category. [FILL IN: target acceptance rate.]
