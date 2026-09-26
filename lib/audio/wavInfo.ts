export type WavInfo = {
  audioFormat: number; // 1 = PCM
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataBytes: number;
  durationMs: number;
};

/** Minimal RIFF/WAVE header parser (walks chunks to find `fmt ` and `data`). */
export function parseWav(buf: Buffer): WavInfo {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file");
  }
  let offset = 12;
  let fmt: Omit<WavInfo, "dataBytes" | "durationMs"> | null = null;
  let dataBytes: number | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      dataBytes = Math.min(size, buf.length - body);
      break;
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || dataBytes === null) throw new Error("WAV missing fmt or data chunk");
  const bytesPerSec = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8);
  return { ...fmt, dataBytes, durationMs: Math.round((dataBytes / bytesPerSec) * 1000) };
}

/** Peak and RMS level (0–1) of a 16-bit PCM WAV — used to catch silent/muted-mic recordings. */
export function audioLevel(buf: Buffer): { peak: number; rms: number } {
  const info = parseWav(buf);
  if (info.bitsPerSample !== 16) return { peak: 1, rms: 1 }; // only 16-bit is measured
  const start = buf.indexOf("data", 12, "ascii") + 8;
  const end = Math.min(buf.length, start + info.dataBytes) & ~1;
  let peak = 0;
  let sumSq = 0;
  let n = 0;
  for (let i = start; i + 1 < end; i += 2) {
    const s = buf.readInt16LE(i) / 32768;
    const a = Math.abs(s);
    if (a > peak) peak = a;
    sumSq += s * s;
    n++;
  }
  return { peak, rms: n ? Math.sqrt(sumSq / n) : 0 };
}

/** Throws unless the buffer is the WAV we produce (mono s16 PCM, 16/24kHz, <=10 min, <=32MB). */
export function assertTranscribableWav(buf: Buffer): WavInfo {
  const info = parseWav(buf);
  const problems: string[] = [];
  if (info.audioFormat !== 1) problems.push(`format ${info.audioFormat} (need PCM=1)`);
  if (info.channels !== 1) problems.push(`${info.channels} channels (need mono)`);
  if (info.bitsPerSample !== 16) problems.push(`${info.bitsPerSample}-bit (need 16)`);
  if (info.sampleRate !== 16000 && info.sampleRate !== 24000) problems.push(`${info.sampleRate}Hz (need 16k/24k)`);
  if (info.durationMs > 10 * 60_000) problems.push("longer than 10 minutes");
  if (buf.length > 32 * 1024 * 1024) problems.push("larger than 32MB");
  if (problems.length) throw new Error(`Unsupported WAV: ${problems.join(", ")}`);
  return info;
}
