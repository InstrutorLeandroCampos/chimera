import {
  MediaStreamTrack,
  RTCPeerConnection,
  RTCRtpCodecParameters,
  type RTCIceCandidate,
} from "werift";
import { detectWindowsCaptureInput } from "../capture/windows/detectCaptureInput.js";
import { detectBestEncoder } from "../encoding/HardwareEncoderDetector.js";
import { FfmpegEncoder } from "../encoding/FfmpegEncoder.js";

const H264_PAYLOAD_TYPE = 96;

export type SignalMessage =
  | { type: "offer"; sdp: unknown }
  | { type: "answer"; sdp: unknown }
  | { type: "ice-candidate"; candidate: RTCIceCandidate | null };

export interface PeerConnectionManagerOptions {
  monitorIndex: number;
  fps: number;
  /** Called whenever a signaling message must be sent to the client over the WebSocket. */
  send: (message: SignalMessage) => void;
}

/**
 * Owns one RTCPeerConnection for the single active Fase-1 session: it wires
 * an FfmpegEncoder video track into a sendonly transceiver, drives the
 * SDP offer/answer + trickle-ICE exchange, and tears everything down on stop.
 * Fase 5 (Session Manager) will wrap this with game spawn/lifecycle logic.
 */
export class PeerConnectionManager {
  private pc: RTCPeerConnection;
  private encoder = new FfmpegEncoder();
  private readonly send: (message: SignalMessage) => void;
  private readonly monitorIndex: number;
  private readonly fps: number;

  constructor(options: PeerConnectionManagerOptions) {
    this.send = options.send;
    this.monitorIndex = options.monitorIndex;
    this.fps = options.fps;

    this.pc = new RTCPeerConnection({
      codecs: {
        audio: [],
        video: [
          new RTCRtpCodecParameters({
            mimeType: "video/H264",
            clockRate: 90000,
            payloadType: H264_PAYLOAD_TYPE,
            parameters: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
            rtcpFeedback: [
              { type: "ccm", parameter: "fir" },
              { type: "nack" },
              { type: "nack", parameter: "pli" },
            ],
          }),
        ],
      },
    });

    this.pc.onicecandidate = ({ candidate }) => {
      this.send({ type: "ice-candidate", candidate: candidate ?? null });
    };

    this.pc.onconnectionstatechange = () => {
      console.log(`[webrtc] connectionState: ${this.pc.connectionState}`);
    };
    this.pc.oniceconnectionstatechange = () => {
      console.log(`[webrtc] iceConnectionState: ${this.pc.iceConnectionState}`);
    };
  }

  async start(): Promise<void> {
    const [{ encoder }, ddagrab] = await Promise.all([detectBestEncoder(), detectWindowsCaptureInput()]);

    console.log(`[webrtc] streaming with encoder=${encoder} capture=${ddagrab}`);

    const track = new MediaStreamTrack({ kind: "video" });
    this.encoder.on("rtp", (rtp) => track.writeRtp(rtp));
    await this.encoder.start({
      monitorIndex: this.monitorIndex,
      fps: this.fps,
      encoder,
      ddagrabSupported: ddagrab === "ddagrab",
      payloadType: H264_PAYLOAD_TYPE,
    });

    this.pc.addTransceiver(track, { direction: "sendonly" });

    const offer = await this.pc.setLocalDescription(await this.pc.createOffer());
    this.send({ type: "offer", sdp: offer });
  }

  async handleAnswer(sdp: unknown): Promise<void> {
    await this.pc.setRemoteDescription(sdp as never);
  }

  async handleRemoteIceCandidate(candidate: RTCIceCandidate | null): Promise<void> {
    if (!candidate) return;
    await this.pc.addIceCandidate(candidate);
  }

  close(): void {
    this.encoder.stop();
    this.pc.close();
  }
}
