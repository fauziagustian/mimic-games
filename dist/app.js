(() => {
  "use strict";

  const ROUND_COUNT = 8;
  const ROUND_SECONDS = 10;
  const ROUND_BREAK_MS = 2400;
  const MAX_PLAYERS = 8;
  const COLORS = [
    "#ff805d", "#a6e65f", "#67d9e8", "#f7c85b", "#b89bf5", "#ffb073",
    "#7ce3a1", "#fb6c93", "#76a9ff", "#f0e56b", "#8fe3d6", "#e6a3ef"
  ];
  const AVATAR_COLORS = ["#d6ff58", "#75e7e1", "#ff8b6e", "#b89bf5", "#f7c85b", "#7ce3a1", "#76a9ff", "#fb6c93"];
  const $ = (id) => document.getElementById(id);
  const screens = { home: $("homeScreen"), lobby: $("lobbyScreen"), game: $("gameScreen"), results: $("resultsScreen") };

  const me = { id: crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random()}`, name: getStoredName() };
  let peer = null;
  let connection = null;
  let isHost = false;
  let roomCode = "";
  let gameState = null;
  let timerHandle = null;
  let nextRoundHandle = null;
  let toastHandle = null;

  function getStoredName() {
    const saved = localStorage.getItem("pulse-party-name");
    if (saved) return saved;
    const names = ["Nova", "Moss", "Pixel", "Riff", "Sunny", "Echo", "Orbit", "Ziggy"];
    return names[Math.floor(Math.random() * names.length)];
  }

  function setScreen(name) {
    Object.entries(screens).forEach(([key, screen]) => {
      const active = key === name;
      screen.hidden = !active;
      screen.classList.toggle("screen--active", active);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setConnection(state, label) {
    $("connectionState").dataset.state = state;
    $("connectionLabel").textContent = label;
  }

  function showNotice(id, message) {
    $(id).textContent = message || "";
  }

  function toast(message) {
    const node = $("toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toastHandle);
    toastHandle = setTimeout(() => node.classList.remove("show"), 2200);
  }

  function makeRoomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  }

  function peerIdFor(code) { return `pulse-party-${code}`; }

  function createPeer(id, onOpen) {
    if (typeof Peer === "undefined") {
      toast("The multiplayer relay did not load. Refresh and try again.");
      return null;
    }
    const created = new Peer(id, { debug: 0 });
    created.on("open", onOpen);
    created.on("error", (error) => {
      console.warn("Peer error", error);
      if (error.type === "unavailable-id") {
        toast("That room code is busy. Create another room.");
        resetToHome();
      } else if (error.type === "peer-unavailable") {
        showNotice("homeNotice", "Room not found. Check the code and try again.");
        setConnection("offline", "Not connected");
      } else {
        toast("Connection hiccup. Try the room again.");
      }
    });
    created.on("disconnected", () => setConnection("offline", "Relay disconnected"));
    return created;
  }

  function createRoom() {
    if (peer) peer.destroy();
    isHost = true;
    roomCode = makeRoomCode();
    setConnection("connecting", "Opening room…");
    peer = createPeer(peerIdFor(roomCode), () => {
      gameState = {
        phase: "lobby",
        round: 0,
        target: null,
        cards: [],
        deadline: null,
        winnerId: null,
        players: [{ id: me.id, name: me.name, score: 0, host: true, missed: false }]
      };
      setConnection("online", "Room is live");
      showLobby();
      peer.on("connection", (incoming) => {
        incoming.on("open", () => {
          if (gameState.players.length >= MAX_PLAYERS) {
            incoming.send({ type: "notice", message: "This room is full." });
            incoming.close();
            return;
          }
          incoming.playerId = null;
          attachConnection(incoming);
          broadcastState();
        });
      });
    });
  }

  function joinRoom(code) {
    const cleanCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{5,6}$/.test(cleanCode)) {
      showNotice("homeNotice", "Enter the 5-character room code.");
      return;
    }
    if (peer) peer.destroy();
    isHost = false;
    roomCode = cleanCode;
    setConnection("connecting", "Finding room…");
    peer = createPeer(undefined, () => {
      connection = peer.connect(peerIdFor(roomCode), { reliable: true });
      connection.on("open", () => {
        setConnection("online", "Connected to room");
        attachConnection(connection);
        send({ type: "join", player: { id: me.id, name: me.name, score: 0, host: false, missed: false } });
      });
    });
  }

  function attachConnection(conn) {
    connection = conn;
    conn.on("data", handleMessage);
    conn.on("close", () => {
      if (!isHost) {
        setConnection("offline", "Host left");
        toast("The host ended the room.");
        setTimeout(resetToHome, 1800);
      } else if (gameState) {
        const leavingId = conn.playerId;
        if (leavingId) {
          gameState.players = gameState.players.filter((player) => player.id !== leavingId);
          broadcastState();
        }
      }
    });
  }

  function connections() {
    if (!isHost || !peer) return connection ? [connection] : [];
    return Object.values(peer.connections || {}).flat().filter((conn) => conn.open);
  }

  function send(message) {
    if (connection && connection.open) connection.send(message);
  }

  function broadcast(message) {
    connections().forEach((conn) => conn.send(message));
  }

  function broadcastState() {
    if (!gameState) return;
    const snapshot = JSON.parse(JSON.stringify(gameState));
    if (isHost) broadcast({ type: "state", state: snapshot });
    renderState(snapshot);
  }

  function handleMessage(message) {
    if (!message) return;
    if (message.type === "join" && isHost) {
      if (gameState.players.some((player) => player.id === message.player.id)) return;
      const matchingConnection = connections().find((conn) => !conn.playerId);
      if (matchingConnection) matchingConnection.playerId = message.player.id;
      gameState.players.push({ ...message.player, score: 0 });
      broadcastState();
      return;
    }
    if (message.type === "state" && !isHost) {
      renderState(message.state);
      return;
    }
    if (message.type === "start" && isHost) {
      startGame();
      return;
    }
    if (message.type === "guess" && isHost) {
      resolveGuess(message.playerId, message.cardIndex);
      return;
    }
    if (message.type === "play-again" && isHost) {
      startGame();
      return;
    }
    if (message.type === "notice") toast(message.message);
  }

  function showLobby() {
    $("roomCodeDisplay").textContent = roomCode;
    $("startGameButton").hidden = !isHost;
    $("lobbyNotice").textContent = isHost ? "Waiting for at least 2 players…" : "The host will start the race.";
    setScreen("lobby");
    renderLobby(gameState);
  }

  function renderLobby(state) {
    if (!state) return;
    $("roomCodeDisplay").textContent = roomCode;
    $("playerCount").textContent = state.players.length;
    $("playerList").innerHTML = state.players.map((player, index) => `
      <div class="player-row">
        <span class="player-avatar" style="--avatar:${AVATAR_COLORS[index % AVATAR_COLORS.length]}">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span>
        <span class="player-name">${escapeHtml(player.name)}${player.id === me.id ? " (you)" : ""}</span>
        ${player.host ? '<span class="player-tag">host</span>' : ""}
      </div>`).join("");
    if (isHost) {
      const canStart = state.players.length >= 2;
      $("startGameButton").disabled = !canStart;
      $("lobbyNotice").textContent = canStart ? "Everyone’s ready? Start the race." : "Waiting for at least 2 players…";
    }
  }

  function startGame() {
    if (!isHost || !gameState || gameState.players.length < 2) return;
    clearTimeout(nextRoundHandle);
    gameState.phase = "running";
    gameState.round = 1;
    gameState.players.forEach((player) => { player.score = 0; player.missed = false; });
    prepareRound();
  }

  function prepareRound() {
    clearInterval(timerHandle);
    const targetIndex = Math.floor(Math.random() * 12);
    const target = COLORS[targetIndex];
    const cards = COLORS.slice(0, 12).sort(() => Math.random() - 0.5);
    gameState.target = target;
    gameState.cards = cards;
    gameState.deadline = Date.now() + ROUND_SECONDS * 1000;
    gameState.winnerId = null;
    gameState.players.forEach((player) => { player.missed = false; });
    broadcastState();
    timerHandle = setInterval(() => {
      if (!gameState || gameState.phase !== "running") return;
      const remaining = Math.max(0, gameState.deadline - Date.now());
      updateTimer(remaining);
      if (remaining <= 0) finishRound(null);
    }, 100);
  }

  function resolveGuess(playerId, cardIndex) {
    if (!gameState || gameState.phase !== "running" || gameState.winnerId) return;
    const player = gameState.players.find((item) => item.id === playerId);
    if (!player || player.missed || Date.now() > gameState.deadline) return;
    if (gameState.cards[cardIndex] === gameState.target) {
      player.score += 1;
      gameState.winnerId = playerId;
      finishRound(playerId);
    } else {
      player.missed = true;
      broadcastState();
    }
  }

  function finishRound(winnerId) {
    if (!gameState || gameState.phase !== "running") return;
    clearInterval(timerHandle);
    gameState.winnerId = winnerId;
    broadcastState();
    const winner = gameState.players.find((player) => player.id === winnerId);
    const message = winner ? `${winner.name} got it!` : "Time’s up!";
    showRoundMessage(message);
    if (gameState.round >= ROUND_COUNT) {
      gameState.phase = "results";
      gameState.deadline = null;
      nextRoundHandle = setTimeout(() => broadcastState(), ROUND_BREAK_MS);
    } else {
      nextRoundHandle = setTimeout(() => {
        gameState.round += 1;
        prepareRound();
      }, ROUND_BREAK_MS);
    }
  }

  function renderState(state) {
    gameState = state;
    if (state.phase === "lobby") {
      showLobby();
    } else if (state.phase === "running") {
      setScreen("game");
      renderGame(state);
    } else if (state.phase === "results") {
      setScreen("results");
      renderResults(state);
    }
  }

  function renderGame(state) {
    $("roundNumber").textContent = state.round;
    $("targetSwatch").style.background = state.target;
    const board = $("gameBoard");
    board.innerHTML = state.cards.map((color, index) => `<button class="color-card ${state.winnerId || state.players.find((p) => p.id === me.id)?.missed ? "is-muted" : ""}" style="--color:${color}" data-index="${index}" aria-label="Color choice ${index + 1}" ${state.winnerId || state.players.find((p) => p.id === me.id)?.missed ? "disabled" : ""}></button>`).join("");
    board.querySelectorAll(".color-card").forEach((button) => button.addEventListener("click", () => makeGuess(Number(button.dataset.index))));
    renderScores(state);
    updateTimer(Math.max(0, (state.deadline || Date.now()) - Date.now()));
  }

  function renderScores(state) {
    const ordered = [...state.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    $("scoreList").innerHTML = ordered.map((player, index) => `
      <div class="score-row ${player.id === me.id ? "is-me" : ""}">
        <span class="player-avatar" style="--avatar:${AVATAR_COLORS[index % AVATAR_COLORS.length]}">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span>
        <span class="score-name">${escapeHtml(player.name)}${player.id === me.id ? " · you" : ""}</span>
        <span class="score-points">${player.score}</span>
      </div>`).join("");
  }

  function makeGuess(index) {
    const myPlayer = gameState?.players.find((player) => player.id === me.id);
    if (!gameState || gameState.phase !== "running" || gameState.winnerId || myPlayer?.missed) return;
    if (isHost) resolveGuess(me.id, index);
    else send({ type: "guess", playerId: me.id, cardIndex: index });
    const clicked = $("gameBoard").querySelector(`[data-index="${index}"]`);
    if (clicked) clicked.classList.add("is-picked");
  }

  function updateTimer(milliseconds) {
    $("timerValue").textContent = (milliseconds / 1000).toFixed(1);
  }

  function showRoundMessage(message) {
    const node = $("roundMessage");
    node.textContent = message;
    node.classList.remove("show");
    void node.offsetWidth;
    node.classList.add("show");
  }

  function renderResults(state) {
    const ordered = [...state.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const champion = ordered[0];
    $("resultsSubtitle").textContent = champion ? `${champion.name} takes the crown with ${champion.score} point${champion.score === 1 ? "" : "s"}.` : "The room’s fastest eyes have been crowned.";
    $("finalScoreList").innerHTML = ordered.map((player, index) => `
      <div class="final-score-row"><span class="final-rank">${index + 1}</span><span class="player-avatar" style="--avatar:${AVATAR_COLORS[index % AVATAR_COLORS.length]}">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span><span class="player-name">${escapeHtml(player.name)}${player.id === me.id ? " · you" : ""}</span><span class="final-points">${player.score}</span></div>`).join("");
    $("playAgainButton").hidden = !isHost;
  }

  function resetToHome() {
    clearInterval(timerHandle);
    clearTimeout(nextRoundHandle);
    if (peer) peer.destroy();
    peer = null; connection = null; gameState = null; roomCode = ""; isHost = false;
    setConnection("offline", "Not connected");
    showNotice("homeNotice", "");
    setScreen("home");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  $("createRoomButton").addEventListener("click", createRoom);
  $("joinForm").addEventListener("submit", (event) => { event.preventDefault(); joinRoom($("joinCode").value); });
  $("joinCode").addEventListener("input", (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
  $("startGameButton").addEventListener("click", () => { if (isHost) startGame(); else send({ type: "start" }); });
  $("leaveLobbyButton").addEventListener("click", resetToHome);
  $("leaveResultsButton").addEventListener("click", resetToHome);
  $("playAgainButton").addEventListener("click", () => { if (isHost) startGame(); else send({ type: "play-again" }); });
  $("copyCodeButton").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(roomCode); showNotice("copyStatus", "Copied — send it to your crew."); }
    catch { showNotice("copyStatus", `Your code is ${roomCode}`); }
  });
  window.addEventListener("beforeunload", () => { if (peer) peer.destroy(); });
})();
