# protocol_v2.py — Track Controller Protocol v2 dispatcher.
#
# Transport-neutral. Each transport (serial, HTTP/SSE) opens a Session,
# feeds inbound lines into it, and drains outbound frames via write_line.
# The Dispatcher owns engine + gpio state and fans out subscription
# events across sessions.
#
# See specs/03-track-controller-protocol-v2.md.

try:
    import json
except ImportError:
    import ujson as json  # MicroPython fallback

import time

from config import FIRMWARE_VERSION, LANE_COUNT, DEBOUNCE_MS

PROTOCOL = "2.0"
TOPICS = ("gate", "lanes", "edges", "race", "engine")

# Per-session outbound queue caps. Events drop first when full;
# request responses are never dropped.
SERIAL_QUEUE_CAP = 32
HTTP_QUEUE_CAP = 16


def _ticks():
    try:
        return time.ticks_ms()
    except AttributeError:
        # CPython for unit tests
        return int(time.monotonic() * 1000)


# ─── Session ─────────────────────────────────────────────────────────

class Session:
    """One protocol session bound to one transport client.

    Caller must:
    - call feed_line(line) for each inbound line
    - call drain() periodically to flush queued outbound frames
    - call close() when the transport disconnects
    """

    def __init__(self, dispatcher, write_line, queue_cap=SERIAL_QUEUE_CAP):
        self._d = dispatcher
        self._write_line = write_line
        self._queue_cap = queue_cap

        self._closed = False
        self._next_human_id = 0  # decremented to -1, -2, ...

        # sub_id -> set of topic names
        self._subs = {}
        # sub_id -> count of dropped events since last delivered
        self._dropped = {}

        # Outstanding wait_race / wait_gate keyed by request id.
        # value = (kind, ...kind-specific bits)
        self._pending = {}

        # Outbound queue of pre-serialized strings (one frame per element).
        self._outq = []
        # Whether the head of the queue is a response (never droppable).
        # We store tuples (is_response, line) in _outq instead of strings.
        # Simpler than a separate priority queue.

    # -- inbound ----------------------------------------------------------

    def feed_line(self, line):
        if self._closed:
            return
        line = line.strip()
        if not line or line.startswith("#"):
            return

        if line[0:1] == "{":
            try:
                frame = json.loads(line)
            except Exception:
                self._send_err(None, "bad_frame", "could not parse JSON")
                return
            if not isinstance(frame, dict) or "cmd" not in frame:
                self._send_err(None, "bad_frame", "missing cmd")
                return
            req_id = frame.get("id")
            if req_id is None or not isinstance(req_id, int):
                self._send_err(None, "bad_frame", "missing or non-integer id")
                return
            cmd = frame.get("cmd")
            self._dispatch(req_id, cmd, frame)
        else:
            # Human form: "cmd arg1 key=val ..."
            parts = _shlex_lite(line)
            if not parts:
                return
            cmd = parts[0]
            args = {}
            positional = []
            for p in parts[1:]:
                if "=" in p:
                    k, v = p.split("=", 1)
                    args[k] = v
                else:
                    positional.append(p)
            if positional:
                args["_pos"] = positional

            self._next_human_id -= 1
            req_id = self._next_human_id
            self._dispatch(req_id, cmd, args)

    # -- outbound ---------------------------------------------------------

    def _enqueue(self, is_response, frame_dict):
        if self._closed:
            return
        try:
            line = json.dumps(frame_dict)
        except Exception:
            line = json.dumps({"err": "encode_error", "code": "internal"})

        if len(self._outq) >= self._queue_cap:
            # Drop the oldest event (not a response) to make room.
            for i, (was_resp, _line) in enumerate(self._outq):
                if not was_resp:
                    # Find which sub this event belonged to so we can count it.
                    self._record_drop(self._outq[i][1])
                    self._outq.pop(i)
                    break
            else:
                # All queued frames are responses — drop the new event itself.
                if not is_response:
                    self._record_drop(line)
                    return

        # Before pushing this frame, if we previously dropped events for any
        # sub and this frame is for that sub, prepend an overflow marker.
        if not is_response and self._dropped:
            sub = frame_dict.get("sub")
            if sub is not None and sub in self._dropped:
                marker = json.dumps({
                    "sub": sub,
                    "event": "overflow",
                    "dropped": self._dropped.pop(sub),
                })
                self._outq.append((False, marker))

        self._outq.append((is_response, line))

    def _record_drop(self, line_str):
        # Best-effort sub extraction from an event line for counting.
        try:
            obj = json.loads(line_str)
            sub = obj.get("sub")
            if sub is not None:
                self._dropped[sub] = self._dropped.get(sub, 0) + 1
        except Exception:
            pass

    def drain(self):
        """Write as many queued frames as the transport will accept."""
        if self._closed:
            return
        while self._outq:
            _is_resp, line = self._outq[0]
            try:
                ok = self._write_line(line)
            except Exception:
                self.close()
                return
            if ok is False:
                # Transport said "back off" — stop for now.
                return
            self._outq.pop(0)

    # -- responses & events ----------------------------------------------

    def _ok(self, req_id, payload=None):
        f = {"id": req_id, "ok": payload if payload is not None else {}}
        self._enqueue(True, f)

    def _send_err(self, req_id, code, msg):
        f = {"err": msg, "code": code}
        if req_id is not None:
            f["id"] = req_id
        self._enqueue(True, f)

    def deliver_event(self, sub_id, event_dict):
        f = {"sub": sub_id, "event": event_dict.pop("event")}
        for k, v in event_dict.items():
            f[k] = v
        self._enqueue(False, f)

    def has_topic(self, topic):
        # Returns the list of sub_ids that subscribed to this topic.
        out = []
        for sub_id, topics in self._subs.items():
            if topic in topics:
                out.append(sub_id)
        return out

    # -- pending request helpers (used by Dispatcher) --------------------

    def add_pending(self, req_id, kind, payload):
        self._pending[req_id] = (kind, payload)

    def pop_pending(self, req_id):
        return self._pending.pop(req_id, None)

    def find_pending_by_kind(self, kind):
        out = []
        for rid, (k, p) in self._pending.items():
            if k == kind:
                out.append((rid, p))
        return out

    def all_pending_ids(self):
        return list(self._pending.keys())

    # -- close ------------------------------------------------------------

    def close(self):
        if self._closed:
            return
        self._closed = True
        self._d._on_session_closed(self)
        self._subs = {}
        self._pending = {}
        self._outq = []
        self._dropped = {}

    # -- dispatch ---------------------------------------------------------

    def _dispatch(self, req_id, cmd, args):
        d = self._d
        if cmd == "info":
            self._ok(req_id, {
                "protocol": PROTOCOL,
                "firmware": FIRMWARE_VERSION,
                "lane_count": LANE_COUNT,
                "topics": list(TOPICS),
            })
        elif cmd == "dbg":
            self._ok(req_id, d._build_dbg())
        elif cmd == "gate":
            self._ok(req_id, {"gate_ready": d._engine.gate_ready})
        elif cmd == "state":
            self._ok(req_id, d._engine.last_race)
        elif cmd == "subscribe":
            d._handle_subscribe(self, req_id, args)
        elif cmd == "unsubscribe":
            d._handle_unsubscribe(self, req_id, args)
        elif cmd == "cancel":
            d._handle_cancel(self, req_id, args)
        elif cmd == "reset":
            d._handle_reset(self, req_id)
        elif cmd == "wait_race":
            d._handle_wait_race(self, req_id, args)
        elif cmd == "wait_gate":
            d._handle_wait_gate(self, req_id, args)
        elif cmd == "wifi":
            d._handle_wifi(self, req_id)
        elif cmd == "wifi_scan":
            d._handle_wifi_scan(self, req_id)
        elif cmd == "wifi_setup":
            d._handle_wifi_setup(self, req_id, args)
        elif cmd == "wifi_clear":
            d._handle_wifi_clear(self, req_id)
        elif cmd == "hostname_set":
            d._handle_hostname_set(self, req_id, args)
        elif cmd == "hostname_clear":
            d._handle_hostname_clear(self, req_id)
        else:
            self._send_err(req_id, "not_supported", "unknown command: " + str(cmd))


