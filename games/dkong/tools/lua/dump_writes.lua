-- SPDX-License-Identifier: GPL-3.0-only
-- HARDWARE WRITE TRACE -- gates "what the ROM computes WITH".
--
-- The state dump covers RAM: what the ROM computes INTO. The machine state it
-- manipulates alongside that -- control latches, DMA programming, sound latches
-- -- sits outside it and was gated by nothing.
--
-- Those latches were originally recorded as ungated because latch STATE is
-- write-only and MAME exposes no `.state` for the device. That conclusion was
-- wrong, and the correction is the useful part:
--
--   "We cannot observe X" is a claim about our INSTRUMENTS, not about X.
--
-- Latch state is unreadable; latch WRITES are fully observable. And the write is
-- the part that matters here: a write is an ACTION THE CPU TAKES, so it is
-- TRANSLATION correctness and observable now. The latch's resulting state is
-- device-internal, so it is HARDWARE-MODEL correctness and needs a renderer.
-- The failure-domain split, applied to a surface nobody had separated.
--
-- ORDER IS PART OF THE CONTRACT, not an implementation detail. Boot writes the
-- latches as: xor a / three stores / inc a / one store -- the first three take
-- A=0 and the fourth A=1. A set-comparison would call a reordered trace
-- equivalent; it is not.
--
-- Determinism verified: 2505 writes over 3 emulated seconds, byte-identical
-- across two independent runs.
--
-- Env: WRITES_OUT (output path)

local sp = manager.machine.devices[":maincpu"].spaces["program"]
local out = assert(io.open(os.getenv("WRITES_OUT") or "wtrace.txt", "w"))
out:setvbuf("no")

-- The full hardware write surface outside RAM (lead-defined address set).
-- Mirrors boards/dkong/hardware.json "writeRanges" (and tools/writeio.py RANGES).
-- Keep them consistent with that file.
local RANGES = {
  { 0x7800, 0x780F, "dma8257" },      -- i8257 programming
  { 0x7C00, 0x7C00, "sound_latch" },  -- ls175.3d -- modelled by nothing until now
  { 0x7C80, 0x7C80, "grid_color" },   -- radarscp grid colour
  { 0x7D00, 0x7D07, "sound_trig" },   -- ls259.6h sound triggers
  { 0x7D80, 0x7D87, "control" },      -- flipscreen, sprite bank, palette bank, NMI mask, DRQ
}

-- Retain the subscriptions: MAME notifier/tap handles unsubscribe when garbage
-- collected, which silently yields a truncated trace that looks plausible.
_G.__write_taps = {}
_G.__write_count = 0

for i, r in ipairs(RANGES) do
  _G.__write_taps[i] = sp:install_write_tap(r[1], r[2], r[3], function(offset, data, mask)
    -- One line per write: cycle, address, value. Cycles are recorded now but the
    -- differ compares SEQUENCE first (addr,value) -- cycle-exactness waits on the
    -- JS side's DMA cycle accounting.
    local secs = manager.machine.time:as_double()
    out:write(string.format("%.0f %04X %02X\n", secs * 3072000, offset, data))
    _G.__write_count = _G.__write_count + 1
    return data
  end)
end
