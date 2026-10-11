# MIMIC — Sound Battle (web)

An original browser-based sound imitation party game inspired by the *format* of voice party games, not affiliated with Mimic Party/FoliesAPP. No third-party game assets are included.

## Run locally

Requires Node 22.13+ (tested with Node 24).

```sh
npm ci
npm run build
npm test
npm run dev
```

Open `http://127.0.0.1:4173/`. Preview uses a persistent local D1/R2 emulator. `/_preview/session?role=admin&return_to=/admin` enables a **local-only test identity**; use `role=player` or `role=none` for other roles. The preview binds only to loopback, strips incoming identity headers, and does not ship in the Worker. Production login is provided by Sites, never by this simulator.

## Product

- 2–8 players, room codes, or solo practice. Guest casual play does not require login.
- Server-owned shared clock and room state, polled approximately every second. Ready arms a disabled microphone stream; actual recording is only during the shared recording window. No second take in a round. Keep the tab foregrounded.
- Shuffle without repeats until the chosen category/language pool is exhausted. All players get the same round sound. Rules and reference audio profiles are snapshotted at room creation.
- Listen together → record together → collect/score → sequential shared playback → next round → room standings. If a player disconnects, the server eventually assigns zero for a missing take and continues. No peer-to-peer or TURN dependency.
- Casual Party profile: relative pitch contour 60%, rhythm 40%. Precision: default pitch 30%, words 35%, timbre 20%, rhythm 15%; adjustable by admin.
- Browser Whisper tiny multilingual handles Precision transcription on each player device. First use downloads tens of MB from jsDelivr/Hugging Face. Server computes acoustic features and scores. Live transcript input is advisory/untrusted for competitive ranking.
- Ranked requires ChatGPT sign-in and Precision. Recordings stay pending until an admin hears them and supplies a verified transcript. Server recomputes the final score. Admin cannot review their own attempt. This is **not fully automated anti-cheat**, and modified reference playback can require human detection.
- Category rating = average best approved score per distinct sound; overall rating = average of played category ratings. This is not ELO and does not normalize for category difficulty or coverage. Rule edits create new leaderboard seasons; earlier seasons remain readable.
- Admin: audio uploads/metadata/permissions, category and language activation, rules and reaction text/audio, score moderation and activity log. Disable records instead of destructive deletion.
- Community UGC: browse approved sounds at `/community`, submit owned/licensed audio with creator credit and transcript, track review notes, and withdraw submissions. Sign-in is required to submit, not to browse or play casually. Indonesian/English UI; all active sound languages and categories are loaded from the admin catalog.
- Six original synthetic starter clips, three each in Indonesian and English; 14 selectable sound languages. No authentic influencer/meme catalog is claimed.

## Storage and access

### Community sounds (UGC)

1. A signed-in creator uploads a 0.25–15 second clip (up to 8 MB before browser conversion to mono PCM16/16 kHz WAV). The server validates the actual WAV, bounds the request, rejects silence and computes the reference profile. Metadata includes a public creator name, exact transcript, category, language, source, permission details and explicit publication consent. No scraping or automatic licensing of viral/influencer audio is included.
2. R2 stores the audio; D1 stores ownership, metadata, status and audit trail. Pending, rejected and withdrawn audio is available only to its creator and admins. Creator IDs, acoustic profiles and private review notes are not in the public community response.
3. Admin Studio → **UGC moderation** lists the oldest pending submissions first. Listen and verify transcript, permissions and content safety, then approve or reject (with a required reason). Approval atomically creates a casual-only catalog sound. A separate Sound library setting enables ranked eligibility; UGC approval never grants leaderboard points. Only sounds within a room's recording limit are eligible for its shuffle.
4. Public community browsing has category/language filters and pagination. Approved UGC enters the existing server-owned multiplayer selection. Inactive sounds/categories/languages are omitted and their UGC audio is no longer publicly served.
5. Creators can withdraw their own submissions. Withdrawal blocks new public audio requests and selection in new rooms, cannot be reversed by a stale admin edit, and does not erase copies already loaded by players. Files and moderation records remain stored; automatic deletion is not implemented. UGC audio replacement is disallowed in admin editing to preserve creator attribution; submit a new clip instead.

Server-enforced limits: 5 submissions per rolling 24 hours, at most 10 pending. Atomic quota checks prevent concurrent bypass; request IDs make retries idempotent. Moderation and withdrawal are transactional, and losing upload contenders remove only their own unreferenced R2 object. Public audio responses use `private, no-store` so every new request rechecks visibility. Review is manual, not automated abuse/copyright detection. This release has no creator monetization, sound packs, comments, or public reporting queue.

Hosted configuration: `.openai/hosting.json`, logical D1 `DB`, R2 `BUCKET`. `ADMIN_EMAILS` is a runtime secret allowlist, never in browser code. Trusted identity headers come only from the Sites dispatch layer. All writes reject foreign origins. Room bearer tokens are scoped to a room and stored hashed in D1; clients keep their own token in sessionStorage for reload recovery. Rooms expire after two hours. Uploaded library clips are public content; player recordings are accessible only to room members during the room lifetime and to authorized ranked reviewers. Stored recordings are retained; this version does **not** implement scheduled automatic deletion. Do not use for sensitive recordings.

Schema is in `db/schema.ts`; generated schema-only migrations are in `drizzle/`. Use `npm run db:generate` after schema changes. Source assets are in `public/`, backend in `server/`; build emits a self-contained Worker and client assets in `dist/`. Intermediate reference features and static asset manifests in `work/` are regenerated by build and are not source requirements.

## Verified / not verified

Automated local Worker integration: two-client shared clock, selection and snapshots, role/CSRF guards, duplicate submissions, R2 audio access, moderation, category/overall boards, seasonal isolation, upload validation. Mock microphone lifecycle tested. These tests use synthetic audio, not physical microphones. Browser visual QA was blocked by the browser-control policy in this session; mobile rendering, physical microphone timing and multi-device/network gameplay need real-device testing. No live voice chat, random sabotage wheel, 3D avatars, or team-versus mode is included in this release.

UGC integration coverage: identity and consent validation, private audio ownership, idempotent uploads, approval/rejection, casual-vs-ranked eligibility, multilingual/category filtering, inclusion in room snapshots, withdrawal, stale admin edits, concurrent moderation and upload quotas, no orphan R2 files on quota/duplicate losses, and pagination. These run against an isolated local Worker with D1/R2, not real production creator records. Public deployment is verified separately by Sites deployment status.
