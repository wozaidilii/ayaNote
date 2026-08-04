export type DriveFileLike = {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
};

export function nameHintsForStudent(studentName: string): string[] {
  const raw = studentName.trim();
  const parts = raw
    .replace(/[\[\]]/g, " ")
    .split(/[\s_・]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && !/^(さん|様|lesson|japanese|日本語)$/i.test(p));
  return Array.from(new Set([raw, ...parts])).filter(Boolean);
}

export function scoreDriveFile(
  file: DriveFileLike,
  opts: { endMs: number; hints: string[]; windowMs: number },
): number {
  const name = file.name.toLowerCase();
  let score = 0;
  const mod = file.modifiedTime
    ? new Date(file.modifiedTime).getTime()
    : file.createdTime
      ? new Date(file.createdTime).getTime()
      : 0;
  if (mod) {
    const delta = Math.abs(mod - opts.endMs);
    if (delta <= opts.windowMs) score += 100 - Math.min(90, delta / (60_000 * 2));
    else if (delta <= opts.windowMs * 2) score += 20;
  }
  for (const hint of opts.hints) {
    const h = hint.toLowerCase();
    if (h.length >= 2 && name.includes(h)) score += 40;
  }
  if (/transcript|文字起こし|文字记录|gemini|meet recording|議事録/.test(name)) score += 35;
  if (/doc|notes/.test(name)) score += 5;
  return score;
}

export const DRIVE_MATCH_MIN_SCORE = 25;

/** Pick the best Drive Doc candidate, or null if below the confidence floor. */
export function pickBestDriveTranscript(
  files: DriveFileLike[],
  opts: { endsAt: Date; studentName: string; windowMs?: number },
): { file: DriveFileLike; score: number } | null {
  if (files.length === 0) return null;
  const hints = nameHintsForStudent(opts.studentName);
  const windowMs = opts.windowMs ?? 4 * 60 * 60 * 1000;
  const endMs = opts.endsAt.getTime();
  const ranked = files
    .map((f) => ({ f, score: scoreDriveFile(f, { endMs, hints, windowMs }) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < DRIVE_MATCH_MIN_SCORE) return null;
  return { file: best.f, score: best.score };
}
