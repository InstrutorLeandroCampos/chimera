# Chimera — Especificação Técnica (specs.md)

> Sistema open source de streaming de jogos (inspirado em Moonlight/Sunshine), composto por um servidor Node.js que captura, codifica e transmite a tela + áudio do computador do usuário, e um web client que exibe a biblioteca de jogos, gerencia a conexão e envia inputs de volta ao servidor.

---

## 1. Visão Geral

O Chimera permite que um usuário jogue jogos instalados em um computador (o **Host**) a partir de qualquer navegador na mesma rede local (o **Client**), sem instalar nenhum software adicional no dispositivo cliente. O Host captura a tela via APIs nativas do sistema operacional, codifica o vídeo em H.264 (com aceleração de hardware quando disponível) e transmite via WebRTC. O Client captura inputs de gamepad, teclado e mouse e os envia de volta ao Host, que os injeta no sistema operacional como se fossem inputs físicos.

### 1.1 Objetivo do MVP

Permitir que um usuário, a partir de um navegador na mesma rede local, veja a lista de jogos instalados no Host, inicie um deles, jogue via stream de vídeo+áudio com a menor latência possível, e controle o jogo usando gamepad, teclado e mouse — tudo sem autenticação, com suporte a **uma única sessão ativa por vez**.

### 1.2 Fora de escopo no MVP

- Streaming pela internet (NAT traversal, STUN/TURN, relay servers)
- Múltiplas sessões simultâneas
- Autenticação / múltiplos usuários
- Suporte a Linux no Host (fica para a Fase 2)
- Integração com Steam ou outras plataformas de jogos
- Clientes mobile nativos (apenas navegador, incluindo mobile browser)
- Configuração de qualidade adaptativa dinâmica (bitrate ladder)

---

## 2. Arquitetura Geral

