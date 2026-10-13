# User-provided Bleach audio

Four MP3 clips supplied by the site owner, converted without trimming to mono PCM16 16 kHz WAV. Original files in Downloads were not changed. These are not original MIMIC or CC0 audio; public-use permission is unconfirmed.

Manifest transcripts are **unverified automatic Whisper Base drafts** in Japanese, with obvious recognition errors. They are not canonical Bleach quotations or an approved scoring answer key. An admin must listen, correct the transcript and confirm the permission description before activation. All four sounds initially import as inactive and not ranked. Draft audio is served only to authenticated staff; no audio is copied into public static assets.

The build embeds the WAV bytes into the server-only content seed, then the first API request stores them in R2 and inserts catalog metadata idempotently. Later deployments never overwrite an admin's edits or reactivate disabled content. The `bleach-theme-pack-v1` config marker prevents reseeding. Source and deployment artifacts therefore contain the audio; keep access limited to project collaborators.
