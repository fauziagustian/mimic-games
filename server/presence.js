// Server receipt time only; clients cannot extend a lease using their own clock.
export const PRESENCE_TIMEOUT_MS = 30000;
export const HEARTBEAT_WRITE_MS = 5000;
export function updatePresence(state, userId, now = Date.now()) {
  if (state.phase === 'finished') return {expired: [], touched: false};
  let touched = false;
  const expired = [];
  for (const player of state.players) {
    // Existing pre-heartbeat rooms receive one grace period on first access.
    if (!Number.isFinite(player.lastSeenAt)) {player.lastSeenAt = now; touched = true;}
    if (now - player.lastSeenAt >= PRESENCE_TIMEOUT_MS) expired.push(player.id);
    else if (player.id === userId && now - player.lastSeenAt >= HEARTBEAT_WRITE_MS) {
      player.lastSeenAt = now; touched = true;
    }
  }
  return {expired, touched};
}
