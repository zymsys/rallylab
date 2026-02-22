# http_handler.py — Non-blocking HTTP server for WiFi transport
#
# Implements the same command set as serial_handler (minus dbg_watch)
# over HTTP GET. All responses are pretty-printed JSON with CORS headers.
#
# Long-poll endpoints (/wait/race, /wait/gate) hold the socket open
# until the event occurs or a timeout expires.

import socket
import time
import errno
from config import FIRMWARE_VERSION, PROTOCOL_VERSION, LANE_COUNT, HTTP_PORT, DEBOUNCE_MS
from json_format import pretty

_MAX_WAIT_CLIENTS = 4
_PENDING_TIMEOUT_MS = 5000
_CORS = "Access-Control-Allow-Origin: *\r\n"


class HttpHandler:
    def __init__(self, engine, gpio, wifi):
        self._engine = engine
        self._gpio = gpio
        self._wifi = wifi
        self._server = None
        self._pending = []        # (sock, buf, accept_ms) — partial requests
        self._wait_race = []      # sockets waiting for race completion
        self._wait_gate = []      # sockets waiting for gate ready

    def start(self):
        """Bind port 80, listen, set non-blocking."""
        self._server = socket.socket()
        self._server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._server.bind(("0.0.0.0", HTTP_PORT))
        self._server.listen(4)
        self._server.setblocking(False)

    def poll(self):
        """Accept new connections and process pending requests. Non-blocking."""
        # Accept new connections
        try:
            cl, addr = self._server.accept()
            cl.setblocking(False)
            self._pending.append((cl, b"", time.ticks_ms()))
        except OSError as e:
            if e.errno != errno.EAGAIN:
                raise

        # Process pending connections
        now = time.ticks_ms()
        still_pending = []
        for cl, buf, accept_ms in self._pending:
            # Timeout stale connections
            if time.ticks_diff(now, accept_ms) > _PENDING_TIMEOUT_MS:
                cl.close()
                continue
            # Try to read more data
            try:
                data = cl.recv(512)
                if not data:
                    cl.close()
                    continue
                buf += data
            except OSError as e:
                if e.errno == errno.EAGAIN:
                    still_pending.append((cl, buf, accept_ms))
                    continue
                cl.close()
                continue
            # Check for end of headers
            if b"\r\n\r\n" in buf:
                self._handle_request(cl, buf)
            else:
                still_pending.append((cl, buf, accept_ms))
        self._pending = still_pending

    def _handle_request(self, cl, raw):
        """Parse HTTP request and route to handler."""
        try:
            line = raw.split(b"\r\n", 1)[0].decode()
        except Exception:
            cl.close()
            return

        parts = line.split()
        if len(parts) < 2:
            self._send(cl, 400, {"error": "bad request"})
            return

        method = parts[0]
        if method != "GET":
            self._send(cl, 405, {"error": "method not allowed"})
            return

        path_raw = parts[1]
        path, params = self._parse_url(path_raw)

        if path == "/info":
            self._route_info(cl)
        elif path == "/state":
            self._route_state(cl)
        elif path == "/wait/race":
            self._route_wait_race(cl, params)
        elif path == "/gate":
            self._route_gate(cl)
        elif path == "/wait/gate":
            self._route_wait_gate(cl)
        elif path == "/dbg":
            self._route_dbg(cl)
        elif path == "/wifi/scan":
            self._route_wifi_scan(cl)
        else:
            self._send(cl, 404, {"error": "not found"})

    def _parse_url(self, url):
        """Parse '/path?key=val&key=val' into (path, params_dict)."""
        params = {}
        if "?" in url:
            path, query = url.split("?", 1)
            for pair in query.split("&"):
                if "=" in pair:
                    k, v = pair.split("=", 1)
                    params[k] = v
        else:
            path = url
        return path, params

    def _send(self, cl, status, obj):
        """Send HTTP response with JSON body, then close."""
        body = pretty(obj)
        status_text = "OK" if status == 200 else "Error"
        header = "HTTP/1.1 %d %s\r\n" % (status, status_text)
        header += "Content-Type: application/json\r\n"
        header += _CORS
        header += "Connection: close\r\n"
        header += "Content-Length: %d\r\n\r\n" % len(body)
        try:
            cl.send(header.encode() + body.encode())
        except OSError:
            pass
        cl.close()

    # -- routes ----------------------------------------------------------------

    def _route_info(self, cl):
        self._send(cl, 200, {
            "protocol": PROTOCOL_VERSION,
            "firmware": FIRMWARE_VERSION,
            "lane_count": LANE_COUNT,
        })

    def _route_state(self, cl):
        if self._engine.last_race is None:
            self._send(cl, 200, None)
        else:
            self._send(cl, 200, self._engine.last_race)

    def _route_wait_race(self, cl, params):
        after = params.get("after")
        lanes = params.get("lanes")

        # If after doesn't match current, return immediately
        if after and self._engine.last_race:
            if after != self._engine.last_race.get("race_id"):
                self._send(cl, 200, self._engine.last_race)
                return

        # Check wait client limit
        if len(self._wait_race) >= _MAX_WAIT_CLIENTS:
            self._send(cl, 503, {"error": "too many wait clients"})
            return

        # Validate lanes
        if lanes:
            try:
                seen = set()
                for ch in lanes:
                    n = int(ch)
                    if n < 1 or n > LANE_COUNT:
                        self._send(cl, 400, {"error": "lane %d out of range 1..%d" % (n, LANE_COUNT)})
                        return
                    if n in seen:
                        self._send(cl, 400, {"error": "duplicate lane %d" % n})
                        return
                    seen.add(n)
            except ValueError:
                self._send(cl, 400, {"error": "invalid lanes: %s" % lanes})
                return

        # Arm or attach as listener
        if self._engine.phase in ("ARMED", "RACING"):
            self._engine.add_listener(self._on_race_complete)
        else:
            self._engine.arm(lanes, self._on_race_complete)

        self._wait_race.append(cl)

    def _route_gate(self, cl):
        self._send(cl, 200, {"gate_ready": self._engine.gate_ready})

    def _route_wait_gate(self, cl):
        if self._engine.gate_ready:
            self._send(cl, 200, {"gate_ready": True})
            return

        if len(self._wait_gate) >= _MAX_WAIT_CLIENTS:
            self._send(cl, 503, {"error": "too many wait clients"})
            return

        self._wait_gate.append(cl)

    def _route_dbg(self, cl):
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
        self._send(cl, 200, result)

    def _route_wifi_scan(self, cl):
        if self._wifi:
            self._send(cl, 200, self._wifi.scan())
        else:
            self._send(cl, 200, [])

    # -- long-poll resolution --------------------------------------------------

    def check_gate_ready(self):
        """Called from main loop. Resolves waiting /wait/gate clients."""
        if not self._wait_gate:
            return
        if not self._engine.gate_ready:
            return
        for cl in self._wait_gate:
            self._send(cl, 200, {"gate_ready": True})
        self._wait_gate = []

    def on_race_complete(self, result):
        """Called externally (from _on_race_complete) to send to all waiters."""
        for cl in self._wait_race:
            self._send(cl, 200, result)
        self._wait_race = []

    def _on_race_complete(self, result):
        """Engine callback — delegates to on_race_complete."""
        self.on_race_complete(result)
