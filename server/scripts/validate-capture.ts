import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopDuplicationCapture } from "../src/capture/windows/DesktopDuplicationCapture.js";
import config from "../src/config/config.json" with { type: "json" };

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const outputDir = join(__dirname, config.capture.outputDir);
const outputPath = join(outputDir, `capture-test-${Date.now()}.mp4`);
const durationSeconds = 5;

console.log(`Capturing ${durationSeconds}s of monitor ${config.capture.monitorIndex} to ${outputPath} ...`);

const capture = new DesktopDuplicationCapture();
await capture.start({
  monitorIndex: config.capture.monitorIndex,
  fps: config.capture.fps,
  outputPath,
  durationSeconds,
});

await new Promise((resolve) => setTimeout(resolve, (durationSeconds + 1) * 1000));

if (capture.isCapturing()) {
  const result = await capture.stop();
  console.log(`Capture finished (stopped manually): ${result.outputPath} (${result.durationSeconds.toFixed(1)}s)`);
} else {
  console.log(`Capture finished on its own (duration limit reached): ${outputPath}`);
}
