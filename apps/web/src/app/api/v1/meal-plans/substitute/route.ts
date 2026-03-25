import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { callClaudeText } from "@/lib/anthropic";

const SubstituteSchema = z.object({
  recipeName: z.string().min(1),
  missingIngredient: z.string().min(1),
});

export async function POST(req: NextRequest) {
  await requireAuth(req);
  const json = await req.json().catch(() => null);
  const parsed = SubstituteSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid substitute request." }, { status: 400 });
  }

  const { recipeName, missingIngredient } = parsed.data;

  try {
    const suggestion = await callClaudeText({
      model: "claude-sonnet-4-6",
      system: "You suggest safe, simple recipe substitutions for home cooking. Be concise and practical for parents.",
      userText: `Recipe: ${recipeName}\nMissing ingredient: ${missingIngredient}\nSuggest one or two replacements and a short note on how to use them.`,
      temperature: 0.4,
      maxTokens: 220,
    });

    return NextResponse.json({ suggestion: suggestion.trim() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate substitute." },
      { status: 500 },
    );
  }
}
