import {avatarById} from './avatars.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const points = value => Number.isFinite(value) ? Math.max(0, value) : 0;

// Read server totals, never add a round on the client. Sort copies so that turn
// order and stage seats stay unchanged. Ties share a rank (1, 1, 3).
export function rankPlayers(players = []) {
  const sorted = players.map((player, seat) => ({...player, total: points(player.total), seat}))
    .sort((a, b) => b.total - a.total || a.seat - b.seat);
  let rank = 0;
  return sorted.map((player, index) => {
    if (!index || player.total !== sorted[index - 1].total) rank = index + 1;
    return {...player, rank, tied: sorted[index - 1]?.total === player.total || sorted[index + 1]?.total === player.total};
  });
}

export function matchStandingsMarkup(room, {language = 'id', practice = false} = {}) {
  // A player's reveal is not the end of the round. Every remaining turn must
  // complete before this board replaces the recording/playback screen.
  if (!room || !['results', 'finished'].includes(room.phase)) return '';
  const t = (id, en) => language === 'en' ? en : id;
  const players = rankPlayers(room.players), finished = room.phase === 'finished';
  const winners = players.filter(p => p.rank === 1);
  const title = practice ? t('Total latihan', 'Practice total') : !players.length ? t('Pertandingan berakhir', 'Match ended')
    : finished ? (winners.length > 1 ? t('Juara bersama!', 'Joint winners!') : t('Panggung punya juara!', 'We have a winner!'))
    : t('Siapa di puncak?', 'Who’s on top?');
  const caption = practice ? t('1 pemain · total sesi ini, bukan leaderboard.', '1 player · this session only, not a leaderboard.')
    : t('Total seluruh ronde · tertinggi ke terendah.', 'Total across rounds · highest to lowest.');
  const results = new Map((room.results || []).map(result => [result.playerId, result]));
  return `<section class="match-scoreboard${practice ? ' is-practice' : ''}" aria-label="${t('Klasemen pertandingan', 'Match standings')}">
    <div class="standings-heading"><span class="standings-kicker">${finished ? t('HASIL AKHIR', 'FINAL RESULTS') : t('RONDE SELESAI', 'ROUND COMPLETE')} · ${esc(room.round)} / ${esc(room.rules?.rounds)}</span><h2>${title}</h2><p>${caption}</p></div>
    ${players.length ? `<ol class="standings-cards">${players.map(player => {
      const result = results.get(player.id), delta = result ? points(result.total) : null;
      return `<li class="standings-card${player.rank === 1 && !practice ? ' is-leading' : ''}${player.id === room.me ? ' is-you' : ''}" value="${player.rank}" data-player-id="${esc(player.id)}">
        <div class="standings-card-top"><span class="standings-rank">${practice ? t('LATIHAN', 'PRACTICE') : `#${player.rank}${player.tied ? ' · ' + t('SERI', 'TIE') : ''}`}</span>${player.id === room.me ? `<span class="standings-you">${t('Kamu', 'You')}</span>` : ''}</div>
        <img class="standings-avatar" src="${avatarById(player.avatarId).thumbnail}" alt="" width="80" height="80">
        <b class="standings-name">${esc(player.name)}</b><div class="standings-total"><strong>${player.total}</strong><span>${t('total poin', 'total points')}</span></div>
        <span class="standings-gain">${delta === null ? t('Tidak ada skor ronde ini', 'No score this round') : `+${delta} ${t('ronde ini', 'this round')}`}</span>
      </li>`;
    }).join('')}</ol>` : `<p class="standings-empty">${t('Tidak ada pemain yang tersisa.', 'No players remain.')}</p>`}
    ${!practice && players.some(p => p.tied) ? `<p class="standings-tie-note">${t('Total sama = peringkat sama.', 'Same total = same rank.')}</p>` : ''}
    ${room.departedPlayers?.length ? `<details class="standings-departed"><summary>${t('Pemain keluar', 'Players who left')} (${room.departedPlayers.length})</summary><ul>${rankPlayers(room.departedPlayers).map(p => `<li><span>${esc(p.name)} · ${t('keluar', 'left')}</span><b>${p.total} ${t('poin', 'points')}</b></li>`).join('')}</ul></details>` : ''}
  </section>`;
}
