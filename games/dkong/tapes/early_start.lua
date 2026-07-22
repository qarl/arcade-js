-- SPDX-License-Identifier: GPL-3.0-only
-- EARLY-START TAPE: coin and start as soon as the ROM will accept them.
--
-- WHY THIS EXISTS AND WHY IT IS A SEPARATE FILE. coin_start.lua coins at frame
-- 400, which puts the first sprite on screen at frame 502. Sprite RAM is
-- all-zero before that, so the ROM code that FILLS sprite RAM is ungated until
-- translation reaches frame 502 -- 516 frames past where it currently stops.
--
-- Measured: first_sprite_frame = START_FRAME + 72, EXACTLY, across every
-- accepted run from start@8 to start@430. Not approximately -- exactly, every
-- time. The onset is entirely tape-controlled and 72 frames is a fixed cost of
-- the start sequence.
--
-- So the required translation reach is a tape parameter, and this tape sets it
-- to ~88 instead of ~502.
--
-- THIS DOES NOT REPLACE coin_start.lua. A coin landing at a different point in
-- the attract cycle may select a different code path, so the two tapes exercise
-- different things and both are worth keeping. Two tapes with stated contracts
-- beat one tape with drifting defaults.
--
-- ==========================================================================
-- THE TIMING IS CHOSEN, NOT MINIMAL, AND HERE IS THE MARGIN
-- ==========================================================================
-- Swept: coin at frame 2 or earlier is REJECTED; coin at frame 3 is ACCEPTED.
-- The cliff is between 2 and 3, presumably the first input poll after boot.
--
--   coin@5  start@8   -> first sprite frame 80   (2 frames of margin)
--   coin@10 start@16  -> first sprite frame 88   (7 frames of margin)
--
-- TAKING THE SLOWER ONE ON PURPOSE. A tape sitting two frames from a rejection
-- cliff is a reproducibility hazard wearing a filename: any future change to
-- boot timing silently converts it into a tape that tests attract mode. The 8
-- extra frames are noise against the ~414 this saves, and margin is the whole
-- point of choosing rather than minimising.
-- ==========================================================================
local COIN_FRAME  = tonumber(os.getenv("TAPE_COIN_FRAME") or "10")
local COIN_HOLD   = tonumber(os.getenv("TAPE_COIN_HOLD") or "6")
local START_FRAME = tonumber(os.getenv("TAPE_START_FRAME") or "16")
local START_HOLD  = tonumber(os.getenv("TAPE_START_HOLD") or "6")

-- Expected sprite onset, asserted rather than assumed. See the control below.
local EXPECT_SPRITE_FRAME = START_FRAME + 72

-- ==========================================================================
-- THE CONTROL, AND IT IS NOT OPTIONAL
-- ==========================================================================
-- A REJECTED COIN DOES NOT PRODUCE "NO SPRITES". Attract mode brings its own
-- sprites up at frame ~521 regardless. So "are there sprites yet" scores every
-- rejected run as a SUCCESS ARRIVING LATE -- a check that looks pessimistic and
-- fails optimistically, silently.
--
--   39 non-zero sprite bytes  =  game started      (this tape's intent)
--   88 non-zero sprite bytes  =  coin REJECTED, attract ran to its own onset
--
-- Two trivially distinguishable signatures, neither of which is zero. So the
-- tape asserts the COUNT and the FRAME, and refuses an unrecognised
-- combination rather than guessing which one it got.
local EXPECT_SPRITE_NONZERO = 39
local ATTRACT_SPRITE_NONZERO = 88

-- IN2 masks, read from the live machine rather than assumed:
--   0x80 = Coin 1        0x04 = 1 Player Start
-- SERVICE is EXCLUDED and must never be added: it jumps to
-- 0x4000, a diagnostic ROM this romset does not ship. It is the one input where
-- REACHING the branch makes things worse.
local COIN_MASK  = 0x80
local START_MASK = 0x04

local ports = manager.machine.ioport.ports
local in2 = ports[":IN2"]
assert(in2, "no :IN2 port -- the input map is not what this tape assumes")

local coin_field, start_field
for name, f in pairs(in2.fields) do
  if f.mask == COIN_MASK then coin_field = f end
  if f.mask == START_MASK then start_field = f end
end
assert(coin_field, "no field with the coin mask on :IN2")
assert(start_field, "no field with the start mask on :IN2")

local cpu = manager.machine.devices[":maincpu"]
local sp = cpu.spaces["program"]
local log = io.open(os.getenv("TAPE_LOG") or "early_start.log", "w")
if log then log:setvbuf("no") end

local frame = 0
_G.__es_sub = emu.add_machine_frame_notifier(function()
  local f = frame
  frame = f + 1

  local want_coin  = (f >= COIN_FRAME)  and (f < COIN_FRAME  + COIN_HOLD)
  local want_start = (f >= START_FRAME) and (f < START_FRAME + START_HOLD)
  coin_field:set_value(want_coin and 1 or 0)
  start_field:set_value(want_start and 1 or 0)

  -- Evaluate the control at the predicted onset, not at some later "did it
  -- work" moment: the whole point is that late success and failure look alike.
  if f == EXPECT_SPRITE_FRAME then
    local nz = 0
    for a = 0x7000, 0x73FF do
      if sp:read_u8(a) ~= 0 then nz = nz + 1 end
    end
    local verdict
    if nz == EXPECT_SPRITE_NONZERO then
      verdict = "OK game started"
    elseif nz == ATTRACT_SPRITE_NONZERO then
      verdict = "FAIL coin REJECTED -- this is attract mode, not a game"
    elseif nz == 0 then
      verdict = "FAIL no sprites at the predicted onset"
    else
      verdict = "FAIL unrecognised sprite count -- refusing to guess which"
    end
    if log then
      log:write(string.format(
        "frame %d: sprite nonzero = %d (expect %d game / %d attract) -> %s\n",
        f, nz, EXPECT_SPRITE_NONZERO, ATTRACT_SPRITE_NONZERO, verdict))
    end
  end

  if log and (f == COIN_FRAME or f == START_FRAME) then
    log:write(string.format("frame %d: %s asserted\n", f,
      f == COIN_FRAME and "COIN" or "START"))
  end
end)
