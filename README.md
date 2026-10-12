# MIMIC — Sound Battle (web)

An original browser-based sound imitation party game inspired by the *format* of voice party games, not affiliated with Mimic Party/FoliesAPP. No assets from that game are included. Avatars use the CC0 Kenney Mini Characters pack.

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

- Gameplay is split into dedicated URLs: `/` is a lightweight menu; `/choose-character` edits identity/avatar; `/create-match` configures category/language/profile and an optional collapsed sound library; `/matching` joins by invite code and `/matching?room=CODE` is the lobby; `/room/CODE` is the focused recording/playback arena. The Worker serves deep links, and same-document navigation keeps the armed microphone across lobby → arena. Back/forward, old `/?room=CODE` invitations, and sessionStorage resume are supported. A URL/code alone is not room authentication.
- `/leaderboard` is **Coming soon** only: no seasons, rankings, filters, or submission table. Ranked selection is absent from the main create flow; both Party and Precision are casual matches for now. Existing ranked data, moderation tools and backend endpoints are preserved, not deleted. Matching means code-based joining/lobby, **not automatic random-opponent matchmaking**.
- 2–8 players, room codes, or solo practice. Guest casual play does not require login.
- Server-owned shared clock and room state, polled approximately every second. Ready arms a disabled microphone stream; actual recording is only during the player's own recording window. No second take in a round. Keep the tab foregrounded.
- Shuffle without repeats until the chosen category/language pool is exhausted. All players get the same round sound. Rules and reference audio profiles are snapshotted at room creation.
- Players perform in lobby order. Each turn: reference playback → Ready → 3 → 2 → 1 → Start/record → score/shared playback → next player. After all players, next round or room standings. Each preparation cue is one second; Start is the first recording second. Only the active player's new take is accepted by the server. Timeout assigns zero (30-second post-record upload window for Party, 140 seconds for Precision). There is no live voice streaming or peer-to-peer/TURN dependency. Running legacy matches keep their old protocol; newly started matches use sequential turns.
- Casual Party profile: relative pitch contour 60%, rhythm 40%. Precision: default pitch 30%, words 35%, timbre 20%, rhythm 15%; adjustable by admin.
- Read [SCORING.md](SCORING.md) for exact formulas, perfect-score rules, transcription/pitch/timbre limitations and validation status. There is no separate musical-notation component and no measured real-voice accuracy percentage. Software test pass rates are not model accuracy.
- Browser Whisper tiny multilingual handles Precision transcription on each player device. First use downloads tens of MB from jsDelivr/Hugging Face. Server computes acoustic features and scores. Live transcript input is advisory/untrusted for competitive ranking.
- Preserved ranked backend (not offered in the new player flow): requires ChatGPT sign-in and Precision. Recordings stay pending until an admin hears them and supplies a verified transcript. Server recomputes the final score. Admin cannot review their own attempt. This is **not fully automated anti-cheat**, and modified reference playback can require human detection.
- Preserved ranking formula: category rating = average best approved score per distinct sound; overall rating = average of played category ratings. This is not ELO and does not normalize for category difficulty or coverage. Rule revisions and earlier ranking records are retained; the public leaderboard currently shows only Coming soon.
- Admin: audio uploads/metadata/permissions, category and language activation, rules and reaction text/audio, score moderation and activity log. Disable records instead of destructive deletion.
- Community UGC: browse approved sounds at `/community`, submit owned/licensed audio with creator credit and transcript, track review notes, and withdraw submissions. Sign-in is required to submit, not to browse or play casually. Indonesian/English UI; all active sound languages and categories are loaded from the admin catalog.
- Six original synthetic starter clips, three each in Indonesian and English; 14 selectable sound languages. No authentic influencer/meme catalog is claimed.

## Storage and access

### Admin Control Center

The `/admin` panel now opens on a real-data dashboard and includes dynamic website content, operational switches, room monitoring/closure, protected owner-managed Admin/Moderator roles, configuration version history, and a metadata-only JSON export. Existing sound/category/language/rule/UGC/ranked moderation editors are retained. All staff permissions are enforced on the server. Website and operation values are durable records in the existing `config` table; no schema migration is needed. Published content uses escaped plain text, never arbitrary HTML or JavaScript. Read [ADMIN-GUIDE.md](ADMIN-GUIDE.md) for access, maintenance behavior, version recovery and verification boundaries.

