import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { CaptureOptions, CaptureResult, ICaptureSource } from "../ICaptureSource.js";
import { detectWindowsCaptureInput, type WindowsCaptureInput } from "./detectCaptureInput.js";

/**
 * Windows screen capture backed by FFmpeg. Prefers `ddagrab` (DXGI Desktop
 * Duplication — lower overhead, GPU-side frames) and falls back to `gdigrab`
 * when the local FFmpeg build wasn't compiled with ddagrab support.
 *
 * Fase 0 scope: captures straight to an mp4 file via libx264 to validate that
 * screen capture works end-to-end. Hardware-encoder selection and live
 * WebRTC packetization arrive in later phases (see encoding/HardwareEncoderDetector).
 */
export class DesktopDuplicationCapture implements ICaptureSource {
  private process: ChildProcessWithoutNullStreams | null = null;
  private currentOutputPath: string | null = null;
  private startedAt = 0;

  async start(options: CaptureOptions): Promise<void> {
    if (this.process) {
      throw new Error("Capture already in progress");
    }

    await mkdir(dirname(options.outputPath), { recursive: true });

    const input = await detectWindowsCaptureInput();
    const args = buildFfmpegArgs(input, options);

    this.process = spawn("ffmpeg", args, { windowsHide: true });
    this.currentOutputPath = options.outputPath;
    this.startedAt = Date.now();

    return new Promise((resolve, reject) => {
      const proc = this.process!;
      let stderrTail = "";

      proc.stderr.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-4000);
      });

      proc.once("spawn", () => resolve());
      proc.once("error", (err) => {
        this.process = null;
        reject(err);
      });
      proc.once("exit", (code) => {
        if (code !== 0 && code !== null) {
          console.error(`[capture] ffmpeg exited with code ${code}:\n${stderrTail}`);
        }
        this.process = null;
      });
    });
  }

  async stop(): Promise<CaptureResult> {
    if (!this.process || !this.currentOutputPath) {
      throw new Error("No capture in progress");
    }

    const proc = this.process;
    const outputPath = this.currentOutputPath;
    const durationSeconds = (Date.now() - this.startedAt) / 1000;

    await new Promise<void>((resolve) => {
      proc.once("exit", () => resolve());
      // 'q' triggers a graceful stop so ffmpeg finalizes the mp4 container.
      proc.stdin.write("q");
      setTimeout(() => {
        if (!proc.killed) proc.kill();
        resolve();
      }, 5000);
    });

    this.process = null;
    this.currentOutputPath = null;
    return { outputPath, durationSeconds };
  }

  isCapturing(): boolean {
    return this.process !== null;
  }
}

function buildFfmpegArgs(input: WindowsCaptureInput, options: CaptureOptions): string[] {
  const common = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "warning",
    "-vf",
    "format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
  ];

  const durationArgs = options.durationSeconds ? ["-t", String(options.durationSeconds)] : [];

  if (input === "ddagrab") {
    return [
      "-f",
      "lavfi",
      "-i",
      `ddagrab=output_idx=${options.monitorIndex}:framerate=${options.fps}`,
      ...durationArgs,
      ...common,
      options.outputPath,
    ];
  }

  return [
    "-f",
    "gdigrab",
    "-framerate",
    String(options.fps),
    "-i",
    "desktop",
    ...durationArgs,
    ...common,
    options.outputPath,
  ];
}
