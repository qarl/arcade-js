-- SPDX-License-Identifier: GPL-3.0-only
-- Per-emulated-frame state dump for the validation harness.
--
-- Dumps three RAM regions once per emulated frame, in this fixed order:
--   work   0x6000-0x6BFF  3072 bytes
--   sprite 0x7000-0x73FF  1024 bytes
--   video  0x7400-0x77FF  1024 bytes
--                         ---- 5120 bytes per frame
--
-- SAMPLING POINT: state[N] is the state after N frames have executed.
--   state[0] = power-on, before a single instruction runs
--   state[N] = after frames 0..N-1 have run
--
-- *** The frame notifier fires at the END of frame N, NOT the start. ***
-- Measured: the frame-0 notifier fires at t=0.0165s = 50688 cycles = exactly one
-- full frame period. So the notifier alone yields state-after-1-frame at index 0,
-- which is off by one from the contract above. We therefore dump ONCE at script
-- load (before any CPU execution) to produce the true state[0], and the notifier
-- supplies state[1..N].
--
-- This off-by-one was live and briefly shipped. It was invisible because the boot
-- RAM clear writes ZEROS over already-ZERO power-on RAM, so state[0] and state[1]
-- are byte-identical and a misalignment between them cannot be seen. It surfaced
-- only when one derivation gave 29 cycles/byte from Z80 instruction timings and my
-- indexing implied 19.4 -- a 1.5x disagreement that turned out to be exactly one
-- frame of cycles. Two independent derivations disagreeing is what caught it.
--
-- TWO MAME LUA LANDMINES, both cost real time to find:
--  1. add_machine_frame_notifier returns a subscription that UNSUBSCRIBES when
--     garbage-collected. It must be retained (here: a _G global) or you silently
--     get exactly one frame and a plausible-looking truncated file.
--  2. MAME exits without running any Lua stop hook, so buffered writes are lost.
--     setvbuf("no") is required; the last frame can still be a partial write, so
--     readers must truncate to whole frames.

local out = assert(io.open(os.getenv("STATE_OUT") or "state.bin", "wb"))
out:setvbuf("no")

local mem = manager.machine.devices[":maincpu"].spaces["program"]

-- Record the machine CONFIGURATION this capture ran under, so a golden set
-- certifies its own inputs rather than relying on MAME's defaults being intact.
-- DSW0 (read at 0x7D80) is an input to everything the ROM computes, and MAME
-- persists dipswitch changes to cfg/<game>.cfg -- a stray cfg silently changes
-- every golden frame and is invisible in the capture itself.
-- The ROM byte is a control: a probe reporting an expected
-- value must show it can report a non-trivial one.
local cfgf = io.open(os.getenv("CONFIG_OUT") or "config.txt", "w")
if cfgf then
  cfgf:setvbuf("no")
  cfgf:write(string.format("dsw0=0x%02X\ncontrol_rom0000=0x%02X\n",
    mem:read_u8(0x7D80), mem:read_u8(0x0000)))
  local cpu = manager.machine.devices[":maincpu"]
  for _, rn in ipairs({"AF","BC","DE","HL","IX","IY","SP"}) do
    local ok, v = pcall(function() return cpu.state[rn].value end)
    if ok and v ~= nil then cfgf:write(string.format("reg_%s=0x%04X\n", rn, v)) end
  end
  cfgf:close()
end

-- STATE_ENABLED=0 means "certify configuration only" -- used by --no-state, so a
-- frames-only golden still proves its own DSW0. Bit 7 of DSW0 is Cabinet, and
-- cocktail flips the screen, so a frames-only capture is the MOST DSW0-sensitive
-- artifact we produce.
if os.getenv("STATE_ENABLED") == "0" then return end

-- These regions mirror boards/dkong/hardware.json "stateRegions" (and the engine
-- constants in boards/dkong/memory.js). Keep them consistent with that file.
local REGIONS = {
  { 0x6000, 0x6BFF },  -- work
  { 0x7000, 0x73FF },  -- sprite
  { 0x7400, 0x77FF },  -- video
}

local function sample()
  local parts = {}
  for _, r in ipairs(REGIONS) do
    for a = r[1], r[2] do
      parts[#parts + 1] = string.char(mem:read_u8(a))
    end
  end
  out:write(table.concat(parts))
end

-- state[0]: true power-on state, sampled at script load before the CPU runs.
sample()

_G.__frame_count = 1
_G.__state_sub = emu.add_machine_frame_notifier(function()
  -- Fires at the END of frame N, so this writes state[N+1].
  sample()
  _G.__frame_count = _G.__frame_count + 1
end)
