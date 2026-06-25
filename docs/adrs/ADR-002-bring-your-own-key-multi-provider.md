# ADR-002: Bring-your-own-key, multi-provider LLM support

## Status

Accepted on 2025-03-12. Owned by the SunnyD team. Supersedes the initial OpenAI-only prototype.

## Context

Running inference for users would require a SunnyD backend and a metered cost per user, which
conflicts with the no-backend decision (ADR-001). Users also have different provider
preferences, budgets, and trust.

## Decision

SunnyD uses a bring-your-own-key model and supports three providers: OpenAI (gpt-4o-mini, plus
TTS), Claude (claude-haiku-4-5), and Gemini (gemini-2.0-flash-lite). The user pastes their key
on the API key screen; it is stored per-provider in `sessionStorage` and cleared when the tab
closes. Users can switch provider or update the key anytime via "Change key."

## Consequences

- Zero inference cost to SunnyD; users pay their own provider directly.
- Feature parity differs by provider — e.g. semantic vector Search uses OpenAI/Gemini
  embeddings, while Claude falls back to keyword scoring (see ADR-004).
- Requested by cost-sensitive students and by users who already hold a provider key.
- A future hosted tier with managed keys is possible. [FILL IN: is managed-key hosting the
  monetization path?]
