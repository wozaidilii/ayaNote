/**
 * Speech-to-text for classroom audio uploads.
 * Prefers OpenAI Whisper; falls back to Deepgram if configured.
 */

export type SttResult =
  | { ok: true; text: string; provider: "whisper" | "deepgram" }
  | { ok: false; error: string };

export function sttConfigured() {
  return Boolean(process.env.OPENAI_API_KEY || process.env.DEEPGRAM_API_KEY);
}

export async function transcribeAudioFile(
  file: Blob,
  filename: string,
): Promise<SttResult> {
  if (process.env.OPENAI_API_KEY) {
    return whisperTranscribe(file, filename);
  }
  if (process.env.DEEPGRAM_API_KEY) {
    return deepgramTranscribe(file, filename);
  }
  return {
    ok: false,
    error: "No STT key configured (set OPENAI_API_KEY or DEEPGRAM_API_KEY)",
  };
}

async function whisperTranscribe(
  file: Blob,
  filename: string,
): Promise<SttResult> {
  const form = new FormData();
  form.append("file", file, filename || "classroom.webm");
  form.append("model", "whisper-1");
  form.append("language", "ja");
  form.append("response_format", "text");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return {
      ok: false,
      error: `Whisper failed (${res.status}): ${detail.slice(0, 300)}`,
    };
  }

  const text = (await res.text()).trim();
  if (!text) return { ok: false, error: "Whisper returned empty transcript" };
  return { ok: true, text, provider: "whisper" };
}

async function deepgramTranscribe(
  file: Blob,
  filename: string,
): Promise<SttResult> {
  const buf = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || "audio/webm";
  const params = new URLSearchParams({
    model: "nova-2",
    language: "ja",
    punctuate: "true",
    utterances: "true",
  });

  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      "Content-Type": contentType,
    },
    body: buf,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return {
      ok: false,
      error: `Deepgram failed (${res.status}): ${detail.slice(0, 300)}`,
    };
  }

  const data = (await res.json()) as {
    results?: {
      channels?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
    };
  };
  const text =
    data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
  if (!text) return { ok: false, error: "Deepgram returned empty transcript" };
  void filename;
  return { ok: true, text, provider: "deepgram" };
}
