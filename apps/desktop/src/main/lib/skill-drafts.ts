import { generateText } from "ai";
import { SettingKey, type SkillDraftRequest, type SkillDraftResult } from "../../shared/types";
import { getSetting } from "./db";
import { resolveModel } from "./providers";

export async function generateSkillDraft(input: SkillDraftRequest): Promise<SkillDraftResult> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Prompt is required.");
  const modelRef = getSetting(SettingKey.SelectedModel);
  if (!modelRef) throw new Error("Select a model before creating a skill with AI.");
  const resolved = resolveModel(modelRef);
  const result = await generateText({
    model: resolved.model,
    system:
      "Create a Codex SKILL.md file. Return only markdown. The file must start with YAML frontmatter containing exactly name and description, followed by concise operational instructions. Use lowercase hyphen-case for name.",
    prompt:
      "Create a skill for this request:\n\n" +
      prompt +
      "\n\nReturn a complete SKILL.md. Do not wrap it in a code fence.",
    temperature: 0.4,
    maxOutputTokens: Math.min(resolved.maxOutputTokens, 2_000),
    providerOptions: resolved.providerOptions,
  });
  return { markdown: stripCodeFence(result.text).trim() };
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return match ? (match[1] ?? "") : trimmed;
}
