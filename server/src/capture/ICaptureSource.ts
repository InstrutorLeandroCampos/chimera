export interface CaptureOptions {
  /** Index of the monitor to capture, 0-based. */
  monitorIndex: number;
  /** Target frames per second. */
  fps: number;
  /** Absolute path where the captured output should be written. */
  outputPath: string;
  /** Capture duration in seconds. Omit for an unbounded capture (stopped via stop()). */
  durationSeconds?: number;
}

export interface CaptureResult {
  outputPath: string;
  durationSeconds: number;
}

/**
 * Abstraction over an OS-native screen capture backend. Windows implements this
 * via FFmpeg (ddagrab/gdigrab); Linux (Fase 7) will implement it via x11grab/PipeWire
 * without requiring changes to any caller of this interface.
 */
export interface ICaptureSource {
  start(options: CaptureOptions): Promise<void>;
  stop(): Promise<CaptureResult>;
  isCapturing(): boolean;
}
