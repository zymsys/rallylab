# main.py — Entry point + main polling loop
#
# Wires together Engine, GpioManager, the v2 protocol Dispatcher, and the
# serial + (optional) HTTP transports, then runs the main loop forever.

import time
from engine import Engine
from gpio_manager import GpioManager
from protocol_v2 import Dispatcher
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

    # Wire GPIO callbacks -> engine methods
    gpio.on_gate_opened = engine.on_gate_opened
    gpio.on_gate_closed = engine.on_gate_closed
    gpio.on_lane_triggered = engine.on_lane_triggered

    # Sync initial gate state
    engine.set_gate_ready(gpio.is_gate_ready())

    # Build the v2 dispatcher and serial transport
    dispatcher = Dispatcher(engine, gpio, wifi)
    serial = SerialHandler(dispatcher)

    # Attach the firmware-update command family to the dispatcher.
    from update import attach as _attach_update, should_reboot, perform_reboot
    update_mgr = _attach_update(dispatcher, engine)

    # Try to auto-connect from saved credentials
    if wifi and wifi.auto_connect():
        print("WiFi connected: %s (%s.local)" % (wifi.ip_address, wifi.hostname))

    print("RallyLab Track Controller ready (protocol v2)")

    # HTTP server is started lazily once WiFi is connected
    http = None

    while True:
        now = time.ticks_ms()
        gpio.poll(now)
        serial.poll()
        engine.check_timeout(now)

        # Lazy HTTP server start
        if http is None and wifi and wifi.is_connected():
            from http_handler import HttpHandler
            http = HttpHandler(dispatcher, wifi)
            http.start()
            print("HTTP server on %s:%d" % (wifi.ip_address, 80))

        if http:
            http.poll()

        # Keep engine's gate_ready in sync with gpio (cheap; idempotent)
        engine.set_gate_ready(gpio.is_gate_ready())

        # Drives gate-state and engine-phase events plus wait_gate resolution.
        dispatcher.tick()
        update_mgr.tick()

        # If a firmware update committed, reboot once the OK has flushed.
        if should_reboot(update_mgr):
            perform_reboot()

        time.sleep_ms(1)


main()
