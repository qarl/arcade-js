-- SPDX-License-Identifier: GPL-3.0-only
-- PC-EXACT state capture -- closes the PC-sampling gap.
--
-- state-diff samples at frame boundaries, so a state that exists only PARTWAY
-- through a frame is invisible to it. That is a real limit: the
-- post-boot-init fingerprint (VRAM filled with 0x10) is a genuine machine state
-- that is fully overwritten before the next boundary, so frame-boundary
-- sampling can never see it.
--
-- HOW, and why no debugger is needed:
-- `space:install_read_tap` works WITHOUT -debug, unlike `cpu.debug` which MAME
-- 0.288 only exposes under the debugger and whose breakpoint action did not fire
-- under -debugger none. A read tap on a ROM address fires when that byte is
-- FETCHED, so tapping a single instruction address gives us that instruction's
-- moment. State is sampled BEFORE the instruction executes, which is what
-- "state at PC=X" should mean.
--
-- Tap ONE address, not a range: tapping all of ROM costs ~8750 callbacks/frame,
-- while a single address fires once.
--
-- CAVEAT worth knowing: a read tap sees operand fetches as well as opcode
-- fetches, so a hit at address X could be an operand byte of an instruction
-- starting earlier. For routine entry points and jump targets -- the addresses
-- worth sampling -- the first fetch is the opcode.
--
-- Emits the SAME 5120-byte state format as dump_state.lua (work + sprite +
-- video, in that order), so the existing differ compares it with no changes.
--
-- Env: PC_TARGET (e.g. 0x02B8), STATE_OUT, PC_META (optional, cycle/provenance)

local sp = manager.machine.devices[":maincpu"].spaces["program"]
local target = tonumber(os.getenv("PC_TARGET") or "0x02B8")

-- Machine CONFIGURATION, written on every capture path. Omitting it here made
-- --at-pc captures skip DSW0 certification entirely and still certify green --
-- the "silent skip = false pass" class, in the very captures used to confirm
-- fingerprint claims. Control byte.
local cfgf = io.open(os.getenv("CONFIG_OUT") or "config.txt", "w")
if cfgf then
  cfgf:setvbuf("no")
  cfgf:write(string.format("dsw0=0x%02X\ncontrol_rom0000=0x%02X\n",
    sp:read_u8(0x7D80), sp:read_u8(0x0000)))
  local cpu = manager.machine.devices[":maincpu"]
  for _, rn in ipairs({"AF","BC","DE","HL","IX","IY","SP"}) do
    local ok, v = pcall(function() return cpu.state[rn].value end)
    if ok and v ~= nil then cfgf:write(string.format("reg_%s=0x%04X\n", rn, v)) end
  end
  cfgf:close()
end

local out = assert(io.open(os.getenv("STATE_OUT") or "state_at_pc.bin", "wb"))
out:setvbuf("no")
local meta = io.open(os.getenv("PC_META") or "state_at_pc.txt", "w")
if meta then meta:setvbuf("no") end

-- These regions mirror boards/dkong/hardware.json "stateRegions" (and the engine
-- constants in boards/dkong/memory.js). Keep them consistent with that file.
local REGIONS = {
  { 0x6000, 0x6BFF }, -- work
  { 0x7000, 0x73FF }, -- sprite
  { 0x7400, 0x77FF }, -- video
}

_G.__pc_done = false
_G.__pc_tap = sp:install_read_tap(target, target, "pc_exact", function(offset, data, mask)
  -- First hit only. A routine entry reached every frame would otherwise emit
  -- thousands of samples.
  if _G.__pc_done then return data end
  _G.__pc_done = true

  local parts = {}
  for _, r in ipairs(REGIONS) do
    for a = r[1], r[2] do
      parts[#parts + 1] = string.char(sp:read_u8(a))
    end
  end
  out:write(table.concat(parts))

  if meta then
    local secs = manager.machine.time:as_double()
    meta:write(string.format(
      "pc=0x%04X\nopcode_byte=0x%02X\nseconds=%.9f\ncycles=%.0f\n",
      target, data, secs, secs * 3072000))
  end
  return data
end)
