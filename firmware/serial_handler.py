# serial_handler.py — USB serial command parsing + JSON responses
#
# Non-blocking reads via select.poll() on sys.stdin.
# Line accumulation; dispatches complete lines.
# Cancel rule: if a wait is active, any new line cancels it first,
# then dispatches as the next command.

import sys
import json
import select
import time
from config import FIRMWARE_VERSION, PROTOCOL_VERSION, LANE_COUNT, DEBOUNCE_MS
from json_format import pretty


class SerialHandler:
    def __init__(self, engine, gpio, wifi=None):
        self._engine = engine
        self._gpio = gpio
        self._wifi = wifi
        self._buf = ""
        self._poller = select.poll()
        self._poller.register(sys.stdin, select.POLLIN)

        # Active wait state
        self._waiting = False       # True if blocked in wait_race or wait_gate
        self._wait_type = None      # "race" or "gate"

    def poll(self):
        """Check for incoming serial data. Non-blocking."""
        while self._poller.poll(0):
            ch = sys.stdin.read(1)
            if ch in ('\n', '\r'):
                line = self._buf.strip()
                self._buf = ""
                if line:
                    self._dispatch(line)
            else:
                self._buf += ch

    def _dispatch(self, line):
        """Parse and execute a command line."""
        # Cancel rule: if we're waiting, cancel first
        if self._waiting:
            self._cancel_wait()

        # Parse command and params
        cmd, params = self._parse(line)

        if cmd == "info":
            self._cmd_info()
        elif cmd == "state":
            self._cmd_state()
        elif cmd in ("wait_race", "wait/race"):
            self._cmd_wait_race(params)
        elif cmd == "gate":
            self._cmd_gate()
        elif cmd in ("wait_gate", "wait/gate"):
            self._cmd_wait_gate()
        elif cmd == "dbg":
            self._cmd_dbg()
        elif cmd == "dbg_watch":
            self._cmd_dbg_watch()
        elif cmd == "wifi":
            self._cmd_wifi()
        elif cmd == "wifi_scan":
            self._cmd_wifi_scan()
        elif cmd == "wifi_setup":
            self._cmd_wifi_setup(line)
        elif cmd == "wifi_clear":
            self._cmd_wifi_clear()
        else:
            self._respond({"error": "unknown command: %s" % cmd})

    def _parse(self, line):
        """Parse 'command key=val key=val' or 'command?key=val&key=val'."""
        params = {}

        # Split off query string if present (URL style)
        if '?' in line:
            cmd_part, query = line.split('?', 1)
            cmd_part = cmd_part.strip()
            for pair in query.split('&'):
                if '=' in pair:
                    k, v = pair.split('=', 1)
                    params[k.strip()] = v.strip()
        else:
            cmd_part = line

        # Split on whitespace for space-delimited params
        parts = cmd_part.split()
        cmd = parts[0] if parts else ""
        for part in parts[1:]:
            if '=' in part:
                k, v = part.split('=', 1)
                params[k.strip()] = v.strip()

        return cmd, params

    def _respond(self, obj):
        """Send a pretty-printed JSON response to serial."""
        print(pretty(obj))

    def _respond_null(self):
        """Send null (for state when no race completed)."""
        print("null")

    # -- commands ----------------------------------------------------------

    def _cmd_info(self):
        self._respond({
            "protocol": PROTOCOL_VERSION,
            "firmware": FIRMWARE_VERSION,
            "lane_count": LANE_COUNT,
        })

    def _cmd_state(self):
        if self._engine.last_race is None:
            self._respond_null()
        else:
            self._respond(self._engine.last_race)

    def _cmd_wait_race(self, params):
        after = params.get("after")
        lanes = params.get("lanes")

        # If after is provided and doesn't match current last race, return immediately
        if after and self._engine.last_race:
            if after != self._engine.last_race.get("race_id"):
                self._respond(self._engine.last_race)
                return

        # Validate lanes before arming
        if lanes:
            try:
                seen = set()
                for ch in lanes:
                    n = int(ch)
                    if n < 1 or n > LANE_COUNT:
                        self._respond({"error": "lane %d out of range 1..%d" % (n, LANE_COUNT)})
                        return
                    if n in seen:
                        self._respond({"error": "duplicate lane %d" % n})
                        return
                    seen.add(n)
            except ValueError:
                self._respond({"error": "invalid lanes: %s" % lanes})
                return

        # Arm or attach as listener
        if self._engine.phase in ("ARMED", "RACING"):
            self._engine.add_listener(self._on_race_complete)
        else:
            self._engine.arm(lanes, self._on_race_complete)
        self._waiting = True
        self._wait_type = "race"

    def _cmd_gate(self):
        self._respond({"gate_ready": self._engine.gate_ready})

    def _cmd_wait_gate(self):
        if self._engine.gate_ready:
            self._respond({"gate_ready": True})
            return

        self._waiting = True
        self._wait_type = "gate"

    def _cmd_dbg(self):
        result = {
            "controller": {
                "protocol": PROTOCOL_VERSION,
                "firmware": FIRMWARE_VERSION,
                "uptime_ms": time.ticks_ms(),
            },
            "io": {
                "start_gate": self._gpio.gate_dbg(),
                "lanes": self._gpio.lanes_dbg(),
                "debounce_ms": DEBOUNCE_MS,
            },
            "engine": {
                "phase": self._engine.phase,
                "race_id": self._engine.race_id,
                "active_lanes": sorted(list(self._engine.active_lanes)) if self._engine.active_lanes else None,
                "gate_ready": self._engine.gate_ready,
            },
        }
        if self._wifi:
            result["wifi"] = self._wifi.status()
        self._respond(result)

    def _cmd_dbg_watch(self):
        self._gpio.start_watch()
        self._respond({"watching": True, "gpio_range": "GP0-GP22"})
        self._gpio.on_edge = self._on_watch_edge
        self._waiting = True
        self._wait_type = "watch"

    def _on_watch_edge(self, info):
        """Called by gpio_manager on every debounced edge during watch."""
        print(json.dumps(info))

    # -- wifi commands -----------------------------------------------------

    def _cmd_wifi(self):
        if not self._wifi:
            self._respond({"error": "wifi not available"})
            return
        self._respond(self._wifi.status())

    def _cmd_wifi_scan(self):
        if not self._wifi:
            self._respond({"error": "wifi not available"})
            return
        self._respond(self._wifi.scan())

    def _cmd_wifi_setup(self, line):
        if not self._wifi:
            self._respond({"error": "wifi not available"})
            return
        # Parse: wifi_setup <SSID> <PASSWORD>
        # Password may contain spaces/equals, so split positionally
        parts = line.split(None, 2)
        if len(parts) < 3:
            self._respond({"error": "usage: wifi_setup <ssid> <password>"})
            return
        ssid = parts[1]
        password = parts[2]
        self._wifi.save_credentials(ssid, password)
        ok = self._wifi.connect(ssid, password)
        if ok:
            self._respond({
                "connected": True,
                "ssid": ssid,
                "ip": self._wifi.ip_address,
            })
        else:
            self._respond({
                "connected": False,
                "error": "connection failed",
            })

    def _cmd_wifi_clear(self):
        if not self._wifi:
            self._respond({"error": "wifi not available"})
            return
        self._wifi.disconnect()
        self._wifi.clear_credentials()
        self._respond({"cleared": True})

    # -- wait callbacks and cancellation -----------------------------------

    def _on_race_complete(self, result):
        """Called by engine when a race completes."""
        if self._waiting and self._wait_type == "race":
            self._waiting = False
            self._wait_type = None
            self._respond(result)

    def check_gate_ready(self):
        """Called from main loop to resolve wait_gate."""
        if self._waiting and self._wait_type == "gate":
            if self._engine.gate_ready:
                self._waiting = False
                self._wait_type = None
                self._respond({"gate_ready": True})

    def _cancel_wait(self):
        """Cancel the current wait (cancel rule)."""
        if self._wait_type == "race":
            self._engine.cancel()
        elif self._wait_type == "watch":
            self._gpio.on_edge = None
            self._gpio.stop_watch()
        self._waiting = False
        self._wait_type = None

    @property
    def is_waiting(self):
        return self._waiting
