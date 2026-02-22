# main.py — Entry point + main polling loop
#
# Wires together Engine, GpioManager, and SerialHandler,
# then runs the main loop forever.

import time
from engine import Engine
from gpio_manager import GpioManager
from serial_handler import SerialHandler


def main():
    engine = Engine()
    gpio = GpioManager()
    serial = SerialHandler(engine, gpio)

    # Wire GPIO callbacks -> engine methods
    gpio.on_gate_opened = engine.on_gate_opened
    gpio.on_gate_closed = engine.on_gate_closed
    gpio.on_lane_triggered = engine.on_lane_triggered

    # Sync initial gate state
    engine.set_gate_ready(gpio.is_gate_ready())

    print("RallyLab Track Controller ready")

    while True:
        now = time.ticks_ms()
        gpio.poll(now)
        serial.poll()
        engine.check_timeout(now)
        serial.check_gate_ready()

        # Also keep engine's gate_ready in sync with gpio
        engine.set_gate_ready(gpio.is_gate_ready())

        time.sleep_ms(1)


main()
