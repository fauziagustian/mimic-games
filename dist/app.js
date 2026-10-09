import { analyzeAudio, compareAudio } from "./scoring.js";
import {
  decodeAudio,
  playSamples,
  drawWave,
  pack,
  unpack,
  recordAudio,
  stopAudio,
  unlockAudio,
  setMuted,
  playReaction,
} from "./audio.js";
import {
  requestTranscription,
  modelReady,
  cancelTranscriber,
} from "./transcriber.js";
import {
  createRoomState,
  addPlayer,
  beginGame,
  currentPlayer,
  acceptRecording,
  revealResult,
  nextTurn,
  leaderboard,
} from "./game.js";
const $ = (s) => document.querySelector(s),
  app = $("#app"),
  homeTemplate = app.innerHTML;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const DEMOS = [
  {
    id: "lah-kok-gitu",
    title: "Lah, kok gitu?",
    text: "Lah, kok gitu? Aku kan cuma nanya!",
    category: "DRAMA DADAKAN",
    language: "indonesian",
  },
  {
    id: "santai-bos",
    title: "Santai dulu, bos.",
    text: "Santai dulu, bos. Kita belum mulai!",
    category: "SOK TENANG",
    language: "indonesian",
  },
  {
    id: "serius-nih",
    title: "Serius nih?!",
    text: "Serius nih? Wah, ini sih keren banget!",
    category: "HYPE MAKSIMAL",
    language: "indonesian",
  },
];
const ROASTS = [
  "Nadanya ke mana, percaya dirinya ke mana!",
  "Ini niru sound atau manggil tukang bakso?",
  "Mic-nya aman. Yang perlu latihan itu kamu!",
];
const assets = new Map(),
  profiles = new Map(),
  connections = new Map();
let me = { id: crypto.randomUUID(), name: "" },
  peer = null,
  hostConn = null,
  state = null,
  host = false,
  practice = false,
  epoch = 0,
  joinTimer,
  toastTimer;
