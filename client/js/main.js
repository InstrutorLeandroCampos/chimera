import { ConnectionManager } from "./connection.js";
import { attachStream } from "./player.js";

const statusPage = document.querySelector(".status-page");
const statusMessage = document.querySelector(".status-page__message");
const video = document.getElementById("player");

const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
const connection = new ConnectionManager(`${wsProtocol}://${location.host}/ws`);

connection.addEventListener("open", () => {
  statusMessage.textContent = "Conectando ao stream...";
});

connection.addEventListener("track", (event) => {
  attachStream(video, event.detail);
  video.hidden = false;
  statusPage.hidden = true;
});

connection.addEventListener("statechange", (event) => {
  console.log("[chimera] connectionState:", event.detail);
});

connection.addEventListener("error", (event) => {
  console.error("[chimera] connection error:", event.detail);
  statusMessage.textContent =
    event.detail === "session_busy" ? "Já existe uma sessão ativa no Host." : "Erro de conexão com o Host.";
});

connection.addEventListener("close", () => {
  video.hidden = true;
  statusPage.hidden = false;
  statusMessage.textContent = "Desconectado do Host.";
});

connection.connect();
