import { spawn } from "node:child_process";

export type HardwareEncoder = "h264_nvenc" | "h264_qsv" | "h264_amf" | "libx264";

export interface EncoderProbeResult {
  encoder: HardwareEncoder;
  hardware: boolean;
}

const HARDWARE_ENCODERS: HardwareEncoder[] = ["h264_nvenc", "h264_qsv", "h264_amf"];

/**
 * Probes FFmpeg's H.264 encoders in priority order (NVENC > QSV > AMF) by
 * actually attempting a 1-frame null encode — listing under `ffmpeg -encoders`
 * only proves the encoder was compiled in, not that a compatible driver/GPU
 * is present. Falls back to libx264 (software) when no hardware encoder works.
 */
export async function detectBestEncoder(): Promise<EncoderProbeResult> {
  for (const encoder of HARDWARE_ENCODERS) {
    if (await canEncode(encoder)) {
      return { encoder, hardware: true };
    }
  }
  return { encoder: "libx264", hardware: false };
}

function canEncode(encoder: HardwareEncoder): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "nullsrc=s=320x240:d=1",
      "-c:v",
      encoder,
      "-f",
      "null",
      "-",
    ]);

    proc.once("close", (code) => resolve(code === 0));
    proc.once("error", () => resolve(false));
  });
}
