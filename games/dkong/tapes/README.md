# games/dkong/tapes/ — validation input tapes

These are **MAME Lua input scripts**: run under `mame dkong -autoboot_script <tape>.lua`, each
registers a per-frame notifier that presses inputs (`IN2` Coin/Start, `IN0` P1 directions/jump)
and/or pokes RAM, so MAME reaches a specific state deterministically. They are the fixtures the
pixel/state gate compares our JavaScript translation against (the emitter mirrors each tape's
inputs/pokes on the JS side).

Convention across tapes (the "pinned contract"): **coin at frame ~400, start at ~460**; frame
numbering is 1-based, end-of-frame (the JS emitter uses N+1 vs the MAME notifier's N).

| tape | board | exercises |
|---|---|---|
| `coin_start` | 25m | the foundational path: attract → credit → game-init → a barrel → **death** → game-over → high-score (dies on purpose — dying reaches more code) |
| `early_start` | 25m | same, but coins/starts as early as the ROM accepts (first sprite ~frame 80 instead of ~500) |
| `move_slope` | 25m | poke Mario onto a mid-board slope, hold Right — validates the `0x2AB4` slope-collision translation |
| `test_b1_walk_right` / `_walk_left` / `_climb_up` / `_jump` | 25m | single-input movement from a poked position |
| `test_b3_walk_right` | 75m | walk (pokes the board-3 pre-set to load 75m) |
| `test_b4_walk_right` | 100m | walk (pokes the board-4 pre-set to load 100m) |
| `test_hammer_25m_lower` / `_upper` | 25m | poke Mario beside a hammer, jump to grab — verify the hammer-active latch (`0x6217`) |
| `test_hammer_50m` / `_50m_upper` | 50m | hammer grab on the conveyor board |
| `level3_full` | 75m | coin+start + board-3 pre-set (for capturing a 75m golden) |
| `level4_full` | 100m | coin+start + board-4 pre-set (for capturing a 100m golden) |

Higher boards are reached by **poking the board-type state** rather than by playing up to them —
see the porting docs. The board-2 (50m) full recipe and various climb experiments were working
scratch tapes and are intentionally not published here.