let recording = null,
  recordPending = false,
  draft = null,
  heardTurn = "",
  submitted = false,
  lastReaction = "",
  muted = false,
  modelBusy = false,
  modelStatus = "Juri kata belum aktif.",
  judgingError = "",
  resultAudio = null;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 6000);
}
function network(text, online = false) {
  $("#networkStatus").textContent = text;
  $("#networkStatus").classList.toggle("online", online);
}
function bind(id, fn) {
  const el = $(id);
  if (el)
    el.onclick = () => {
      try {
        Promise.resolve(fn()).catch((e) =>
          toast(e.message || "Terjadi gangguan. Coba lagi."),
        );
      } catch (e) {
        toast(e.message);
      }
    };
}
function safeSend(conn, data) {
  if (conn?.open)
    try {
      conn.send(data);
    } catch {
      toast("Koneksi terputus. Coba masuk room lagi.");
    }
}
function broadcast(data) {
  for (const c of connections.values()) safeSend(c, data);
}
function publish() {
  if (!host || !state) return;
  state.revision++;
  broadcast({ type: "state", state });
  render();
}
function clip() {
  return state?.clips.find((c) => c.id === state.clipId);
}
function playerRows(order = state.players) {
  return order
    .map(
      (p, i) =>
        `<div class="player ${currentPlayer(state)?.id === p.id ? "active" : ""}"><span class="avatar">${esc(p.name[0]?.toUpperCase() || "?")}</span><div class="player-info"><b>${esc(p.name)}${p.id === me.id ? " · kamu" : ""}</b><span class="small">${p.id === state.hostId ? "Host · " : ""}${!p.online ? "Terputus" : state.phase === "lobby" ? "Siap meramaikan" : `${p.turns} penampilan`}</span></div>${state.phase !== "lobby" ? `<span class="player-score">${p.score}</span>` : ""}</div>`,
    )
    .join("");
}
async function loadDemo(c) {
  if (assets.has(c.id)) return assets.get(c.id);
  const r = await fetch(`audio/${c.id}.wav`);
  if (!r.ok) throw new Error("Sound latihan gagal dimuat.");
  const samples = await decodeAudio(await r.arrayBuffer());
  assets.set(c.id, samples);
  return samples;
}
function home() {
  app.innerHTML = homeTemplate;
  network("Belum di room");
  try {
    $("#nickname").value = localStorage.getItem("mimic-name") || "";
  } catch {}
  const query = new URLSearchParams(location.search).get("room");
  if (query) $("#code").value = query.toUpperCase().slice(0, 6);
  $("#demoClips").innerHTML = DEMOS.map(
    (c, i) =>
      `<article class="clip-card"><div class="clip-top"><span>0${i + 1} / ${c.category}</span><button class="play-circle" aria-label="Putar ${esc(c.title)}" data-demo="${c.id}">▶</button></div><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p><canvas class="waveform" data-wave="${c.id}" aria-label="Gelombang suara ${esc(c.title)}"></canvas></article>`,
  ).join("");
  for (const c of DEMOS)
    loadDemo(c)
      .then((samples) => drawWave($(`[data-wave="${c.id}"]`), samples))
      .catch(() => {});
  document
    .querySelectorAll("[data-demo]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          playSamples(assets.get(b.dataset.demo)).catch((e) =>
            toast(e.message),
          )),
    );
  bind("#create", () => create(false));
  bind("#practice", () => create(true));
  $("#joinForm").onsubmit = (e) => {
    e.preventDefault();
    join().catch((e) => toast(e.message));
  };
}
function nameFromForm() {
  const n = $("#nickname")?.value.trim().slice(0, 20);
  if (!n) {
    $("#nickname")?.focus();
    throw new Error("Isi nama panggung dulu.");
  }
  me.name = n;
  try {
    localStorage.setItem("mimic-name", n);
  } catch {}
  return n;
}
function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
    bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((v) => alphabet[v % alphabet.length]).join("");
}
async function create(isPractice) {
  nameFromForm();
  if (!isPractice && typeof Peer === "undefined")
    throw new Error(
      "Layanan room belum dimuat. Periksa internet lalu muat ulang.",
    );
  unlockAudio().catch(() => {});
  host = true;
  practice = isPractice;
  const session = ++epoch;
  app.innerHTML =
    '<div class="loading"><h2>Menyiapkan panggung…</h2><p>Klip latihan sedang dimuat.</p></div>';
  try {
    await Promise.all(DEMOS.map(loadDemo));
    if (epoch !== session) return;
    state = createRoomState(isPractice ? "LATIHAN" : code(), me);
    state.clips = DEMOS.map((c) => ({
      ...c,
      duration: assets.get(c.id).length / 16000,
      source: "Latihan orisinal",
    }));
    state.selected = DEMOS.map((c) => c.id);
    if (isPractice) {
      network("Latihan sendiri", true);
      render();
      return;
    }
    peer = new Peer(`mimic-v2-${state.code}`, { debug: 0 });
    wirePeer(peer, session);
    peer.on("open", () => {
      if (epoch !== session) return;
      clearTimeout(joinTimer);
      network(`Room ${state.code}`, true);
      render();
    });
    peer.on("connection", (conn) => attachGuest(conn, session));
    joinTimer = setTimeout(() => {
      if (epoch === session) {
        leave();
        toast("Room gagal dibuka. Periksa jaringan lalu coba lagi.");
      }
    }, 16000);
  } catch (e) {
    leave();
    throw e;
  }
}
async function join() {
  nameFromForm();
  const room = $("#code").value.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(room))
    throw new Error("Kode room terdiri dari 6 huruf/angka.");
  if (typeof Peer === "undefined")
    throw new Error("Layanan room belum siap. Muat ulang halaman.");
  unlockAudio().catch(() => {});
  host = false;
  practice = false;
  const session = ++epoch;
  network("Menghubungkan…");
  $("#joinForm button").disabled = true;
  peer = new Peer(undefined, { debug: 0 });
  wirePeer(peer, session);
  peer.on("open", () => {
    if (epoch !== session) return;
    hostConn = peer.connect(`mimic-v2-${room}`, { reliable: true });
    hostConn.on("open", () =>
      safeSend(hostConn, { type: "join", name: me.name, id: me.id }),
    );
    hostConn.on("data", (m) => {
      if (epoch === session) guestMessage(m).catch((e) => toast(e.message));
    });
    hostConn.on("close", () => {
      if (epoch === session) {
        leave();
        toast(
          "Host keluar atau koneksi terputus. Masuk lagi saat room dibuka.",
        );
      }
    });
  });
  joinTimer = setTimeout(() => {
    if (epoch === session) {
      leave();
      toast(
        "Room tidak ditemukan atau jaringan memblokir koneksi. Periksa kode dan coba lagi.",
      );
    }
  }, 20000);
}
function wirePeer(p, session) {
  p.on("error", (e) => {
    if (epoch !== session) return;
    const messages = {
      "peer-unavailable": "Room tidak ditemukan. Periksa kode.",
      "unavailable-id": "Kode sedang dipakai. Buat room lagi.",
      network: "Jaringan room terputus. Coba lagi.",
      webrtc: "Koneksi antarperangkat gagal. Coba jaringan lain.",
    };
    if (!state) {
      leave();
      toast(messages[e.type] || "Koneksi gagal. Periksa internet.");
    } else toast(messages[e.type] || "Ada gangguan koneksi.");
  });
  p.on("disconnected", () => {
    if (epoch === session && !p.destroyed) {
      network("Menyambung kembali…");
      try {
        p.reconnect();
      } catch {}
    }
  });
}
function attachGuest(conn, session) {
  let joined = false;
  const deadline = setTimeout(() => {
    if (!joined) conn.close();
  }, 10000);
  conn.on("data", async (m) => {
    if (epoch !== session || !state || !m || typeof m !== "object") return;
    try {
      if (m.type === "join" && !joined) {
        if (
          typeof m.id !== "string" ||
          m.id.length > 80 ||
          typeof m.name !== "string" ||
          !m.name.trim()
        )
          throw new Error("Nama pemain tidak valid.");
        if (connections.has(m.id)) throw new Error("Pemain sudah terhubung.");
        addPlayer(state, { id: m.id, name: m.name.trim().slice(0, 20) });
        joined = true;
        clearTimeout(deadline);
        conn.playerId = m.id;
        connections.set(m.id, conn);
        publish();
        for (const c of state.clips)
          safeSend(conn, {
            type: "asset",
            id: c.id,
            audio: pack(assets.get(c.id)),
          });
        return;
      }
      if (!joined) return;
      if (m.type === "recording")
        await handleRecording(conn.playerId, m.turnId, m.audio);
      if (m.type === "leave") conn.close();
    } catch (e) {
      safeSend(conn, { type: "error", message: e.message, rejected: !joined });
      if (!joined) setTimeout(() => conn.close(), 300);
    }
  });
  conn.on("close", () => {
    clearTimeout(deadline);
    if (epoch !== session || !state || !joined) return;
    connections.delete(conn.playerId);
    const p = state.players.find((p) => p.id === conn.playerId);
    if (!p) return;
    if (state.phase === "lobby")
      state.players = state.players.filter((p) => p.id !== conn.playerId);
    else {
      p.online = false;
      if (currentPlayer(state)?.id === p.id && state.phase === "perform")
        skipTurn("Pemain terputus.");
    }
    publish();
  });
}
async function guestMessage(m) {
  if (!m || typeof m !== "object") return;
  if (m.type === "state") {
    if (
      !m.state ||
      typeof m.state.revision !== "number" ||
      (state && m.state.revision <= state.revision)
    )
      return;
    const previous = state?.turnId;
    state = m.state;
    clearTimeout(joinTimer);
    network(`Room ${state.code}`, true);
    if (previous !== state.turnId) clearTurn();
    else if (state.phase !== "perform") {
      recording?.stop();
      recording = null;
    }
    render();
  } else if (m.type === "asset") {
    if (!state?.clips.some((c) => c.id === m.id)) return;
    assets.set(m.id, await unpack(m.audio));
    if (state.phase === "perform" && clip()?.id === m.id) renderBattle();
  } else if (m.type === "resultAudio") {
    if (m.turnId !== state?.turnId) return;
    const samples = await unpack(m.audio);
    if (m.turnId === state?.turnId) {
      resultAudio = samples;
      if (state.phase === "reveal") render();
    }
  } else if (m.type === "error") {
    if (m.rejected) leave();
    submitted = false;
    toast(String(m.message).slice(0, 200));
  }
}
function clearTurn() {
  recording?.stop();
  recording = null;
  draft = null;
  heardTurn = "";
  submitted = false;
  recordPending = false;
  judgingError = "";
  resultAudio = null;
  stopAudio();
}
function leave() {
  epoch++;
  clearTimeout(joinTimer);
  clearTurn();
  safeSend(hostConn, { type: "leave" });
  peer?.destroy();
  peer = null;
  hostConn = null;
  connections.clear();
  state = null;
  host = false;
  practice = false;
  for (const key of assets.keys())
    if (!DEMOS.some((d) => d.id === key)) assets.delete(key);
  profiles.clear();
  home();
}
function render() {
  if (!state) return;
  if (state.phase === "lobby") renderLobby();
  else if (state.phase === "finished") renderFinished();
  else renderBattle();
}
function renderLobby() {
  const draftValues = {};
  for (const id of ["clipTitle", "clipText", "clipLanguage"])
    if ($("#" + id)) draftValues[id] = $("#" + id).value;
  const detailsOpen = $("#uploadDetails")?.open;
  app.innerHTML = `<div class="page-title"><div><span class="eyebrow">BACKSTAGE / ${practice ? "LATIHAN" : "ROOM"}</span><h1>CEK SOUND. CEK GENG.</h1><p>Pilih cuplikan, lalu rebut skor paling tinggi.</p></div><button class="button light" id="leave">Keluar</button></div><div class="room-layout"><div class="stack"><section class="panel"><div class="section-heading"><h3>Sound dalam antrean</h3><span class="tag">${state.selected.length} DIPILIH</span></div><div class="list-clips">${state.clips.map((c) => `<div class="list-clip">${host ? `<input type="checkbox" aria-label="Pilih ${esc(c.title)}" data-select="${c.id}" ${state.selected.includes(c.id) ? "checked" : ""}>` : ""}<div><b>${esc(c.title)}</b><span class="small">${esc(c.source)} · ${c.duration.toFixed(1)} dtk</span></div><button class="play-circle" data-play="${c.id}" aria-label="Putar ${esc(c.title)}">▶</button>${host && !DEMOS.some((d) => d.id === c.id) ? `<button class="remove" data-remove="${c.id}" aria-label="Hapus ${esc(c.title)}">×</button>` : ""}</div>`).join("")}</div>${host ? `<details id="uploadDetails"><summary>＋ Tambah sound meme / influencer</summary><p>Masukkan cuplikan yang boleh kamu gunakan, beserta kata yang harus ditiru. Audio dibagikan ke pemain room ini, tidak disimpan di server.</p><label for="clipTitle">Judul sound</label><input id="clipTitle" maxlength="60" placeholder="Nama meme atau cuplikan"><label for="clipText">Kata-kata persis dalam cuplikan</label><textarea id="clipText" maxlength="300" rows="2" placeholder="Tulis ucapan di sound aslinya"></textarea><label for="clipLanguage">Bahasa</label><select id="clipLanguage"><option value="indonesian">Bahasa Indonesia</option><option value="english">English</option></select><label for="clipFile">File audio · 0,25–15 detik · maks. 8 MB</label><input type="file" id="clipFile" accept="audio/*"><p class="small">MP3, WAV, M4A, atau format yang dapat diputar browser. Maksimal 8 sound per room.</p><button class="button light" id="upload">Tambahkan ke antrean</button></details>` : ""}</section><section class="panel"><h3>Juri punya empat telinga.</h3><p class="small">Nada 30% · Kata 35% · Karakter bunyi 20% · Ritme 15%. Skor 100 membutuhkan kata tepat dan setiap komponen suara ≥98. Skor ini adalah rubrik permainan, bukan ukuran identitas suara.</p><div class="score-strip"><span><b>0–49</b> Roast receh + buzzer</span><span><b>50–99</b> Tepuk tangan</span><span><b>100</b> Fanfare + confetti</span></div></section></div><aside class="stack"><section class="panel room-share"><div><p class="small">${practice ? "MODE" : "BAGIKAN KODE"}</p><strong class="room-code">${esc(state.code)}</strong></div>${!practice ? '<button class="button green" id="copy">Salin link</button>' : ""}</section><section class="panel"><div class="section-heading"><h3>Pemain</h3><span class="tag">${state.players.length}/8</span></div><div class="players">${playerRows()}</div></section><section class="panel">${host ? `<h3>Siapkan juri</h3><p class="small">Pengenal kata diunduh sekali ke browser host (puluhan MB). Rekaman dinilai di perangkat ini. Host disarankan memakai laptop.</p><div class="model-status" id="modelStatus" role="status">${esc(modelStatus)}</div><button class="button light full" id="loadModel" ${modelBusy || modelReady ? "disabled" : ""}>${modelReady ? "✓ Juri siap" : modelBusy ? "Menyiapkan juri…" : "Aktifkan juri kata"}</button><div class="settings-row"><div><label for="rounds">Jumlah ronde</label><select id="rounds">${[1, 2, 3, 5].map((n) => `<option value="${n}" ${state.rounds === n ? "selected" : ""}>${n} ronde</option>`).join("")}</select></div></div><div class="actions"><button class="button primary full" id="start" ${!modelReady || (!practice && state.players.length < 2) || !state.selected.length ? "disabled" : ""}>${practice ? "Mulai latihan" : "Mulai sound battle"}</button></div><p class="small">${!practice && state.players.length < 2 ? "Menunggu minimal 2 pemain." : "Setiap pemain menirukan sound yang sama, bergiliran."}</p>` : '<h3>Tunggu aba-aba host.</h3><p class="small">Host memilih sound dan menyiapkan juri. Kamu tidak perlu mengunduh model.</p>'}</section></aside></div>`;
  for (const [id, value] of Object.entries(draftValues))
    if ($("#" + id)) $("#" + id).value = value;
  if ($("#uploadDetails")) $("#uploadDetails").open = detailsOpen || false;
  bind("#leave", leave);
  bind("#copy", async () => {
    const url = new URL(location.href);
    url.search = `?room=${state.code}`;
    try {
      await navigator.clipboard.writeText(url.href);
      toast("Link room disalin. Bagikan ke geng kamu.");
    } catch {
      toast(`Kode room: ${state.code}`);
    }
  });
  bindPlayButtons();
  document.querySelectorAll("[data-select]").forEach(
    (el) =>
      (el.onchange = () => {
        state.selected = state.clips
          .filter((c) =>
            c.id === el.dataset.select
              ? el.checked
              : state.selected.includes(c.id),
          )
          .map((c) => c.id);
        publish();
      }),
  );
  document.querySelectorAll("[data-remove]").forEach(
    (el) =>
      (el.onclick = () => {
        state.clips = state.clips.filter((c) => c.id !== el.dataset.remove);
        state.selected = state.selected.filter(
          (id) => id !== el.dataset.remove,
        );
        assets.delete(el.dataset.remove);
        publish();
      }),
  );
  if ($("#rounds"))
    $("#rounds").onchange = (e) => {
      state.rounds = Number(e.target.value);
      publish();
    };
  bind("#upload", uploadClip);
  bind("#loadModel", loadModel);
  bind("#start", () => {
    beginGame(state, practice);
    clearTurn();
    publish();
  });
}
function bindPlayButtons() {
  document.querySelectorAll("[data-play]").forEach(
    (el) =>
      (el.onclick = async () => {
        try {
          const audio = assets.get(el.dataset.play);
          if (!audio) throw new Error("Sound sedang dikirim. Tunggu sebentar.");
          el.disabled = true;
          await playSamples(audio);
        } catch (e) {
          toast(e.message);
        } finally {
          el.disabled = false;
        }
      }),
  );
}
async function uploadClip() {
  if (!host || state.phase !== "lobby") return;
  if (state.clips.length >= 8) throw new Error("Maksimal 8 sound per room.");
  const title = $("#clipTitle").value.trim(),
    text = $("#clipText").value.trim(),
    file = $("#clipFile").files[0],
    language = $("#clipLanguage").value;
  if (!title || !text || !file)
    throw new Error("Isi judul, kata-kata, dan file audio.");
  if (file.size > 8 * 1024 * 1024) throw new Error("File maksimal 8 MB.");
  const session = epoch;
  $("#upload").disabled = true;
  try {
    const audio = await decodeAudio(await file.arrayBuffer());
    if (session !== epoch || state?.phase !== "lobby") return;
    const id = crypto.randomUUID();
    assets.set(id, audio);
    const c = {
      id,
      title: title.slice(0, 60),
      text: text.slice(0, 300),
      language,
      duration: audio.length / 16000,
      source: "Sound host",
    };
    state.clips.push(c);
    state.selected.push(id);
    for (const key of ["clipTitle", "clipText"]) $("#" + key).value = "";
    publish();
    broadcast({ type: "asset", id, audio: pack(audio) });
    toast("Sound ditambahkan. Semua pemain menerima cuplikannya.");
  } finally {
    if ($("#upload")) $("#upload").disabled = false;
  }
}
async function loadModel() {
  if (modelBusy || modelReady) return;
  modelBusy = true;
  modelStatus = "Mengunduh pengenal kata…";
  renderLobby();
  try {
    await requestTranscription("load", null, (p) => {
      if (p.status === "progress")
        modelStatus = `Mengunduh ${p.file?.endsWith(".onnx") ? "model suara" : "berkas pendukung"}: ${Math.round(p.progress || 0)}%`;
      else if (p.status === "initiate") modelStatus = "Menyiapkan berkas juri…";
      if ($("#modelStatus")) $("#modelStatus").textContent = modelStatus;
    });
    modelStatus = "✓ Juri siap. Kata dinilai di perangkat host.";
  } catch (e) {
    modelStatus = "Juri gagal dimuat. Periksa internet dan coba lagi.";
    toast(e.message);
  } finally {
    modelBusy = false;
    if (state?.phase === "lobby") renderLobby();
  }
}
function renderBattle() {
  const p = currentPlayer(state),
    c = clip(),
    myTurn = p?.id === me.id;
  if (!c || !p) return;
  app.innerHTML = `<div class="page-title"><div><span class="eyebrow">RONDE ${state.round}/${state.rounds} · ${esc(state.code)}</span><h1>${state.phase === "reveal" ? "HASILNYA MASUK." : "MIC CHECK, " + esc(p.name.toUpperCase()) + "."}</h1></div><button class="button light" id="leave">Keluar</button></div><div class="battle-grid"><section class="stage ${state.result?.total === 100 ? "perfect" : ""}">${state.phase === "reveal" ? resultMarkup() : `<div class="section-heading"><span class="eyebrow">${myTurn ? "GILIRAN KAMU" : "GILIRAN " + esc(p.name.toUpperCase())}</span><span class="turn-timer" id="turnClock">—</span></div><h2>${esc(c.title)}</h2><p class="quote">“${esc(c.text)}”</p><div class="reference"><div class="reference-header"><span>SOUND ASLI · ${c.duration.toFixed(1)} DETIK</span><button class="button green" id="reference" ${state.phase === "judging" ? "disabled" : ""}>▶ Dengarkan</button></div><canvas class="waveform" id="referenceWave" aria-label="Gelombang sound asli"></canvas></div><div class="record-zone" id="recordZone">${state.phase === "judging" ? `<h3>Juri sedang mendengarkan…</h3><p>Nada, kata, karakter bunyi, dan ritme sedang dibandingkan.</p><p class="small" id="judgeStatus">Proses dapat memerlukan hingga 2 menit di perangkat host.</p>${host && judgingError ? `<p class="error-text">${esc(judgingError)}</p><button class="button light" id="retryJudge">Coba penilaian lagi</button>` : ""}` : myTurn ? `<canvas class="waveform" id="recordWave" aria-label="Gelombang rekamanmu"></canvas><button class="button primary" id="record" ${!assets.has(c.id) || heardTurn !== state.turnId ? "disabled" : ""}><span class="record-dot"></span> Rekam tiruanmu</button><p id="recordHint">${heardTurn === state.turnId ? "Rekam lalu kirim. Maksimal 15 detik." : "Dengarkan sound asli sampai selesai terlebih dulu."}</p><div class="actions" id="recordActions" hidden><button class="button light" id="listenDraft">▶ Dengarkan ulang</button><button class="button green" id="submit">Kirim ke juri</button></div><p class="small">Saat dikirim, rekaman dibagikan ke host dan pemain room. Pakai headset agar sound asli tidak ikut terekam.</p>` : `<h3>${esc(p.name)} sedang bersiap.</h3><p>Dengarkan referensinya. Sebentar lagi giliranmu!</p>`}</div>${host ? '<div class="actions"><button class="text-button" id="skip">Lewati giliran · skor 0</button></div>' : ""}`}</section><aside class="side stack"><section class="panel"><span class="eyebrow">LIVE LEADERBOARD</span><h3 style="margin-top:12px">Siapa paling mirip?</h3><div class="players">${playerRows(leaderboard(state))}</div></section><section class="panel"><h3>Ikuti detailnya.</h3><p class="small">Nada tinggi-rendah, urutan kata, warna suara, dan jeda. Makin mirip, makin tinggi skor.</p><p class="small">0–49: kena roast<br>50–99: tepuk tangan<br>100: sound megah</p><p class="small">Slang dan suara bising bisa membuat pengenalan kata meleset.</p></section></aside></div>`;
  bind("#leave", leave);
  bind("#reference", async () => {
    const audio = assets.get(c.id);
    if (!audio) throw new Error("Sound masih dikirim. Coba lagi sesaat.");
    const id = state.turnId;
    $("#reference").disabled = true;
    try {
      const ended = await playSamples(audio);
      if (ended && state?.turnId === id && state.phase === "perform") {
        heardTurn = id;
        const r = $("#record");
        if (r) r.disabled = false;
        const hint = $("#recordHint");
        if (hint)
          hint.textContent = "Sekarang giliranmu. Tirukan nada dan katanya!";
      }
    } finally {
      if ($("#reference")) $("#reference").disabled = false;
    }
  });
  drawWave($("#referenceWave"), assets.get(c.id), "#d2eb61");
  bind("#record", toggleRecord);
  bind("#listenDraft", () => playSamples(draft));
  bind("#submit", submitDraft);
  bind("#skip", () => skipTurn("Giliran dilewati host."));
  bind("#retryJudge", () => judgeCurrent());
  if (state.phase === "reveal") {
    bind("#next", () => {
      nextTurn(state);
      clearTurn();
      publish();
    });
    bind("#replayReaction", () =>
      playReaction(state.result.reaction, state.turnIndex),
    );
    bind("#resultAudio", () => playSamples(resultAudio));
    drawWave($("#attemptWave"), resultAudio, "#ff6038");
    if (lastReaction !== state.turnId) {
      lastReaction = state.turnId;
      playReaction(state.result.reaction, state.turnIndex);
    }
  } else if (draft && myTurn && state.phase === "perform") showDraft();
  updateClock();
}
function resultMarkup() {
  const r = state.result;
  const verdict =
    r.total === 100
      ? "100% LEGEND."
      : r.total >= 50
        ? "GENG KASIH RESPECT."
        : "WADUH. KENA ROAST.";
  return `${r.total === 100 ? `<div class="confetti" aria-hidden="true">${Array.from({ length: 22 }, (_, i) => `<i style="left:${i * 4.7}%;animation-delay:${(i % 5) * 0.2}s;background:${["#d2eb61", "#ff6038", "#efbadc"][i % 3]}"></i>`).join("")}</div>` : ""}<span class="eyebrow">PENAMPILAN ${esc(r.playerName)}</span><div class="result-header"><div class="result-score">${r.total}<small>/100</small></div><div class="verdict">${verdict}</div></div><p>${esc(r.total < 50 ? ROASTS[state.turnIndex % 3] : r.total === 100 ? "Nada, kata, dan gayanya: kena semua. Panggung ini milikmu." : "Lumayan mirip! Satu room kasih tepuk tangan.")}</p><div class="metrics">${[
    ["Nada", r.pitch, "30%"],
    ["Kata", r.words, "35%"],
    ["Karakter bunyi", r.timbre, "20%"],
    ["Ritme", r.rhythm, "15%"],
  ]
    .map(
      ([name, score, weight]) =>
        `<div class="metric"><div class="metric-title"><span>${name} · ${weight}</span><b>${score ?? 0}/100</b></div><div class="progress"><span style="width:${score ?? 0}%"></span></div></div>`,
    )
    .join(
      "",
    )}</div><div class="transcript"><p class="small">KATA YANG TERDENGAR</p><p>${esc(r.transcript || "Tidak ada ucapan yang terbaca.")}</p></div><p class="small" style="margin-top:12px">${esc(r.note)}</p><canvas class="waveform" id="attemptWave" aria-label="Gelombang rekaman pemain"></canvas><div class="actions"><button class="button light" id="resultAudio" ${resultAudio ? "" : "disabled"}>▶ Putar tiruan</button><button class="button light" id="replayReaction">♫ Putar reaksi</button>${host ? '<button class="button primary" id="next">Lanjutkan</button>' : '<p class="small">Menunggu host melanjutkan.</p>'}</div>`;
}
async function toggleRecord() {
  if (recording) {
    recording.stop();
    return;
  }
  if (
    recordPending ||
    state?.phase !== "perform" ||
    currentPlayer(state)?.id !== me.id ||
    submitted
  )
    return;
  recordPending = true;
  draft = null;
  const session = epoch,
    id = state.turnId;
  $("#record").disabled = true;
  if ($("#reference")) $("#reference").disabled = true;
  if ($("#recordActions")) $("#recordActions").hidden = true;
  try {
    const capture = await recordAudio({
      seconds: 15,
      onLevel: (frame, seconds) => {
        drawWave($("#recordWave"), frame, "#ff6038");
        if ($("#recordHint"))
          $("#recordHint").textContent =
            `Merekam ${seconds.toFixed(1)} / 15 dtk`;
      },
    });
    if (
      epoch !== session ||
      state?.turnId !== id ||
      state?.phase !== "perform"
    ) {
      capture.stop();
      capture.result.catch(() => {});
      return;
    }
    recording = capture;
    $("#record").textContent = "■ Selesai merekam";
    $("#record").disabled = false;
    $("#record").classList.add("recording");
    const samples = await capture.result;
    if (epoch !== session || state?.turnId !== id || state?.phase !== "perform")
      return;
    draft = samples;
    showDraft();
  } catch (e) {
    toast(
      e.name === "NotAllowedError"
        ? "Izin mikrofon ditolak. Izinkan mikrofon di pengaturan situs, lalu coba lagi."
        : e.name === "NotFoundError"
          ? "Mikrofon tidak ditemukan. Sambungkan mikrofon lalu coba lagi."
          : e.message,
    );
  } finally {
    if (epoch === session) {
      recording = null;
      recordPending = false;
      if ($("#reference") && state?.phase === "perform")
        $("#reference").disabled = false;
      if ($("#record")) {
        $("#record").classList.remove("recording");
        $("#record").disabled = false;
        $("#record").textContent = draft ? "Rekam ulang" : "Rekam tiruanmu";
      }
    }
  }
}
function showDraft() {
  if ($("#recordActions")) $("#recordActions").hidden = false;
  if ($("#recordHint"))
    $("#recordHint").textContent =
      `${(draft.length / 16000).toFixed(1)} detik terekam. Dengarkan ulang atau kirim.`;
  drawWave($("#recordWave"), draft, "#ff6038");
}
async function submitDraft() {
  if (!draft || submitted || state?.phase !== "perform") return;
  submitted = true;
  stopAudio();
  const payload = pack(draft);
  if ($("#submit")) $("#submit").disabled = true;
  try {
    if (host) await handleRecording(me.id, state.turnId, payload);
    else
      safeSend(hostConn, {
        type: "recording",
        turnId: state.turnId,
        audio: payload,
      });
  } catch (e) {
    submitted = false;
    toast(e.message);
    if ($("#submit")) $("#submit").disabled = false;
  }
}
async function handleRecording(playerId, turnId, encoded) {
  if (!host || !state || typeof encoded !== "string" || encoded.length > 660000)
    throw new Error("Rekaman tidak valid.");
  acceptRecording(state, playerId, turnId);
  const session = epoch;
  publish();
  try {
    const samples = await unpack(encoded);
    if (
      epoch !== session ||
      state.turnId !== turnId ||
      state.phase !== "judging"
    )
      return;
    resultAudio = samples;
    await judgeCurrent();
  } catch (e) {
    if (state?.turnId === turnId) {
      judgingError = e.message;
      render();
    }
  }
}
async function judgeCurrent() {
  if (!host || !state || state.phase !== "judging" || !resultAudio) return;
  const session = epoch,
    id = state.turnId,
    referenceClip = clip(),
    attempt = resultAudio;
  judgingError = "";
  renderBattle();
  try {
    let reference = profiles.get(referenceClip.id);
    if (!reference) {
      reference = analyzeAudio(assets.get(referenceClip.id));
      profiles.set(referenceClip.id, reference);
    }
    const analysis = analyzeAudio(attempt);
    let transcript = "";
    if (!analysis.silent && analysis.voiced >= 3)
      transcript = await requestTranscription(
        "transcribe",
        attempt,
        () => {},
        referenceClip.language,
      );
    if (epoch !== session || state?.turnId !== id || state.phase !== "judging")
      return;
    const score = compareAudio(
      reference,
      analysis,
      referenceClip.text,
      transcript,
    );
    revealResult(state, score);
    publish();
    broadcast({ type: "resultAudio", turnId: id, audio: pack(attempt) });
  } catch (e) {
    if (
      epoch === session &&
      state?.turnId === id &&
      state.phase === "judging"
    ) {
      judgingError = e.message;
      renderBattle();
    }
  }
}
function skipTurn(note) {
  if (!host || !state || !["perform", "judging"].includes(state.phase)) return;
  recording?.stop();
  recording = null;
  stopAudio();
  revealResult(state, {
    total: 0,
    pitch: 0,
    words: 0,
    timbre: 0,
    rhythm: 0,
    transcript: "",
    reaction: "roast",
    note,
  });
  publish();
}
function renderFinished() {
  const ordered = leaderboard(state),
    max = ordered[0]?.score || 0,
    winners = ordered.filter((p) => p.score === max);
  app.innerHTML = `<section class="end-card"><p class="eyebrow">THAT'S A WRAP / ${state.rounds} RONDE</p><h1>${winners.length > 1 ? "SERI. SAMA-SAMA" : "PANGGUNG MILIK"}<br><em>${winners.length > 1 ? "BERISIK." : esc(winners[0]?.name.toUpperCase())}</em></h1><p class="muted">${winners.length > 1 ? winners.map((p) => esc(p.name)).join(" & ") : esc(winners[0]?.name)} mengumpulkan ${max} poin.</p><div class="panel ranking">${playerRows(ordered)}</div><div class="actions" style="justify-content:center">${host ? '<button class="button primary" id="again">Main lagi</button>' : "<p>Menunggu host membuka permainan berikutnya.</p>"}<button class="button light" id="leave">Keluar room</button></div></section>`;
  bind("#leave", leave);
  bind("#again", () => {
    state.phase = "lobby";
    state.players = state.players.filter((p) => p.online);
    state.turnId = "";
    clearTurn();
    publish();
  });
}
function updateClock() {
  if (!state) return;
  const el = $("#turnClock");
  if (el)
    el.textContent =
      state.phase === "perform"
        ? `${Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000))} dtk`
        : "";
  if (host && state.phase === "perform" && Date.now() > state.deadline)
    skipTurn("Waktu 90 detik habis tanpa rekaman terkirim.");
}
setInterval(updateClock, 250);
$("#soundToggle").onclick = () => {
  muted = !muted;
  setMuted(muted);
  $("#soundToggle").setAttribute("aria-pressed", String(muted));
  $("#soundToggle").innerHTML = muted
    ? "♪ <span>Efek mati</span>"
    : "♫ <span>Suara aktif</span>";
};
window.addEventListener("beforeunload", () => {
  recording?.stop();
  peer?.destroy();
});
window.addEventListener("resize", () => {
  if (!state)
    for (const c of DEMOS)
      drawWave($(`[data-wave="${c.id}"]`), assets.get(c.id));
  else drawWave($("#referenceWave"), assets.get(clip()?.id), "#d2eb61");
});
home();
if (document.modelContext?.registerTool) {
  try {
    document.modelContext.registerTool({
      name: "read_sound_battle",
      title: "Baca status MIMIC",
      description:
        "Baca fase permainan, giliran, dan skor yang terlihat. Tidak mengaktifkan mikrofon.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).length
        )
          throw new Error("Status tidak menerima parameter tambahan.");
        return {
          phase: state?.phase || "home",
          code: state?.code || null,
          currentPlayer:
            state && ["perform", "judging", "reveal"].includes(state.phase)
              ? currentPlayer(state)?.name
              : null,
          players:
            state?.players.map((p) => ({
              name: p.name,
              score: p.score,
              online: p.online,
            })) || [],
        };
      },
    });
  } catch {}
}
