local M=manager.machine
local mem=M.devices[":maincpu"].spaces["program"]
local I2=M.ioport.ports[":IN2"];local I0=M.ioport.ports[":IN0"]
local coin=I2.fields["Coin 1"];local start=I2.fields["1 Player Start"];local inp=I0.fields["P1 Right"]
assert(coin and start and inp,"fields")
local f=0
_G.__ts=emu.add_machine_frame_notifier(function()
 f=f+1
 coin:set_value((f>=399 and f<400) and 1 or 0)
 start:set_value((f>=459 and f<460) and 1 or 0)
 if f>=1600 and f<=1601 then mem:write_u8(0x6203,0x60);mem:write_u8(0x6205,0x90) end
 inp:set_value((f>=1600 and f<1740) and 1 or 0)
end)