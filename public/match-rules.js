// Shared display/server rules. The server still owns every state transition.
export function stageName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 10 && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name) ? name : null;
}
export function roomCapacity(room) {
  // Only rooms created before this update may retain the old practice protocol.
  return room.matchType === 'solo' ? 8 : room.practice && !room.matchType ? 1 : room.capacity ?? room.rules.maxPlayers;
}
export function matchRequirements(room) {
  const capacity = roomCapacity(room), players = room.players || [];
  const full = players.length === capacity;
  const ready = players.filter(p => p.ready).length;
  const namesValid = players.every(p => stageName(p.name));
  const soundsAvailable = room.clips?.length > 0;
  return {capacity, full, ready, namesValid, soundsAvailable,
    canStart: room.phase === 'lobby' && capacity >= 1 && capacity <= 8 && full && ready === capacity && namesValid && soundsAvailable};
}