```
┌─────────────────────────────────────────────────────────────┐
│                         HOST (Servidor)                      │
│                                                                │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐ │
│  │ Screen        │   │ FFmpeg        │   │ Input Injector    │ │
│  │ Capture       │──▶│ Encoder       │   │ (SendInput/       │ │
│  │ (Desktop      │   │ (NVENC/QSV/   │   │  ViGEmBus)        │ │
│  │ Duplication)  │   │  libx264)     │   │                    │ │
│  └──────────────┘   └───────┬──────┘   └────────▲──────────┘ │
│                              │                    │            │
│  ┌──────────────┐   ┌───────▼────────────────────┴──────────┐│
│  │ Game          │   │      Node.js Core Server              ││
│  │ Discovery     │◀──┤  - HTTP API (REST)                    ││
│  │ (folder scan) │   │  - WebSocket (signaling + input)      ││
│  └──────────────┘   │  - WebRTC Media Server (video+audio)   ││
│                      └──────────────────┬─────────────────────┘│
└─────────────────────────────────────────┼──────────────────────┘
                                           │ LAN
                          WebSocket (signaling/input) + WebRTC (media)
                                           │
┌──────────────────────────────────────────▼──────────────────────┐
│                       CLIENT (Navegador)                         │
│                                                                    │
│  ┌────────────────┐  ┌─────────────────┐  ┌───────────────────┐ │
│  │ Game Library UI │  │ WebRTC Player   │  │ Input Capture      │ │
│  │ (lista/seleção) │  │ (video/audio    │  │ (Gamepad API,      │ │
│  │                 │  │  <video> tag)   │  │  keydown/mouse)    │ │
│  └────────────────┘  └─────────────────┘  └───────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### 2.1 Princípios de design

- **Separação clara** entre captura (screen capture), processamento (encoding) e transporte (WebRTC/WebSocket) — cada um deve ser um módulo substituível.
- **Host é "burro" no MVP**: sem lógica de negócio complexa, sem persistência em banco de dados. Configuração via arquivo JSON local.
- **Client é fino**: toda lógica pesada (encoding, captura, injeção de input) vive no servidor. O client só exibe vídeo e captura/envia eventos de input.
- **Abstração de SO desde o início**, mesmo implementando Windows primeiro — módulos de captura e injeção de input devem ter uma interface comum para facilitar a Fase 2 (Linux).

---

## 3. Stack Tecnológica

| Camada | Tecnologia | Observação |
|---|---|---|
| Servidor (runtime) | Node.js (LTS) | TypeScript recomendado para robustez |
| Captura de tela (Windows) | Desktop Duplication API | via binding nativo ou FFmpeg `ddagrab`/`gdigrab` |
| Encoding de vídeo | FFmpeg (child process) | H.264, NVENC/QuickSync com fallback pra libx264 |
| Transporte de mídia | WebRTC | vídeo + áudio em um único peer connection |
| Signaling / Input | WebSocket | canal separado de dados (SDP exchange, ICE candidates, eventos de input) |
| Injeção de input (Windows) | SendInput (teclado/mouse) + ViGEmBus (gamepad virtual) | requer driver ViGEmBus instalado no Host |
| Client | HTML5 + Vanilla JS | sem framework — usar Web Components se precisar de organização |
| Captura de input (Client) | Web Gamepad API, eventos de teclado/mouse do DOM | |
| Descoberta de jogos | Scan de pastas configuráveis | arquivo de config lista diretórios + extensões (.exe) |
| Configuração | JSON local (`config.json`) | sem banco de dados no MVP |

---

## 4. Componentes do Servidor (Host)

### 4.1 Screen Capture Module

- Responsável por capturar frames da tela em tempo real.
- **Windows**: usa Desktop Duplication API (via FFmpeg `ddagrab` input ou binding nativo N-API caso a performance do FFmpeg não seja suficiente).
- Deve expor uma interface abstrata (`ICaptureSource`) para permitir implementação futura em Linux (X11 `x11grab` / Wayland via PipeWire).
- Configurável: monitor alvo (multi-monitor), resolução de captura, FPS alvo (30/60).

### 4.2 Encoding Module (FFmpeg Wrapper)

- Processo FFmpeg gerenciado como child_process, recebendo o stream de captura via pipe ou captura direta pelo próprio FFmpeg.
- Codec: H.264 (`baseline`/`main` profile para compatibilidade ampla com browsers).
- Estratégia de hardware: tentar NVENC (NVIDIA) ou QuickSync (Intel) primeiro; se falhar (driver ausente, GPU não suportada), fazer fallback automático para `libx264` com preset `ultrafast`/`veryfast` para minimizar latência.
- Output do FFmpeg deve ser compatível com o pipeline WebRTC (pacotização RTP) — avaliar se usar FFmpeg puro + biblioteca WebRTC Node (ex: `werift`, `wrtc`) para empacotar os frames codificados nos tracks de vídeo/áudio.
- Captura de áudio do sistema: usar dispositivo de loopback (Windows: WASAPI loopback) como input de áudio do FFmpeg, codificado em Opus para o track de áudio do WebRTC.

### 4.3 Input Injector Module

- Recebe eventos de input do Client via WebSocket (canal de dados) e injeta no sistema operacional do Host.
- **Teclado/Mouse (Windows)**: via `SendInput` (binding nativo, ex: através de um módulo N-API ou biblioteca como `robotjs`/similar mantida).
- **Gamepad (Windows)**: via **ViGEmBus** — cria um gamepad virtual (Xbox 360 controller) que o SO/jogo enxerga como um controle físico. Requer que o usuário instale o driver ViGEmBus separadamente (documentar isso no README).
- Deve traduzir os eventos abstratos recebidos do Client (ex: `{type: "gamepad_button", button: "A", pressed: true}`) para as chamadas nativas correspondentes.
- Interface abstrata (`IInputInjector`) para permitir implementação futura em Linux (`uinput`).

### 4.4 Game Discovery Module

- Lê uma lista de diretórios configurados pelo usuário (`config.json`) e faz scan recursivo procurando por executáveis (`.exe` no MVP).
- Gera metadados básicos por jogo: nome (derivado do nome do arquivo ou pasta), caminho do executável, opcionalmente um ícone extraído do próprio `.exe`.
- Expõe endpoint REST `GET /api/games` retornando a lista.
- **Fase futura**: permitir metadados manuais via `games.json` (nome customizado, capa, categoria).

### 4.5 Session Manager

- Controla o ciclo de vida de uma sessão de streaming: início, jogo em execução, encerramento.
- MVP: apenas **uma sessão ativa por vez** — se um segundo client tentar conectar enquanto há sessão ativa, retornar erro/estado "ocupado".
- Ao iniciar sessão:
  1. Recebe `POST /api/session/start` com `gameId`.
  2. Spawna o processo do jogo (`child_process.spawn` do executável).
  3. Inicia captura de tela + encoding + WebRTC peer connection.
  4. Monitora o processo do jogo — ao detectar que ele fechou, encerra a sessão automaticamente e notifica o Client via WebSocket.
- Ao encerrar sessão (manual ou automático): mata o processo do jogo (opcional/configurável), para captura/encoding, fecha peer connection WebRTC.

### 4.6 API do Servidor

**REST (HTTP):**
- `GET /api/games` — lista jogos disponíveis
- `POST /api/session/start` — inicia sessão `{ gameId }`
- `POST /api/session/stop` — encerra sessão ativa
- `GET /api/session/status` — estado atual (ocioso / em jogo / jogo ativo)

**WebSocket (`/ws`):**
- Canal de signaling WebRTC: troca de SDP offer/answer, ICE candidates.
- Canal de input: eventos de gamepad, teclado e mouse do Client para o Host.
- Canal de status: notificações do Host para o Client (jogo fechou, erro de encoding, etc).

---

## 5. Componentes do Client (Web)

### 5.1 Game Library UI

- Tela inicial: grid/lista dos jogos retornados por `GET /api/games`.
- Ao clicar em um jogo: chama `POST /api/session/start`, aguarda confirmação, transiciona para a tela de streaming.

### 5.2 WebRTC Player

- Estabelece `RTCPeerConnection`, troca SDP/ICE via WebSocket com o Host.
- Recebe tracks de vídeo e áudio, renderiza em um elemento `<video>` full-screen.
- Deve suportar modo fullscreen nativo do browser (`requestFullscreen`).
- Exibir indicador de latência/estatísticas de conexão (via `RTCPeerConnection.getStats()`) — útil para debug, pode ser um overlay togglável.

### 5.3 Input Capture

- **Gamepad**: usa a [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API), fazendo polling (`requestAnimationFrame` + `navigator.getGamepads()`) já que a API não é event-driven para eixos/botões analógicos.
- **Teclado**: captura `keydown`/`keyup` do documento (com `preventDefault` para evitar comportamentos padrão do browser durante o jogo).
- **Mouse**: captura `mousemove` (delta de movimento, idealmente via Pointer Lock API para melhor precisão em jogos), `mousedown`/`mouseup`.
- Todos os eventos são serializados em um formato compacto e enviados via WebSocket com a menor latência possível (evitar buffering — enviar imediatamente a cada evento/frame de polling).
- Formato sugerido de evento:
  ```json
  { "type": "gamepad", "index": 0, "buttons": [...], "axes": [...] }
  { "type": "keyboard", "key": "KeyW", "pressed": true }
  { "type": "mouse", "dx": 5, "dy": -2, "buttons": 0 }
  ```

### 5.4 Connection Manager

- Gerencia o estado da conexão WebSocket + WebRTC (conectando, conectado, reconectando, erro).
- Deve lidar com quedas de conexão de forma resiliente (tentar reconectar o WebSocket; se o peer connection cair, oferecer opção de renegociar).

---

## 6. Protocolo de Comunicação

### 6.1 Fluxo de uma sessão (sequência)

1. Client carrega a página → `GET /api/games` → renderiza biblioteca.
2. Usuário seleciona jogo → Client abre WebSocket (`/ws`) se ainda não estiver aberto.
3. Client → `POST /api/session/start { gameId }`.
4. Host spawna o processo do jogo e inicia captura/encoding.
5. Host cria `RTCPeerConnection`, gera SDP offer, envia via WebSocket.
6. Client recebe offer, cria seu `RTCPeerConnection`, gera answer, envia via WebSocket.
7. Troca de ICE candidates via WebSocket (ambos os lados).
8. Conexão WebRTC estabelecida → vídeo/áudio começam a fluir para o Client.
9. Client começa a capturar e enviar inputs via WebSocket.
10. Host injeta inputs recebidos no sistema operacional.
11. Encerramento: usuário fecha o jogo (no Host) ou clica em "sair" (no Client) → Host detecta/recebe comando → encerra processo, para encoding, fecha peer connection → notifica Client via WebSocket → Client volta para a Game Library.

### 6.2 Por que WebSocket + WebRTC juntos?

- **WebRTC** carrega a mídia (vídeo/áudio) porque é otimizado para baixa latência em tempo real (UDP-based, com jitter buffer, FEC, etc — muito melhor que WebSocket puro para isso).
- **WebSocket** carrega o signaling (necessário para estabelecer o WebRTC) e os eventos de input, que são pequenos, frequentes e toleram a leve latência adicional do TCP-based WebSocket sem problema perceptível — e simplificam a implementação (não é necessário criar um DataChannel WebRTC separado no MVP, embora isso possa ser uma otimização futura).

---

## 7. Estrutura de Pastas do Projeto (sugerida)

```
chimera/
├── specs.md
├── README.md
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                  # entrypoint, sobe HTTP+WS server
│   │   ├── api/
│   │   │   ├── games.routes.ts
│   │   │   └── session.routes.ts
│   │   ├── capture/
│   │   │   ├── ICaptureSource.ts     # interface abstrata
│   │   │   └── windows/
│   │   │       └── DesktopDuplicationCapture.ts
│   │   ├── encoding/
│   │   │   └── FfmpegEncoder.ts
│   │   ├── input/
│   │   │   ├── IInputInjector.ts     # interface abstrata
│   │   │   └── windows/
│   │   │       ├── KeyboardMouseInjector.ts
│   │   │       └── GamepadInjector.ts (ViGEmBus)
│   │   ├── discovery/
│   │   │   └── GameScanner.ts
│   │   ├── session/
│   │   │   └── SessionManager.ts
│   │   ├── webrtc/
│   │   │   └── PeerConnectionManager.ts
│   │   └── config/
│   │       └── config.json
│   └── ...
├── client/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── main.js
│       ├── library.js         # Game Library UI
│       ├── player.js          # WebRTC player
│       ├── input-capture.js   # Gamepad/Keyboard/Mouse capture
│       └── connection.js      # Connection Manager (WS + WebRTC)
└── docs/
    └── setup-windows.md        # instruções (instalar ViGEmBus, drivers, etc)
