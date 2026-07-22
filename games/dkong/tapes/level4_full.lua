-- SPDX-License-Identifier: GPL-3.0-only
-- MAME L4 golden: coin+start (offset -1 vs emit) + game-start board-4 pre-set,
-- matching the emit --input/--poke recipe (see docs/POKE-TO-ADVANCE.md). Board ptr
-- 0x783A points at the 0x3A70 sequence-table entry for type 4.
local mach = manager.machine
local mem  = mach.devices[":maincpu"].spaces["program"]
local IN2  = mach.ioport.ports[":IN2"]
local coin  = IN2 and IN2.fields["Coin 1"]
local start = IN2 and IN2.fields["1 Player Start"]
assert(coin and start, "IN2 Coin/Start fields not found")
local f = 0
_G.__l4f_sub = emu.add_machine_frame_notifier(function()
  f = f + 1
  coin:set_value((f >= 399 and f < 400) and 1 or 0)
  start:set_value((f >= 459 and f < 460) and 1 or 0)
  if f >= 464 and f <= 1463 then
    mem:write_u8(0x604A, 0x78); mem:write_u8(0x604B, 0x3A); mem:write_u8(0x6049, 0x04)
    mem:write_u8(0x622A, 0x78); mem:write_u8(0x622B, 0x3A)
    mem:write_u8(0x6227, 0x04); mem:write_u8(0x6229, 0x04)
  end
end)
