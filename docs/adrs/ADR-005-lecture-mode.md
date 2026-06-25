# ADR-005: Lecture mode via browser speech recognition

## Status

Accepted on 2025-04-02. Owned by the SunnyD team.

## Context

Students take notes during live lectures and miss things. A live transcript that the AI can
compare against the notes would let SunnyD surface exactly what is worth adding — without
sending audio to a server (per ADR-001).

## Decision

Lecture mode uses the browser's built-in speech recognition (`react-speech-recognition`,
Chrome/Edge) to transcribe live, fully on-device. While recording, the transcript shows in a
collapsible panel, detected questions are highlighted (click for a short AI answer), and SunnyD
compares the transcript tail to the notes to produce **Lecture** suggestions. The Selection
Agent includes a trimmed transcript tail (`LECTURE_TAIL_CHARS = 3800`) as grounding context.

## Consequences

- Lecture mode is the strongest wedge for the **university student** segment.
- Browser-only transcription keeps the no-backend promise but limits support to Chrome/Edge.
- Requested by students attending live lectures.
- Feeds **SunnyD Cast** (ADR-006), which can turn a lecture + notes into a recap podcast.
