import { detectBestEncoder } from "../src/encoding/HardwareEncoderDetector.js";

const result = await detectBestEncoder();

console.log(`Selected encoder: ${result.encoder} (${result.hardware ? "hardware" : "software fallback"})`);
if (!result.hardware) {
  console.log("No usable hardware encoder found (NVENC/QSV/AMF) — falling back to libx264.");
}
