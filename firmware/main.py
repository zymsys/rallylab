# main.py — Entry point + main polling loop
#
# Wires together Engine, GpioManager, SerialHandler, and (optionally)
# WiFiManager + HttpHandler, then runs the main loop forever.

import time
from engine import Engine
from gpio_manager import GpioManager
from serial_handler import SerialHandler


def main():
    engine = Engine()
    gpio = GpioManager()

    # WiFi is optional — plain Pico (no W) works fine over USB serial
    try:
        from wifi_manager import WiFiManager
        wifi = WiFiManager()
    except Exception:
        wifi = None

    serial = SerialHandler(engine, gpio, wifi)

    # Wire GPIO callbacks -> engine methods
    gpio.on_gate_opened = engine.on_gate_opened
    gpio.on_gate_closed = engine.on_gate_closed
    gpio.on_lane_triggered = engine.on_lane_triggered

    # Sync initial gate state
    engine.set_gate_ready(gpio.is_gate_ready())

    # Try to auto-connect from saved credentials
    if wifi and wifi.auto_connect():
        print("WiFi connected: %s" % wifi.ip_address)

    print("RallyLab Track Controller ready")

    # HTTP server is started lazily once WiFi is connected
    http = None

    while True:
        now = time.ticks_ms()
        gpio.poll(now)
        serial.poll()
        engine.check_timeout(now)
        serial.check_gate_ready()

        # Lazy HTTP server start
        if http is None and wifi and wifi.is_connected():
            from http_handler import HttpHandler
            http = HttpHandler(engine, gpio, wifi)
            http.start()
            print("HTTP server on %s:%d" % (wifi.ip_address, 80))

        if http:
            http.poll()
            http.check_gate_ready()

        # Also keep engine's gate_ready in sync with gpio
        engine.set_gate_ready(gpio.is_gate_ready())

        time.sleep_ms(1)


main()