# ─── Dispatcher ──────────────────────────────────────────────────────

class Dispatcher:
    """Owns engine/gpio; multiplexes events across sessions."""

    def __init__(self, engine, gpio, wifi=None):
        self._engine = engine
        self._gpio = gpio
        self._wifi = wifi
        self._sessions = []

        # Wire fan-out callbacks. Each is multicast.
        engine.add_listener(self._on_race_complete)

        # gpio.on_edge is single-slot in v1 firmware; we wrap it.
        self._gpio_prev_on_edge = gpio.on_edge
        gpio.on_edge = self._on_edge

        # Engine phase listener (multicast — added via add_phase_listener
        # if engine supports it, else patched).
        if hasattr(engine, "add_phase_listener"):
            engine.add_phase_listener(self._on_phase_change)
        else:
            self._last_phase = engine.phase

        # Track gate_ready transitions so we publish gate.state on change.
        self._last_gate_ready = engine.gate_ready

    # -- session management ----------------------------------------------

    def new_session(self, write_line, queue_cap=SERIAL_QUEUE_CAP):
        s = Session(self, write_line, queue_cap=queue_cap)
        self._sessions.append(s)
        return s

    def _on_session_closed(self, s):
        try:
            self._sessions.remove(s)
        except ValueError:
            pass

    def drain_all(self):
        for s in list(self._sessions):
            s.drain()

    # -- periodic tick ----------------------------------------------------

    def tick(self):
        """Called every main-loop iteration. Polls for state changes that
        the engine/gpio don't push on their own (gate_ready, engine phase
        without listener support)."""
        # gate state push
        ready = self._engine.gate_ready
        if ready != self._last_gate_ready:
            self._last_gate_ready = ready
            self._publish("gate", {"event": "state", "gate_ready": ready, "ms": _ticks()})

        # engine phase fallback (if no phase listener)
        if not hasattr(self._engine, "add_phase_listener"):
            phase = self._engine.phase
            if phase != self._last_phase:
                self._publish("engine", {
                    "event": "phase",
                    "phase": phase,
                    "prev": self._last_phase,
                    "ms": _ticks(),
                })
                if phase == "ARMED":
                    lanes = "".join(str(l) for l in sorted(self._engine.active_lanes or []))
                    self._publish("race", {"event": "armed", "lanes": lanes, "ms": _ticks()})
                elif phase == "RACING":
                    self._publish("race", {"event": "started", "ms": _ticks()})
                self._last_phase = phase

        # Resolve outstanding wait_gate when gate becomes ready.
        if ready:
            for s in list(self._sessions):
                for rid, _ in s.find_pending_by_kind("wait_gate"):
                    s.pop_pending(rid)
                    s._ok(rid, {"gate_ready": True})

        self.drain_all()

    # -- subscribe / unsubscribe / cancel / reset ------------------------

    def _handle_subscribe(self, s, req_id, args):
        topics = args.get("topics")
        if topics is None and "_pos" in args:
            topics = args["_pos"]
        if isinstance(topics, str):
            topics = [t.strip() for t in topics.split(",") if t.strip()]
        if not isinstance(topics, list) or not topics:
            s._send_err(req_id, "bad_args", "subscribe requires topics list")
            return
        accepted = []
        unknown = []
        for t in topics:
            if t in TOPICS:
                accepted.append(t)
            else:
                unknown.append(t)
        if not accepted:
            s._send_err(req_id, "bad_args", "no recognized topics")
            return

        # By convention, sub == req_id. For human-form req_ids (negative),
        # this still works because each is unique within the session.
        if req_id in s._subs:
            s._send_err(req_id, "bad_state", "id already in use as a sub")
            return
        s._subs[req_id] = set(accepted)

        payload = {"sub": req_id, "topics": accepted}
        if unknown:
            payload["unknown"] = unknown
        s._ok(req_id, payload)

        # Initial-state push: the spec says gate and lanes deliver one
        # current-state frame on subscribe.
        if "gate" in accepted:
            s.deliver_event(req_id, {
                "event": "state",
                "gate_ready": self._engine.gate_ready,
                "ms": _ticks(),
            })
        if "lanes" in accepted:
            for lane_str, info in self._gpio.lanes_dbg().items():
                triggered = info["debounced"] == 0  # falling edge = triggered
                s.deliver_event(req_id, {
                    "event": "state",
                    "lane": int(lane_str),
                    "triggered": triggered,
                    "ms": _ticks(),
                })

    def _handle_unsubscribe(self, s, req_id, args):
        sub = args.get("sub")
        if sub is None and "_pos" in args:
            try:
                sub = int(args["_pos"][0])
            except (ValueError, IndexError):
                pass
        try:
            sub = int(sub)
        except (TypeError, ValueError):
            s._send_err(req_id, "bad_args", "unsubscribe requires sub")
            return
        if sub not in s._subs:
            s._send_err(req_id, "bad_args", "no such sub")
            return
        del s._subs[sub]
        s._dropped.pop(sub, None)
        s._ok(req_id, {})

    def _handle_cancel(self, s, req_id, args):
        target = args.get("target")
        if target is None and "_pos" in args:
            try:
                target = int(args["_pos"][0])
            except (ValueError, IndexError):
                pass
        try:
            target = int(target)
        except (TypeError, ValueError):
            s._send_err(req_id, "bad_args", "cancel requires target")
            return

        # Subscription cancel is equivalent to unsubscribe.
        if target in s._subs:
            del s._subs[target]
            s._dropped.pop(target, None)
            s._send_err(target, "cancelled", "cancelled by host")
            s._ok(req_id, {})
            return

        pending = s.pop_pending(target)
        if pending is None:
            s._send_err(req_id, "bad_args", "no pending request with that id")
            return
        kind, _payload = pending
        if kind == "wait_race":
            # If this was the only listener for the race, cancel the engine.
            still_waiting = False
            for sx in self._sessions:
                if sx.find_pending_by_kind("wait_race"):
                    still_waiting = True
                    break
            if not still_waiting and self._engine.phase == "ARMED":
                self._engine.cancel()
        s._send_err(target, "cancelled", "cancelled by host")
        s._ok(req_id, {})

    def _handle_reset(self, s, req_id):
        # Drop all of THIS session's pending + subs. Engine reset is shared.
        for rid in s.all_pending_ids():
            s.pop_pending(rid)
            s._send_err(rid, "cancelled", "session reset")
        s._subs = {}
        s._dropped = {}
        if self._engine.phase == "ARMED":
            self._engine.cancel()
        s._ok(req_id, {})

    # -- wait_race / wait_gate -------------------------------------------

    def _handle_wait_race(self, s, req_id, args):
        after = args.get("after")
        lanes = args.get("lanes")
        if lanes is None and "_pos" in args:
            lanes = args["_pos"][0]

        if after and self._engine.last_race:
            if after != self._engine.last_race.get("race_id"):
                s._ok(req_id, self._engine.last_race)
                return

        if lanes:
            try:
                seen = set()
                for ch in str(lanes):
                    n = int(ch)
                    if n < 1 or n > LANE_COUNT:
                        s._send_err(req_id, "bad_args",
                                    "lane %d out of range 1..%d" % (n, LANE_COUNT))
                        return
                    if n in seen:
                        s._send_err(req_id, "bad_args", "duplicate lane %d" % n)
                        return
                    seen.add(n)
            except ValueError:
                s._send_err(req_id, "bad_args", "invalid lanes: " + str(lanes))
                return

        if self._engine.phase in ("ARMED", "RACING"):
            # Already armed by another waiter — just listen.
            pass
        else:
            self._engine.arm(str(lanes) if lanes else None, lambda r: None)

        s.add_pending(req_id, "wait_race", None)

    def _handle_wait_gate(self, s, req_id, args):
        if self._engine.gate_ready:
            s._ok(req_id, {"gate_ready": True})
            return
        s.add_pending(req_id, "wait_gate", None)

    # -- wifi / hostname admin commands ----------------------------------

    def _handle_wifi(self, s, req_id):
        if not self._wifi:
            s._send_err(req_id, "not_supported", "wifi not available")
            return
        try:
            s._ok(req_id, self._wifi.status())
        except Exception as e:
            s._send_err(req_id, "internal", str(e))

    def _handle_wifi_scan(self, s, req_id):
        if not self._wifi:
            s._send_err(req_id, "not_supported", "wifi not available")
            return
        try:
            s._ok(req_id, {"networks": self._wifi.scan()})
        except Exception as e:
            s._send_err(req_id, "internal", str(e))

    def _handle_wifi_setup(self, s, req_id, args):
        if not self._wifi:
            s._send_err(req_id, "not_supported", "wifi not available")
            return
        ssid = args.get("ssid")
        password = args.get("password")
        if (ssid is None or password is None) and "_pos" in args:
            pos = args["_pos"]
            if len(pos) >= 1 and ssid is None:
                ssid = pos[0]
            if len(pos) >= 2 and password is None:
                password = pos[1]
        if not ssid or password is None:
            s._send_err(req_id, "bad_args", "wifi_setup requires ssid and password")
            return
        try:
            self._wifi.save_credentials(ssid, password)
            ok = self._wifi.connect(ssid, password)
            if ok:
                s._ok(req_id, {
                    "connected": True,
                    "ssid": ssid,
                    "ip": self._wifi.ip_address,
                })
            else:
                s._send_err(req_id, "internal", "connection failed")
        except Exception as e:
            s._send_err(req_id, "internal", str(e))

    def _handle_wifi_clear(self, s, req_id):
        if not self._wifi:
            s._send_err(req_id, "not_supported", "wifi not available")
            return
        try:
            self._wifi.disconnect()
            self._wifi.clear_credentials()
            s._ok(req_id, {"cleared": True})
        except Exception as e:
            s._send_err(req_id, "internal", str(e))

    def _handle_hostname_set(self, s, req_id, args):
        if not self._wifi:
            s._send_err(req_id, "not_supported", "wifi not available")
            return
        name = args.get("name")
        if not name and "_pos" in args:
            name = args["_pos"][0] if args["_pos"] else None
        if not name:
            s._send_err(req_id, "bad_args", "hostname_set requires name")
            return
        name = name.strip().lower()
        if (not name or len(name) > 32 or
                not all(c.isalnum() or c == '-' for c in name)):
            s._send_err(req_id, "bad_args",
                        "invalid hostname (a-z, 0-9, hyphens, max 32 chars)")
            return
        try:
            self._wifi.set_hostname(name)
            s._ok(req_id, {"hostname": name + ".local"})
        except Exception as e:
            s._send_err(req_id, "internal", str(e))

    def _handle_hostname_clear(self, s, req_id):
        if not self._wifi:
            s._send_err(req_id, "not_supported", "wifi not available")
            return
        try:
            self._wifi.clear_hostname()
            s._ok(req_id, {"hostname": self._wifi.hostname + ".local"})
        except Exception as e:
            s._send_err(req_id, "internal", str(e))

    # -- engine + gpio fan-out -------------------------------------------

    def _on_race_complete(self, result):
        ms = _ticks()
        # Resolve all outstanding wait_race waiters across sessions.
        for s in list(self._sessions):
            for rid, _ in s.find_pending_by_kind("wait_race"):
                s.pop_pending(rid)
                s._ok(rid, result)
        # Publish race.completed event.
        payload = {"event": "completed", "ms": ms}
        for k, v in result.items():
            payload[k] = v
        self._publish("race", payload)

    def _on_edge(self, info):
        # info: {gpio, pin, edge, ms} possibly with 'lane'
        # Forward to the previous on_edge handler if any (e.g. dbg_watch).
        if self._gpio_prev_on_edge:
            try:
                self._gpio_prev_on_edge(info)
            except Exception:
                pass

        # edges topic (raw stream)
        ev = {"event": "edge"}
        for k, v in info.items():
            if k != "gpio":  # gpio number is internal
                ev[k] = v
        self._publish("edges", ev)

        # lanes topic (per-lane state changes)
        if info.get("pin") == "lane" and "lane" in info:
            self._publish("lanes", {
                "event": "state",
                "lane": info["lane"],
                "triggered": info.get("edge") == "triggered",
                "ms": info.get("ms", _ticks()),
            })

    def _on_phase_change(self, prev, phase, ms):
        self._publish("engine", {
            "event": "phase", "phase": phase, "prev": prev, "ms": ms,
        })
        if phase == "ARMED":
            lanes = "".join(str(l) for l in sorted(self._engine.active_lanes or []))
            self._publish("race", {"event": "armed", "lanes": lanes, "ms": ms})
        elif phase == "RACING":
            self._publish("race", {"event": "started", "ms": ms})

    # -- helpers ---------------------------------------------------------

    def _publish(self, topic, payload):
        for s in list(self._sessions):
            for sub_id in s.has_topic(topic):
                # Each delivery copies payload because deliver_event mutates.
                s.deliver_event(sub_id, dict(payload))

    def _build_dbg(self):
        result = {
            "controller": {
                "protocol": PROTOCOL,
                "firmware": FIRMWARE_VERSION,
                "uptime_ms": _ticks(),
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
            try:
                result["wifi"] = self._wifi.status()
            except Exception:
                pass
        return result


# ─── Helpers ─────────────────────────────────────────────────────────

def _shlex_lite(line):
    """Tiny tokenizer: splits on whitespace, supports double-quoted strings.

    Good enough for human-form arguments. Never raises."""
    out = []
    i = 0
    n = len(line)
    while i < n:
        c = line[i]
        if c == ' ' or c == '\t':
            i += 1
            continue
        if c == '"':
            i += 1
            buf = ""
            while i < n and line[i] != '"':
                if line[i] == '\\' and i + 1 < n:
                    buf += line[i + 1]
                    i += 2
                else:
                    buf += line[i]
                    i += 1
            if i < n:
                i += 1  # skip closing quote
            out.append(buf)
        else:
            j = i
            while j < n and line[j] not in (' ', '\t'):
                j += 1
            out.append(line[i:j])
            i = j
    return out
