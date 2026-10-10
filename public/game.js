import {randomQueue} from './catalog.js';
export const MAX_PLAYERS = 8;
export function createRoomState(code, host) {
  return {
    code,
    hostId: host.id,
    revision: 0,
    phase: "lobby",
    players: [{ ...host, score: 0, turns: 0, online: true }],
    clips: [],
    selected: [],
    rounds: 3,
    round: 0,
    turnIndex: 0,
    order: [],
    turnId: "",
    deadline: 0,
    result: null,
    history: [],
  };
}
export function addPlayer(state, player) {
  if (state.phase !== "lobby")
    throw new Error("Game sudah mulai. Tunggu host membuka ronde baru.");
  if (state.players.length >= (state.rules?.maxPlayers || MAX_PLAYERS))
    throw new Error("Room penuh: maksimal 8 pemain.");
  if (state.players.some((p) => p.id === player.id))
    throw new Error("Pemain sudah berada di room.");
  state.players.push({ ...player, score: 0, turns: 0, online: true });
}
export function currentPlayer(state) {
  return state.players.find((p) => p.id === state.order[state.turnIndex]);
}
export function beginGame(state, practice = false) {
  if (state.phase !== "lobby" && state.phase !== "finished")
    throw new Error("Game masih berlangsung.");
  if (state.players.filter((p) => p.online).length < (practice ? 1 : 2))
    throw new Error("Butuh minimal 2 pemain.");
  if (!state.selected.length) throw new Error("Pilih minimal satu sound.");
  state.order = state.players.filter((p) => p.online).map((p) => p.id);
  state.players.forEach((p) => {
    p.score = 0;
    p.turns = 0;
  });
  state.round = 1;
  state.turnIndex = 0;
  state.history = [];
  state.queue = state.rankedMatch?.queue || randomQueue(state.selected,state.rounds);
  newTurn(state);
}
export function newTurn(state) {
  state.phase = "perform";
  state.turnId = crypto.randomUUID();
  state.result = null;
  state.deadline = Date.now() + (state.rules?.turnSeconds || 90)*1000;
  state.clipId = state.queue?.[state.round-1] || state.selected[(state.round - 1) % state.selected.length];
}
export function acceptRecording(state, playerId, turnId) {
  if (
    state.phase !== "perform" ||
    state.turnId !== turnId ||
    currentPlayer(state)?.id !== playerId
  )
    throw new Error("Bukan giliranmu atau rekaman sudah diterima.");
  if (Date.now() > state.deadline) throw new Error("Waktu giliran habis.");
  state.phase = "judging";
}
export function revealResult(state, score) {
  if (!["perform", "judging"].includes(state.phase)) return false;
  const p = currentPlayer(state);
  if (!p) return false;
  const total = score.total;
  if (!Number.isInteger(total) || total < 0 || total > 100)
    throw new Error("Skor tidak valid.");
  p.score += total;
  p.turns += 1;
  state.result = {
    ...score,
    playerId: p.id,
    playerName: p.name,
    turnId: state.turnId,
    round: state.round,
  };
  state.history.push(state.result);
  state.phase = "reveal";
  state.deadline = 0;
  return true;
}
export function nextTurn(state) {
  if (state.phase !== "reveal") throw new Error("Hasil belum tersedia.");
  let tries = 0;
  do {
    state.turnIndex++;
    if (state.turnIndex >= state.order.length) {
      state.turnIndex = 0;
      state.round++;
    }
    if (state.round > state.rounds) {
      state.phase = "finished";
      state.deadline = 0;
      return;
    }
    if (++tries > state.order.length * state.rounds) {
      state.phase = "finished";
      return;
    }
  } while (!currentPlayer(state)?.online);
  newTurn(state);
}
export function leaderboard(state) {
  return [...state.players].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  );
}
