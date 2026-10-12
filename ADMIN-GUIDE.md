# MIMIC — Admin Control Center

Open `/admin` on the existing public Site, then sign in with the configured owner ChatGPT account. The page shell is public, but all administrative data and writes require server-verified staff identity. No shared admin password is used.

## Roles

| Capability | Owner | Admin | Moderator |
| --- | --- | --- | --- |
| Dashboard, UGC and ranked-score review | Yes | Yes | Yes |
| Website, sound library, categories, languages and rules | Yes | Yes | No |
| Operational switches, room closure and metadata export | Yes | Yes | No |
| Grant/revoke staff access | Yes | No | No |

Existing emails in runtime `ADMIN_EMAILS` become protected **Owner** accounts. They cannot be removed or downgraded from the UI. Owner → Staff access can add an Admin or Moderator by the email on that person's ChatGPT account. No email invitation is sent. Disabling an entry revokes authorization on the next request; records and audit history remain. No additional staff accounts are created automatically by deploying this feature. Infrastructure secrets, the Site's public/private audience and the protected owner allowlist remain outside this in-game panel.

## Sections

1. **Overview**: actual active/total sounds, unexpired unfinished rooms, room creation over 24 hours, moderation queues and current leaderboard season. Refresh is manual. Room/player-slot data is stored state, not live online presence or a heartbeat.
2. **Website content**: brand, tagline, headline/intro and footer in Indonesian/English, three accent presets, announcement, and HTTPS help URL. Text is escaped; arbitrary HTML, scripts, CSS, layout editing and image uploads are not supported. Local text preview does not publish anything. Publish requires explicit confirmation. Player pages load new content on reload.
3. **Operations**: pause new rooms/joins, pause new UGC, and enable/disable manual casual sound pools. Server enforcement also covers legacy match creation/join endpoints and solo queue entry (both new rooms and joins must be enabled). Existing matches keep running and the admin panel remains available. Owner/Admin may create or join QA rooms while new-room maintenance is on. UGC pause applies to everyone but does not block viewing or withdrawing old submissions.
4. **Sound library**: search, upload browser-supported audio, exact transcript, category/language, credits/rights, active and ranked flags. Audio remains 0.25–15 seconds and up to 8 MB before conversion. Existing UGC audio cannot be replaced, preserving creator attribution. Viral content is not automatically licensed. Use inactive status instead of deletion.
5. **UGC moderation**: listen and verify rights/transcript/content, then approve/reject. Approval enables casual play; ranked eligibility is managed separately. Creators retain withdrawal controls.
6. **Categories / Languages**: editable labels and active flags. The existing 14 supported speech languages remain the available language set.
7. **Rules & reactions**: rounds, players, recording duration, score weights, thresholds, minimum sounds for ranking, ranked availability and reaction text/audio. The max-players rule supplies the custom API default when capacity is omitted; hosts choose 2–8 explicitly, and solo is always 8. Changes open a new leaderboard season. Existing matches keep their snapshots. Website/operational edits do not create a new season.
8. **Score review**: verify the actual transcript and approve/reject; the server recalculates the score. Staff cannot review their own attempt. Human verification remains necessary; this is not automated anti-cheat.
9. **Room monitor**: latest room snapshots with bounded pagination. Closing requires a reason, confirmation and a current room revision. It expires the selected room, rejects subsequent takes/joins and disconnects clients on their next poll. It does not erase audio, scores, submissions or prior records. A request already in flight can complete; this is not network-level cancellation. Expired rooms cannot be reopened here.
10. **Activity & export**: paginated/searchable administrative audit records. JSON export contains website and catalog metadata, not audio binaries, player recordings, staff lists, access tokens or runtime secrets. It is **not a full database backup**; automatic restore/import is not included.

## Versions and simultaneous edits

Website and operations share an optimistic revision. Saving stale settings returns HTTP 409 rather than overwriting another admin. Reload, compare and reapply your change. Successful publications are recorded in version history and audit. The last 20 versions are available from the UI. Loading history fills only the current section; review it and publish to apply as a new revision. Stored history is retained beyond the UI window.

Unsaved form edits warn before changing sections or leaving the page. Standard field lengths and server validation still apply even if a client is modified. This is not a general-purpose CMS or unrestricted database editor.

## Player-selected sounds

On `/create-match`, choose **Custom**, category/language and **Pick sounds (casual)**, then mark 1–50 active eligible clips. The host's pool is snapshotted into the room and shared by all participants. Ordering remains server-shuffled, without repeats until the pool is exhausted. Category, language and recording-duration limits still apply. Solo matchmaking always uses a random eligible pool and exactly 8 players; ranked rooms also reject custom pools. Disabling manual selection blocks newly created custom-pool rooms, not existing ones.

## Verification boundaries

Automated local D1/R2 Worker tests cover roles, CSRF, stale/concurrent setting saves, history/audit, operation switches, manual pool validation/synchronization, room closure and metadata export. DOM test doubles check escaped website text, selection controls and retry behavior; they are not a real browser. Prior browser-control restrictions still prevent visual/browser QA. Real-device layout, production login with invited staff, physical microphone timing and multi-device play remain to be tested manually. Deployment success is verified separately through Sites.
