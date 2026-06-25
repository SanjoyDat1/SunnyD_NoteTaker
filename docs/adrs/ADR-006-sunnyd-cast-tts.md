# ADR-006: SunnyD Cast — notes into a two-host podcast

## Status

Accepted on 2025-04-18. Owned by the SunnyD team.

## Context

Re-reading notes is a poor way to relearn. Audio recap is more engaging, especially for
commuting students. This requires text-to-speech that still honors the privacy stance.

## Decision

SunnyD Cast turns notes (and the lecture transcript, if present) into a short two-host podcast
with hosts **Dee** and **Ray**, length 2–10 minutes. TTS has three tiers: high-quality **OpenAI
TTS**, on-device **Kokoro TTS** (ONNX, no server), and browser **Web Speech** as a fallback. The
player can be minimized to a draggable floating dock while the user keeps writing, and an **Ask
about this moment** action pauses playback to answer a question grounded in the notes. Episodes
download as `.wav`.

## Consequences

- On-device Kokoro keeps Cast usable without an OpenAI key, preserving ADR-001/ADR-002.
- Cast is a differentiated, demo-able feature for the **student** segment.
- Requested by students who want to relearn material passively.
- Heavier client compute (ONNX model). [FILL IN: is Cast a free feature or a paid/Pro feature?]
