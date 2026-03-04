import OpenAI from "openai";

/**
 * OpenAI client singleton for server-side API routes.
 * API key must be set in .env.local as OPENAI_API_KEY.
 * Uses placeholder during build when env is not available.
 */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "sk-placeholder-for-build",
});

export default openai;
