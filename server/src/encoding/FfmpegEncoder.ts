import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createSocket, type Socket } from "node:dgram";
import { EventEmitter } from "node:events";
import { RtpPacket, randomPort } from "werift";
import type { HardwareEncoder } from "./HardwareEncoderDetector.js";

export interface FfmpegEncoderOptions {
  monitorIndex: number;
  fps: number;
  encoder: HardwareEncoder;
  ddagrabSupported: boolean;
  /** RTP payload type to stamp on outgoing packets — must match the SDP-negotiated codec. */
  payloadType: number;
}

/**
 * Fase 1 scope: capture + encode + RTP-packetize the desktop in a single FFmpeg
 * process (gdigrab/ddagrab -> libx264/hw encoder -> `-f rtp`), then relay the
 * UDP RTP packets FFmpeg emits into whatever consumes `on("rtp", ...)`
 * (see webrtc/PeerConnectionManager). Screen capture and encoding stay two
 * conceptually separate FFmpeg stages (capture module vs encoding module per
 * specs/projeto.md §4) but run as one OS process for now — splitting them
 * into a piped two-process pipeline is a later optimization, not a Fase 1
 * requirement.
 */
export class FfmpegEncoder extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private udp: Socket | null = null;

  async start(options: FfmpegEncoderOptions): Promise<void> {
    if (this.process) {
      throw new Error("Encoder already running");
    }

    const port = await randomPort();
    this.udp = createSocket("udp4");
    this.udp.on("message", (data) => {
      const rtp = RtpPacket.deSerialize(data);
      rtp.header.payloadType = options.payloadType;
      this.emit("rtp", rtp);
    });
    await new Promise<void>((resolve) => this.udp!.bind(port, "127.0.0.1", resolve));

    const input = options.ddagrabSupported ? "ddagrab" : "gdigrab";
    const args = buildFfmpegArgs(input, options, port);

    this.process = spawn("ffmpeg", args, { windowsHide: true });

    let stderrTail = "";
    this.process.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });
    this.process.once("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[encoder] ffmpeg exited with code ${code}:\n${stderrTail}`);
      }
      this.process = null;
      this.emit("stopped");
    });

    return new Promise((resolve, reject) => {
      this.process!.once("spawn", () => resolve());
      this.process!.once("error", reject);
    });
  }

  stop(): void {
    this.process?.kill();
    this.process = null;
    this.udp?.close();
    this.udp = null;
  }

  isRunning(): boolean {
    return this.process !== null;
  }
}

const ENCODER_ARGS: Record<HardwareEncoder, string[]> = {
  libx264: ["-preset", "ultrafast", "-tune", "zerolatency", "-x264-params", "repeat-headers=1"],
  h264_nvenc: ["-preset", "p1", "-tune", "ll", "-rc", "cbr"],
  h264_qsv: ["-preset", "veryfast", "-look_ahead", "0"],
  h264_amf: ["-usage", "ultralowlatency", "-quality", "speed"],
};

function buildFfmpegArgs(
  input: "ddagrab" | "gdigrab",
  options: FfmpegEncoderOptions,
  rtpPort: number,
): string[] {
  const captureArgs =
    input === "ddagrab"
      ? ["-f", "lavfi", "-i", `ddagrab=output_idx=${options.monitorIndex}:framerate=${options.fps}`]
      : ["-f", "gdigrab", "-framerate", String(options.fps), "-i", "desktop"];

  const gopSize = options.fps * 2;

  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "warning",
    ...captureArgs,
    "-vf",
    "format=yuv420p",
    "-c:v",
    options.encoder,
    "-profile:v",
    "baseline",
    "-bf",
    "0",
    "-g",
    String(gopSize),
    ...ENCODER_ARGS[options.encoder],
    "-f",
    "rtp",
    `rtp://127.0.0.1:${rtpPort}`,
  ];
}
