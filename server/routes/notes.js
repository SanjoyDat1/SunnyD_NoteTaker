import { Router } from "express";
import { readWorkspace, writeWorkspace } from "../db/index.js";

const router = Router();

function validateNotesPayload(body) {
  if (!body || typeof body !== "object") return "Body must be a JSON object";
  if (!Array.isArray(body.notes)) return "notes must be an array";
  if (body.activeId == null || body.activeId === "") return "activeId is required";
  for (const n of body.notes) {
    if (!n || typeof n !== "object") return "each note must be an object";
    if (n.id == null) return "each note must have an id";
    if (typeof n.title !== "string") return "each note must have a title string";
    if (typeof n.content !== "string") return "each note must have a content string";
  }
  return null;
}

/** GET /api/notes — load workspace for authenticated user */
router.get("/", async (req, res) => {
  try {
    const workspace = await readWorkspace(req.userId);
    if (!workspace) {
      return res.status(404).json({ error: "No workspace yet. Save from the client first." });
    }
    res.json({
      notes: workspace.notes,
      activeId: workspace.activeId,
      updatedAt: workspace.updatedAt,
    });
  } catch {
    res.status(500).json({ error: "Failed to load notes" });
  }
});

/** PUT /api/notes — replace workspace snapshot for authenticated user */
router.put("/", async (req, res) => {
  const err = validateNotesPayload(req.body);
  if (err) return res.status(400).json({ error: err });

  const { notes, activeId } = req.body;
  const hasActive = notes.some(n => String(n.id) === String(activeId));
  if (!hasActive && notes.length > 0) {
    return res.status(400).json({ error: "activeId must match a note in notes" });
  }

  const notesJson = JSON.stringify(notes);
  if (notesJson.length > 5 * 1024 * 1024) {
    return res.status(413).json({ error: "Workspace exceeds 5 MB limit" });
  }

  try {
    const { updatedAt } = await writeWorkspace(req.userId, notes, activeId);
    res.json({ ok: true, updatedAt });
  } catch {
    res.status(500).json({ error: "Failed to save notes" });
  }
});

export default router;
