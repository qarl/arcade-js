-- SPDX-License-Identifier: GPL-3.0-only
-- TAPE: coin + start, then a MODE.  The authored input tapes live here.
--
--   TAPE_MODE=idle  (default)  press nothing after start
--   TAPE_MODE=play             hold Right, pulse Jump -- Mario walks, climbs, jumps
--
-- ONE FILE, not one per mode, ON PURPOSE: the coin/start frame numbers are
-- PINNED CONTRACT VALUES, and a second file duplicating them is a place for them
-- to drift apart silently. Modes differ only in what happens AFTER start.
--
-- DESIGN RULE: minimise input events, maximise code reached.
-- This tape presses exactly TWO buttons and then does NOTHING. It is expected to
-- unlock game init, level setup, Kong's animation, barrel spawn and roll, the
-- bonus timer, collision, DEATH, life decrement, respawn, the second and third
-- deaths, GAME OVER, and the high-score path.
--
-- Deliberately does NOT play. Playing WELL reaches less code per unit of
-- authoring effort than dying does -- a good player avoids the death routine,
-- which is one of the branches we need most.
--
-- FRAGILITY: tape fragility scales with input count. A 2-event tape is nearly
-- immune to timing drift; a 200-event tape is unmaintainable the moment anything
-- upstream shifts by a frame, because every later event lands in a different
-- game state. Prefer many short tapes from known states over one long one.
--
-- ==========================================================================
-- PINNED CONTRACT VALUES -- these are INPUTS to every golden captured with this
-- tape, recorded alongside FROZEN_OFFSET / DSW0_EXPECTED / WRITE_TIMESTAMP /
-- Z80_RESET_STATE. WHEN the coin lands relative to the attract cycle may select
-- a different code path, so a tape whose timing is incidental rather than stated
-- is a reproducibility hazard wearing a filename.
-- ==========================================================================
-- Defaults are the CONTRACT for this tape and must not drift. The env overrides
-- exist so the timings can be SWEPT to find the earliest frame at which a coin
-- is actually accepted -- a measurement, not a reconfiguration. A sweep that
-- edits the file in place loses the contract; one that passes env keeps it.
local COIN_FRAME     = tonumber(os.getenv("TAPE_COIN_FRAME") or "400")
local COIN_HOLD      = tonumber(os.getenv("TAPE_COIN_HOLD") or "6")
local START_FRAME    = tonumber(os.getenv("TAPE_START_FRAME") or "460")
local START_HOLD     = tonumber(os.getenv("TAPE_START_HOLD") or "6")
-- IN2 masks, read from the live machine rather than assumed:
--   0x80 = Coin 1        0x04 = 1 Player Start
-- SERVICE is EXCLUDED and must never be added: it jumps to
-- 0x4000, a diagnostic ROM this romset does not ship. It is the one input where
-- REACHING the branch makes things worse.

-- COMPOSABILITY: MAME accepts only one -autoboot_script, so a tape must be able
-- to carry an instrument. Set TAPE_INSTRUMENT to a Lua path (exec_coverage.lua,
-- dump_writes.lua, dump_state.lua, ...) and it is loaded alongside the input.
-- Without this a tape and an instrument could never run together, which would
-- make every tape unmeasurable.
local instrument = os.getenv("TAPE_INSTRUMENT")
if instrument and #instrument > 0 then
  dofile(instrument)
end

-- PLAY-MODE constants. Both are PERIODIC rather than game-state-dependent, so
-- they are immune to timing drift -- a tape that presses "jump when Mario is at
-- the third ladder" breaks the moment anything upstream shifts by a frame.
local JUMP_PERIOD    = 48    -- pulse Button 1 every 48 frames (~0.8s)
local JUMP_HOLD      = 4
local RIGHT_FROM     = 480   -- hold Right from just after start, continuously

local mode = os.getenv("TAPE_MODE") or "idle"
assert(mode == "idle" or mode == "play", "TAPE_MODE must be idle or play")

local IN2 = manager.machine.ioport.ports[":IN2"]
local IN0 = manager.machine.ioport.ports[":IN0"]
local coin  = IN2 and IN2.fields["Coin 1"]
local start = IN2 and IN2.fields["1 Player Start"]
local jump  = IN0 and IN0.fields["P1 Button 1"]
local right = IN0 and IN0.fields["P1 Right"]
assert(coin,  "IN2 'Coin 1' field not found")
assert(start, "IN2 '1 Player Start' field not found")
assert(jump,  "IN0 'P1 Button 1' field not found")
assert(right, "IN0 'P1 Right' field not found")

-- SERVICE is present on this machine at IN2 mask 0x01 and on :SERVICE1. It is
-- NEVER touched here. Holding it jumps to 0x4000, a diagnostic
-- ROM this romset does not ship. It is the ONE input where REACHING the branch
-- makes things worse, so the asymmetry is worth restating at the point of
-- temptation -- a coverage push naturally wants to press everything.

local log = io.open(os.getenv("TAPE_LOG") or "tape.log", "w")
if log then log:setvbuf("no") end

_G.__tape_frame = 0
_G.__tape_sub = emu.add_machine_frame_notifier(function()
  local f = _G.__tape_frame
  _G.__tape_frame = f + 1

  local want_coin  = (f >= COIN_FRAME)  and (f < COIN_FRAME  + COIN_HOLD)
  local want_start = (f >= START_FRAME) and (f < START_FRAME + START_HOLD)

  coin:set_value(want_coin and 1 or 0)
  start:set_value(want_start and 1 or 0)

  if mode == "play" then
    local in_jump = (f >= RIGHT_FROM) and ((f - RIGHT_FROM) % JUMP_PERIOD < JUMP_HOLD)
    jump:set_value(in_jump and 1 or 0)
    right:set_value((f >= RIGHT_FROM) and 1 or 0)
  end

  if log and (f == COIN_FRAME or f == COIN_FRAME + COIN_HOLD
              or f == START_FRAME or f == START_FRAME + START_HOLD) then
    log:write(string.format("frame %d  mode=%s coin=%d start=%d\n",
      f, mode, want_coin and 1 or 0, want_start and 1 or 0))
  end
end)
