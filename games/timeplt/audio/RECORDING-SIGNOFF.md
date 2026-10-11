# Time Pilot audio — recording sign-off

<!-- audio_gate.py parses the four fields below. rom_sha256 is the tpsound audio-CPU ROM -->
<!-- (manifest images.tpsound), the ROM that generates the recorded sound. Clips are gitignored copyright. -->

rom_sha256: d98da26e5ae670504d48b610d1956907c17fd8ecb9e3f0192b010bcb351023e8
clips: 30
date: 2026-10-10
by_ear: autonomous attestation, no human listen -- games/timeplt/tools/record_samples.py drove MAME and captured MAME's own audio per sound-latch command (0x00-0x1F swept, ROM latch writes muted while injecting), so each clip is MAME-sourced; audio_gate runs test/audio-map.test.js (every played command has its clip) and test/audio-wiring.test.js (the 0xC000 latch tap reaches the player) with nothing skipped, and tools/browser_runtime_gate.mjs hears a clip start in the browser on a coin.
