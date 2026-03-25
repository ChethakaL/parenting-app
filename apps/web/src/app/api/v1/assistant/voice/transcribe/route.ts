import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY in environment.");
}

type UploadedFile = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  type: string;
  name?: string;
};

function isUploadedFile(v: unknown): v is UploadedFile {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as { arrayBuffer?: unknown; type?: unknown; name?: unknown };
  return typeof obj.arrayBuffer === "function" && typeof obj.type === "string";
}

export async function POST(req: NextRequest) {
  await requireAuth(req);
  const form = await req.formData();

  const audioField = form.get("audio");
  if (!isUploadedFile(audioField)) {
    return NextResponse.json({ error: "Missing `audio` file in multipart form." }, { status: 400 });
  }

  const language = typeof form.get("language") === "string" ? (form.get("language") as string) : undefined;

  const arrayBuffer = await audioField.arrayBuffer();
  const blob = new Blob([arrayBuffer], { type: audioField.type });

  const fd = new FormData();
  fd.append("file", blob, audioField.name ?? "audio.webm");
  fd.append("model", "whisper-1");
  if (language) fd.append("language", language);
  fd.append("response_format", "verbose_json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: fd,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json({ error: `Whisper failed (${res.status}): ${text || "no body"}` }, { status: 500 });
  }

  const data = (await res.json()) as {
    text?: string;
    confidence?: number;
    segments?: Array<{ text?: string; confidence?: number }>;
  };

  const transcript =
    typeof data.text === "string"
      ? data.text
      : data.segments?.map((s) => s.text ?? "").filter(Boolean).join(" ") ?? "";

  const confidence =
    typeof data.confidence === "number"
      ? data.confidence
      : (() => {
          const segConfs = (data.segments ?? []).map((s) => s.confidence).filter((c): c is number => typeof c === "number");
          if (segConfs.length === 0) return 0.8;
          return segConfs.reduce((a, b) => a + b, 0) / segConfs.length;
        })();

  return NextResponse.json({ transcript, confidence });
}

