// Pure clock helpers shared by the UI and tests. Never use a local countdown counter.
export const isSequential = room => room?.turnMode === 'sequential-v1';
export const turnKey = room => `${room.round}:${isSequential(room) ? room.activePlayerId ?? room.turnIndex : 'all'}`;
export const isMyTurn = room => !isSequential(room) || room.activePlayerId === room.me;
export function mayCapture(room, now) {
  return !!room && isMyTurn(room) && ['listen', 'record'].includes(room.phase)
    && now >= room.recordAt && now < room.endAt;
}
export function turnCue(room, now) {
  if (!room || !['listen', 'record', 'collect'].includes(room.phase)) return '';
  if (now >= room.endAt || room.phase === 'collect') return 'collect';
  if (now >= room.recordAt) return now < room.recordAt + 1000 ? 'Start' : 'record';
  if (isSequential(room) && now >= room.readyAt) {
    const second = Math.floor((now - room.readyAt) / 1000);
    return ['Ready', '3', '2', '1'][second] || '1';
  }
  return 'listen';
}
