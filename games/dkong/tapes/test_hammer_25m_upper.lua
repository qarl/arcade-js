-- SPDX-License-Identifier: GPL-3.0-only
local M=manager.machine
local mem=M.devices[":maincpu"].spaces["program"]
local I2=M.ioport.ports[":IN2"];local I0=M.ioport.ports[":IN0"]
local coin=I2.fields["Coin 1"];local start=I2.fields["1 Player Start"];local jump=I0.fields["P1 Button 1"]
local f=0
_G.__h=emu.add_machine_frame_notifier(function()
 f=f+1
 coin:set_value((f>=399 and f<400) and 1 or 0)
 start:set_value((f>=459 and f<460) and 1 or 0)
 if f>=1549 and f<=1560 then mem:write_u8(0x6203,0x28);mem:write_u8(0x6205,0x70) end
 jump:set_value((f>=1559 and f<1579) and 1 or 0)
end)