```

---

## 8. Roadmap de Fases

### Fase 0 — Setup e Prova de Conceito
- Servidor Node.js básico servindo o client estático.
- FFmpeg capturando a tela (via `ddagrab` ou `gdigrab`) e salvando em arquivo local (sem streaming ainda) — validar que a captura funciona.
- Validar detecção de GPU e NVENC disponível.

### Fase 1 — Streaming de Vídeo Básico
- Implementar `PeerConnectionManager` no servidor e handshake WebRTC completo.
- Stream de vídeo (sem áudio, sem input) do Host para o Client via WebRTC.
- Validar latência e estabilidade em rede local.

### Fase 2 — Áudio
- Adicionar captura de áudio (loopback) e track de áudio Opus no WebRTC.

### Fase 3 — Input (Teclado + Mouse)
- Implementar `KeyboardMouseInjector` (SendInput) no servidor.
- Implementar captura de teclado/mouse no client e envio via WebSocket.
- Validar em um jogo simples (ex: um jogo leve que aceite teclado/mouse).

### Fase 4 — Input (Gamepad)
- Integrar ViGEmBus e `GamepadInjector`.
- Implementar captura via Web Gamepad API no client.
- Validar em jogo com suporte nativo a controle.

### Fase 5 — Game Discovery + Session Manager completo
- Implementar scan de pastas configuráveis.
- Implementar `SessionManager` completo: start/stop, spawn de processo, detecção de fechamento do jogo.
- Game Library UI no client.

### Fase 6 — Polimento do MVP
- Tratamento de erros e reconexão.
- Overlay de estatísticas de conexão (debug).
- Documentação de setup (README, instalação de dependências no Host: FFmpeg, ViGEmBus).

### Fase 7 (pós-MVP) — Linux Support
- Implementar `ICaptureSource` para Linux (X11 `x11grab`, avaliar PipeWire para Wayland).
- Implementar `IInputInjector` para Linux via `uinput`.

### Fase 8 (pós-MVP) — Além do LAN
- STUN/TURN para NAT traversal.
- Autenticação (senha ou contas de usuário).
- Múltiplas sessões simultâneas.

---

## 9. Requisitos do Ambiente (Host)

- Node.js LTS instalado.
- FFmpeg instalado e acessível no `PATH` (com suporte a NVENC/QSV compilado, se disponível).
- **Windows**: driver ViGEmBus instalado (necessário para emulação de gamepad).
- GPU com suporte a NVENC (NVIDIA) ou QuickSync (Intel) recomendado, mas com fallback funcional via `libx264`.

## 10. Requisitos do Ambiente (Client)

- Navegador moderno com suporte a WebRTC e Web Gamepad API (Chrome/Edge recomendados para melhor suporte de Gamepad API).
- Mesma rede local (LAN) do Host.

---

## 11. Critérios de Aceite do MVP

- [ ] Usuário acessa o client via navegador na LAN e vê a lista de jogos do Host.
- [ ] Usuário seleciona um jogo e o stream de vídeo+áudio começa em menos de ~5 segundos.
- [ ] Latência percebida (input → ação na tela) é jogável para jogos não-competitivos (referência: abaixo de ~100-150ms em rede local).
- [ ] Gamepad conectado ao Client controla o jogo no Host corretamente.
- [ ] Teclado e mouse do Client controlam o jogo no Host corretamente.
- [ ] Ao fechar o jogo no Host (ou pedir para sair no Client), a sessão encerra corretamente e o Client volta para a biblioteca.
- [ ] Sistema funciona de ponta a ponta apenas com Node.js + FFmpeg + ViGEmBus instalados no Host, sem dependências no Client além do navegador.

---

## 12. Notas para o Claude Code

- Priorize implementar as interfaces abstratas (`ICaptureSource`, `IInputInjector`) desde o início, mesmo que só a implementação Windows exista — isso evita retrabalho na Fase 7 (Linux).
- Ao lidar com FFmpeg + WebRTC, pesquisar bibliotecas Node maduras para pacotização RTP a partir de um stream FFmpeg (ex: `werift-webrtc`) antes de implementar isso manualmente.
- Testar cada fase do roadmap isoladamente antes de avançar — especialmente a integração FFmpeg → WebRTC, que é historicamente a parte mais delicada desse tipo de projeto.
- Documentar claramente, no README, os pré-requisitos de instalação no Host (FFmpeg no PATH, driver ViGEmBus), já que são dependências externas ao Node.js.
