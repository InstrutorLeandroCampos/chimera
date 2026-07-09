/**
 * WebRTC Player (specs/projeto.md §5.2): renders the incoming MediaStream
 * into the <video> element. Fullscreen and connection-stats overlay land in
 * later phases (§5.2, Fase 6) — Fase 1 only needs the stream on screen.
 */
export function attachStream(videoEl, stream) {
  videoEl.srcObject = stream;
  videoEl.play().catch((err) => console.error("[chimera] video play() failed", err));
}
