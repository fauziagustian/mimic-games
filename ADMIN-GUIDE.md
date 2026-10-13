# MIMIC — Admin Control Center

Open `/admin` on the existing public Site, then sign in with the configured owner ChatGPT account. The page shell is public, but all administrative data and writes require server-verified staff identity. No shared admin password is used.

## Roles

| Capability | Owner | Admin | Moderator |
| --- | --- | --- | --- |
| Dashboard, UGC and ranked-score review | Yes | Yes | Yes |
| Website, sound library, categories, languages and rules | Yes | Yes | No |
| Scoring Lab and reference transcript draft assistant | Yes | Yes | No |
| Operational switches, room closure and metadata export | Yes | Yes | No |
| Grant/revoke staff access | Yes | No | No |

Existing emails in runtime `ADMIN_EMAILS` become protected **Owner** accounts. They cannot be removed or downgraded from the UI. Owner → Staff access can add an Admin or Moderator by the email on that person's ChatGPT account. No email invitation is sent. Disabling an entry revokes authorization on the next request; records and audit history remain. No additional staff accounts are created automatically by deploying this feature. Infrastructure secrets, the Site's public/private audience and the protected owner allowlist remain outside this in-game panel.

## Sections

1. **Overview**: actual active/total sounds, unexpired unfinished rooms, room creation over 24 hours, moderation queues and current leaderboard season. Refresh is manual. Room/player-slot data is stored state, not live online presence or a heartbeat.
2. **Website content**: brand, tagline, headline/intro and footer in Indonesian/English, three accent presets, announcement, and HTTPS help URL. Text is escaped; arbitrary HTML, scripts, CSS, layout editing and image uploads are not supported. Local text preview does not publish anything. Publish requires explicit confirmation. Player pages load new content on reload.
3. **Operations**: pause new rooms/joins, pause new UGC, and enable/disable manual casual sound pools. Server enforcement also covers legacy match creation/join endpoints and solo queue entry (both new rooms and joins must be enabled). Existing matches keep running and the admin panel remains available. Owner/Admin may create or join QA rooms while new-room maintenance is on. UGC pause applies to everyone but does not block viewing or withdrawing old submissions.
4. **Sound library**: search, upload browser-supported audio, speech/non-verbal type, exact transcript, category/language, credits/rights, active and ranked flags. Audio remains 0.25–15 seconds and up to 8 MB before conversion. Silence/DC-only references are rejected. Transcript is mandatory for speech, optional for non-verbal effects. **Draft from audio** runs Tiny/Base locally, then requires human listening/correction before saving. Existing UGC audio cannot be replaced, preserving creator attribution. Viral content is not automatically licensed. Use inactive status instead of deletion.
5. **UGC moderation**: listen and verify rights/transcript/content, then approve/reject. Approval enables casual play; ranked eligibility is managed separately. Creators retain withdrawal controls.
6. **Categories / Languages**: editable labels and active flags. The existing 14 supported speech languages remain the available language set.
7. **Rules & reactions**: rounds, players, recording duration, speech Precision score weights, thresholds, Tiny/Base ASR model, minimum sounds for ranking, ranked availability and reaction text/audio. Tiny is the default; try the larger Base on intended phones before choosing it for new rooms. No paid API is enabled. The max-players rule supplies the custom API default when capacity is omitted; hosts choose 2–8 explicitly, and solo is always 8. Changes open a new rules version in the preserved ranking backend; public leaderboard stays Coming soon. Existing rooms keep their snapshots. Website/operational edits do not create a new rules version.
8. **Score review**: verify the actual transcript and approve/reject; the server recalculates the score. Staff cannot review their own attempt. Human verification remains necessary; this is not automated anti-cheat.
9. **Room monitor**: latest room snapshots with bounded pagination. Closing requires a reason, confirmation and a current room revision. It expires the selected room, rejects subsequent takes/joins and disconnects clients on their next poll. It does not erase audio, scores, submissions or prior records. A request already in flight can complete; this is not network-level cancellation. Expired rooms cannot be reopened here.
10. **Activity & export**: paginated/searchable administrative audit records. JSON export contains website and catalog metadata, not audio binaries, player recordings, staff lists, access tokens or runtime secrets. It is **not a full database backup**; automatic restore/import is not included.
11. **Scoring Lab** (`/admin?tab=scoring`): choose a catalog reference and Party/Precision, upload a 0.25–15-second mimic file, optionally transcribe it locally, then calculate the test score. The report shows actual weights, component points, expected/heard words and signal warnings. ASR text is marked unverified; editing it switches the label to manual. Compare the original ASR result with a manually corrected transcript to see how recognition errors affected the word score. Never copy the answer key unless those were the words actually heard. Lab audio is sent to the game server only for calculation, is not stored, and does not affect matches/leaderboards. Rate limit: 60 calculations/hour per admin; a usage counter is stored.

## Free transcription and reference preparation

1. Pick **Speech** for words; pick **Effect / non-verbal** for a sound without canonical words. This is a scoring choice, not merely a category label. Both admin uploads and UGC support it. A moderator cannot change an empty-transcript effect into speech until a transcript is supplied through the appropriate content workflow.
2. Upload owned/permitted audio, set its actual language, generate an optional draft, then listen and correct every reference word. Save inactive while testing if needed; the Lab also accepts inactive catalog references.
3. In the Lab, test at least a correct mimic, wrong words, wrong pitch, and a weak/quiet recording. Use Indonesia and English samples from intended phones. Do not interpret the game score as ASR or voice-identity accuracy.
4. Tiny/Base execute on the current device using downloaded open models. There is no transcription API fee/key; network/data, storage and device compute are still required. Model selection for a Lab run or reference draft does not change player settings. Player model changes belong to Rules and affect only newly created rooms.
5. For new rooms, Precision speech defaults to P30/W35/T20/R15, Party speech to P60/R40, and non-verbal effects to T60/R40. Missing reference pitch changes effective weights; the report makes that explicit. Failed player ASR leaves W=0 while acoustic scoring continues; initial ASR model-load failure still needs retry or Party. See [SCORING.md](SCORING.md) for formulas and limitations.

## Versions and simultaneous edits

Website and operations share an optimistic revision. Saving stale settings returns HTTP 409 rather than overwriting another admin. Reload, compare and reapply your change. Successful publications are recorded in version history and audit. The last 20 versions are available from the UI. Loading history fills only the current section; review it and publish to apply as a new revision. Stored history is retained beyond the UI window.

Unsaved form edits warn before changing sections or leaving the page. Standard field lengths and server validation still apply even if a client is modified. This is not a general-purpose CMS or unrestricted database editor.

## Player-selected sounds

On `/create-match`, choose **Custom**, category/language and **Pick sounds (casual)**, then mark 1–50 active eligible clips. The host's pool is snapshotted into the room and shared by all participants. Ordering remains server-shuffled, without repeats until the pool is exhausted. Category, language and recording-duration limits still apply. Solo matchmaking always uses a random eligible pool and exactly 8 players; ranked rooms also reject custom pools. Disabling manual selection blocks newly created custom-pool rooms, not existing ones.

## Verification boundaries

Automated local D1/R2 Worker tests cover roles, CSRF, stale/concurrent setting saves, history/audit, operation switches, manual pool validation/synchronization, room closure and metadata export. DOM test doubles check escaped website text, selection controls and retry behavior; they are not a real browser. Prior browser-control restrictions still prevent visual/browser QA. Real-device layout, production login with invited staff, physical microphone timing and multi-device play remain to be tested manually. Deployment success is verified separately through Sites.
