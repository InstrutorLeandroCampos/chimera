/**
 * Connection Manager (specs/projeto.md §5.4): owns the WebSocket signaling
 * channel and the RTCPeerConnection, drives the offer/answer + trickle-ICE
 * exchange, and surfaces track/state/error events to whoever renders the UI.
 * Fase 1 scope: no reconnection logic yet (that's Fase 6 polish).
 */
export class ConnectionManager extends EventTarget {
  #wsUrl;
  #ws = null;
  #pc = null;

  constructor(wsUrl) {
    super();
    this.#wsUrl = wsUrl;
  }

  connect() {
    this.#ws = new WebSocket(this.#wsUrl);
    this.#pc = new RTCPeerConnection();

    this.#pc.ontrack = (event) => {
      this.dispatchEvent(new CustomEvent("track", { detail: event.streams[0] }));
    };

    this.#pc.onicecandidate = (event) => {
      this.#send({ type: "ice-candidate", candidate: event.candidate });
    };

    this.#pc.onconnectionstatechange = () => {
      this.dispatchEvent(new CustomEvent("statechange", { detail: this.#pc.connectionState }));
    };

    this.#ws.addEventListener("open", () => this.dispatchEvent(new CustomEvent("open")));
    this.#ws.addEventListener("close", () => this.dispatchEvent(new CustomEvent("close")));
    this.#ws.addEventListener("error", () => {
      this.dispatchEvent(new CustomEvent("error", { detail: "websocket_error" }));
    });
    this.#ws.addEventListener("message", (event) => this.#handleMessage(event));
  }

  async #handleMessage(event) {
    const message = JSON.parse(event.data);

    switch (message.type) {
      case "offer": {
        await this.#pc.setRemoteDescription(message.sdp);
        await this.#pc.setLocalDescription(await this.#pc.createAnswer());
        this.#send({ type: "answer", sdp: this.#pc.localDescription });
        break;
      }
      case "ice-candidate": {
        if (message.candidate) {
          await this.#pc.addIceCandidate(message.candidate);
        }
        break;
      }
      case "error": {
        this.dispatchEvent(new CustomEvent("error", { detail: message.message }));
        break;
      }
    }
  }

  #send(message) {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(message));
    }
  }

  close() {
    this.#ws?.close();
    this.#pc?.close();
  }
}