Casual hosts can choose a 1–50 sound pool within the selected category/language/duration limits. The server snapshots and shuffles that pool for all players. Ranked games stay random, and operators can disable new custom pools without changing running matches.

### 3D avatars

Choose one of 12 Kenney avatars on the dedicated `/choose-character` page. The lobby links back to that page for edits. The server validates an allowlisted avatar ID, stores it in the room, and synchronizes it to other players. Choices lock when a match starts. Existing rooms without an avatar use the default character. The arena keeps a compact 2D/3D stage without the character picker; the current turn/countdown and scoring take priority. There is no arbitrary model upload endpoint.

Three.js is lazy-loaded for the decorative living-room stage. One canvas survives room UI refreshes. Independent cloned skeletons play idle, recording/replay gestures, nod/shake reactions, and a perfect-score/winner jump animation. Reactions follow the authoritative room state and server-adjusted clock; the player keeps the same seat throughout the match. These are body animations, **not facial animation or lip-sync**. The original primitive-geometry room does not use the supplied props whose public-use licenses are still unconfirmed.

The **2D / 3D** button stores a device-local view preference. Save-Data defaults to 2D. Reduced-motion makes avatar poses static and disables confetti. WebGL/import/model failure falls back to thumbnails without blocking game controls, microphone recording or scoring. Rendering is capped at 30 FPS and device pixel ratio 1.5, and pauses when offscreen or the tab is hidden. Only characters present in the scene are requested; all 12 GLBs combined are approximately 3 MB. GPU resources are released on disabling 3D/page exit.

Files: `client/stage-3d.js`, `client/stage-scene.js`, `public/avatars.js`, `public/avatar-ui.js`, `public/avatars.css`, and `public/models/kenney/`. The build bundles Three.js and includes `.glb`/PNG assets with their correct MIME types. To re-import the same pack from an authorized local ZIP: `node scripts/import-characters.mjs /path/to/kenney_mini-characters.zip`. Preserve the shared `Textures/colormap.png` and `License.txt`. Credits and asset decisions are in `ASSETS.md`.

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

Automated local Worker integration: two-client shared clock, selection and snapshots, role/CSRF guards, duplicate submissions, R2 audio access, moderation, category/overall boards, seasonal isolation, upload validation. Mock microphone lifecycle tested. These tests use synthetic audio, not physical microphones. Browser visual QA was blocked by the browser-control policy in this session; mobile rendering, physical microphone timing and multi-device/network gameplay need real-device testing. No live voice chat, random sabotage wheel, or team-versus mode is included in this release.

Sequential-turn checks cover exact countdown boundaries, active-player capture gating, escaped names/status markup with DOM doubles, rejected out-of-turn/early uploads, two-client timestamp agreement, concurrent polling without double credit, timeout/next-player/next-round/final transitions, solo play and legacy match compatibility. Controlled-feature scoring tests verify token edit similarity, semitone/MFCC/duration/energy formulas, raw-value weighting, perfect thresholds, silent input and reaction boundaries. These are algorithm/workflow tests, not a human speech benchmark.

Page-flow checks cover route parsing, guarded next URLs, invitation preservation, valid session parsing, localized/escaped page-specific content, character → create → lobby → arena transitions, preserving the armed stream across navigation, preventing accidental second membership, deep-link refresh support, no capture outside the arena, and no microphone prompt after navigating away during preparation. Leaderboard checks assert Coming soon without controls or ranking API calls. Controller checks use DOM doubles, not a rendered browser or physical microphone.

Avatar checks cover all 12 actual GLB files, 32 clips per model, independent cloned skeletons, finite animated bounds, texture/thumbnail files, 1–8 stage positions, room synchronization, legacy fallback, authorization, invalid model paths and battle locking. An offline Blender render checks scene/asset composition only; it is not a screenshot of the browser or proof of WebGL/mobile performance.

UGC integration coverage: identity and consent validation, private audio ownership, idempotent uploads, approval/rejection, casual-vs-ranked eligibility, multilingual/category filtering, inclusion in room snapshots, withdrawal, stale admin edits, concurrent moderation and upload quotas, no orphan R2 files on quota/duplicate losses, and pagination. These run against an isolated local Worker with D1/R2, not real production creator records. Public deployment is verified separately by Sites deployment status.
