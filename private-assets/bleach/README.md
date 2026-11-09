# User-provided Bleach audio

The owner supplied four Bleach MP3 recordings and confirmed permission to use them in the public game on 2026-10-28. The originals in Downloads were not changed. The project includes mono PCM16 16 kHz WAV conversions in `private-assets/samples/` and their metadata in `private-assets/sample-collections.json`.

These four sounds are active for casual Party matches under **Anime → Bleach**. Their displayed text is an unverified play hint. An admin must listen to each reference, correct the exact transcript, and mark it reviewed before using the sound for Precision word scoring or ranked matches.

The Netlify build embeds the WAV bytes in the server Function. Playback goes through an access-checked game route, so disabling a sound blocks new requests. The initial seed preserves later admin edits and disabled states. Audio already downloaded by a player cannot be recalled.
