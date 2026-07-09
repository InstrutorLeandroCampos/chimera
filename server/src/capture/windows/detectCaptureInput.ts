import { spawn } from "node:child_process";

export type WindowsCaptureInput = "ddagrab" | "gdigrab";

/**
 * Probes whether the local FFmpeg build was compiled with `ddagrab` (DXGI
 * Desktop Duplication) support. FFmpeg prints "Unknown format 'ddagrab'."
 * on stderr when the demuxer is missing — that string, not "unknown
 * demuxer", is what actually appears, which is easy to get wrong.
 */
export async function detectWindowsCaptureInput(): Promise<WindowsCaptureInput> {
  const supportsDdagrab = await new Promise<boolean>((resolve) => {
    const proc = spawn("ffmpeg", ["-hide_banner", "-h", "demuxer=ddagrab"]);
    let output = "";
    proc.stdout.on("data", (c) => (output += c));
    proc.stderr.on("data", (c) => (output += c));
    proc.once("close", () => resolve(!/unknown format/i.test(output)));
    proc.once("error", () => resolve(false));
  });

  return supportsDdagrab ? "ddagrab" : "gdigrab";
}
