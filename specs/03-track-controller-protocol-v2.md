# RallyLab — Track Controller Protocol v2

**Version:** 2.0
**Status:** Draft
**Supersedes:** v1.0 (`03-track-controller-protocol.md`). v2 is a clean break — devices ship v2 only. Older firmware must be flashed via the firmware-update mechanism (separate spec) before the host will talk to it.

---

## 0. Why v2

v1 served us well but has two shortcomings exposed during real race days:

1. **Serial cancel rule is hostile to live diagnostics.** Any incoming line cancels an outstanding `wait_*`. That makes it impossible to poll `dbg` or read `gate` while a race is in flight, so the host can't show live gate / lane-sensor status during a heat — the very thing operators ask for first when something goes wrong.
2. **No async push.** The host must poll. For edges (gate, lane) that arrive at unpredictable times, polling is wasteful and high-latency.

v2 keeps the same youth-friendly, hackable spirit — JSON over USB CDC and HTTP — but moves to:

- **Line-delimited JSON** on the wire (one object per line), with a **human-form input grammar** on serial so the dev console stays typable by kids.
- **`id`-correlated request/response**, so many requests can be in flight at once.
- **Subscriptions** for unsolicited events (gate edges, lane edges, race lifecycle, engine phase).
- **Explicit cancel** — no more "any line cancels."

---

## 1. Transport Overview

### 1.1 USB Transport (Serial)

- USB CDC, **115200 baud, 8N1**.
- Each frame is **one JSON object** terminated by `\n` (LF). `\r\n` is accepted on input.
- Frames in either direction are independent and may interleave freely.
- The device MUST process incoming frames concurrently with outstanding long-running requests; sending a new frame MUST NOT cancel an outstanding `wait_*` request.
- The device SHOULD NOT pretty-print v2 frames (one line each). Pretty-printing is only for `dbg`-style snapshot fields *inside* a frame if desired.

### 1.2 WiFi Transport (HTTP + SSE)

- Request/response endpoints use HTTP `GET` or `POST` as noted, with a JSON body shape mirroring the serial frame (minus the per-line framing).
- Subscriptions use **Server-Sent Events** at `GET /events`. Each SSE `data:` payload is one v2 event frame as defined in §3.4.
- An SSE client MAY pass a `topics` query string (e.g. `/events?topics=gate,lanes`) to subscribe at connect time; otherwise it sends `subscribe` frames over a side channel — see §5.4.

### 1.3 Hackability — Human Input Grammar (Serial)

The serial port doubles as a developer console: kids type commands directly, see responses, and learn the protocol. Forcing them to type `{"id":1,"cmd":"info"}` would kill that. v2 therefore accepts **two input forms** on serial; output is always JSON.

**Form A — JSON frame (programmatic).** A line whose first non-whitespace character is `{` is parsed as a v2 request frame (§3.1). The host uses this form.

**Form B — human form (interactive).** Any other non-empty, non-comment line is parsed shell-style:

```
info
dbg
gate
wait_race lanes=123456
wait_race lanes=123456 after=u-7
subscribe gate lanes
unsubscribe 7
cancel 11
```

Rules:

- First token is the `cmd`.
- Subsequent tokens are either positional or `key=value` pairs, per command (each command's args are documented in §5).
- Lines beginning with `#` are comments and ignored. Empty lines are ignored.
- The device assigns a synthetic `id` to each human-form request: a **negative integer**, decreasing from `-1`. This never collides with host-chosen positive `id`s.
- The response is the normal JSON envelope, so the kid sees the same wire shape the host sees:

```
> info
{"id":-1,"ok":{"protocol":"2.0","lane_count":6,"topics":["gate","lanes","edges","race","engine"]}}
```

- `subscribe gate lanes` accepts a space-separated topic list. The resulting `sub` is the auto-assigned negative `id`.
- The two forms can be mixed on the same connection — handy when a kid attaches a console to watch what the host is doing.

The dev console (the existing pico-debug UI) MUST display device output verbatim line-by-line so the JSON envelope is visible. Any "pretty" view is built on top of that raw stream, never replacing it.

---

## 2. Versioning

- The protocol version is reported in `info` as `"protocol": "2.0"`.
- Devices speak v2 only. The host detects mismatch via `info` and prompts the user to flash. There is no v1 fallback.
- Hosts MUST treat unknown event topics or unknown response fields as forward-compatible — log and ignore.

---

## 3. Frame Kinds

There are exactly **four** frame kinds, distinguished by which keys are present.

### 3.1 Request (host → device)

```json
{ "id": <int>, "cmd": "<command name>", ...args }
```

- `id`: monotonically increasing per host session, unique among **outstanding** requests. Reuse after the response is received is permitted but discouraged.
- `cmd`: command name (see §5).

### 3.2 Response — success (device → host)

```json
{ "id": <int>, "ok": { ...payload } }
```

- `id`: echoes the request `id`.
- `ok`: object. May be `{}` for void responses.

### 3.3 Response — error (device → host)

```json
{ "id": <int>, "err": "<human readable message>", "code": "<optional short code>" }
```

- `code` is an optional machine-readable token (e.g. `"busy"`, `"bad_args"`, `"not_supported"`).

### 3.4 Subscription event (device → host)

```json
{ "sub": <int>, "event": "<topic-defined name>", ...fields }
```

- `sub`: the subscription `id` this event belongs to (the `id` of the original `subscribe` request).
- `event`: the topic-specific event name (see §6).
- Events carry **no** `id` of their own — `sub` is the correlation. Each event is independent and order-preserving within a topic but not across topics.

### 3.5 What is NOT a frame kind

- There is no "notification without `sub`." All async push is tied to a subscription. This keeps fan-out coherent and lets cancel be unambiguous.
- There is no "partial response." A request gets exactly one `ok` or one `err`.

---

## 4. Lifecycle

### 4.1 Connect

1. Host opens the serial port (or HTTP base URL).
2. Host sends `info`. Device responds with capabilities.
3. Host sends `subscribe` for whatever live data it wants.
4. Host issues `wait_race` / `wait_gate` / one-shot commands as needed, in any order.

### 4.2 Cancel

To cancel an outstanding request:

```json
{ "id": 42, "cmd": "cancel", "target": 17 }
```

- `target`: the `id` of the request to cancel.
- The cancelled request gets `{ "id": 17, "err": "cancelled", "code": "cancelled" }`.
- The `cancel` request itself gets `{ "id": 42, "ok": {} }` (or an `err` if `target` was unknown / already complete).
- Cancelling a `subscribe` is allowed; equivalent to `unsubscribe` on that `sub`.

### 4.3 Reset

```json
{ "id": 1, "cmd": "reset" }
```

Drops all outstanding requests and subscriptions, returns the engine to IDLE. Useful after a host reconnect.

### 4.4 Concurrency limits

- Devices SHOULD support at least **8 concurrent in-flight requests** and **4 concurrent subscriptions**.
- On overload: respond `{"err":"too many requests","code":"busy"}` to the offending request. Do not silently drop.

---

## 5. Commands

### 5.1 `info`

Request:

```json
{ "id": 1, "cmd": "info" }
```

Response:

```json
{
  "id": 1,
  "ok": {
    "protocol": "2.0",
    "firmware": "rallylab-pico 0.4.2",
    "lane_count": 6,
    "topics": ["gate", "lanes", "edges", "race", "engine"]
  }
}
```

`topics` enumerates the subscription topics this device supports.

### 5.2 `dbg`

Snapshot of device state. Same shape as v1 §4.6.

```json
{ "id": 9, "cmd": "dbg" }
```

```json
{
  "id": 9,
  "ok": {
    "controller": { "uptime_ms": 123456, "firmware": "..." },
    "wifi": { "mode": "sta", "ip": "192.168.1.50", "rssi": -61 },
    "io": {
      "start_gate": { "raw": 1, "debounced": 1, "invert": false, "last_edge_ms": 1700000000123 },
      "lanes": {
        "1": { "raw": 0, "debounced": 0, "last_edge_ms": 1700000000456 },
        "2": { "raw": 0, "debounced": 0, "last_edge_ms": 1700000000456 }
      },
      "debounce_ms": 10
    },
    "engine": { "phase": "IDLE", "armed": false, "lanes_default": "123456" }
  }
}
```

### 5.3 `gate`

One-shot read of gate readiness.

```json
{ "id": 3, "cmd": "gate" }
```

```json
{ "id": 3, "ok": { "gate_ready": true } }
```

### 5.4 `subscribe`

```json
{ "id": 7, "cmd": "subscribe", "topics": ["gate", "lanes"] }
```

Response:

```json
{ "id": 7, "ok": { "sub": 7, "topics": ["gate", "lanes"] } }
```

- The `sub` returned is, by convention, equal to the request `id` — but hosts MUST use the value the device returns rather than assuming.
- `topics` echoes the accepted topics; any unsupported topic is omitted from the echo and reported in `unknown`:

```json
{ "id": 7, "ok": { "sub": 7, "topics": ["gate"], "unknown": ["lanes"] } }
```

- After this point, the device pushes `{"sub":7,"event":...}` frames for the subscribed topics until `unsubscribe` or `reset`.

To change topics: `unsubscribe` the old `sub` and `subscribe` again with the new list. (Re-subscribing while a `sub` is open is an error.)

### 5.5 `unsubscribe`

```json
{ "id": 8, "cmd": "unsubscribe", "sub": 7 }
```

```json
{ "id": 8, "ok": {} }
```

After this response, no further `sub:7` events will be sent.

### 5.6 `wait_race`

Block until the next completed race. Same semantics as v1 §4.3 but with framing.

```json
{ "id": 11, "cmd": "wait_race", "lanes": "123456", "after": "<race_id-or-null>" }
```

- `lanes` (optional): which lanes count for the next race if engine is currently idle.
- `after` (optional): if set and ≠ current last `race_id`, return immediately with the current race.

Response:

```json
{ "id": 11, "ok": { "race_id": "uuid", "times_ms": { "1": 2150, "3": 2401 } } }
```

While `wait_race` is outstanding, **the host MAY freely send other commands** including `dbg`, `gate`, `subscribe`. The device MUST process them concurrently.

### 5.7 `wait_gate`

```json
{ "id": 12, "cmd": "wait_gate" }
```

```json
{ "id": 12, "ok": { "gate_ready": true } }
```

Note: hosts that subscribe to `gate` events typically don't need `wait_gate` — they get push notifications. `wait_gate` is retained for simple HTTP clients that don't open SSE.

### 5.8 `state`

```json
{ "id": 13, "cmd": "state" }
```

Response: same as `wait_race` payload, or `{"id":13,"ok":null}` if no race has completed since boot.

### 5.9 `update_*` (firmware update — placeholder)

Defined separately in `specs/firmware-update.md` (forthcoming). Mentioned here so implementers reserve the `cmd` namespace `update_begin`, `update_chunk`, `update_commit`, `update_abort`.

---

## 6. Topics

Each topic defines one or more `event` names. Events are independent — order is preserved within a topic but not across topics.

### 6.1 `gate`

State-change push for gate readiness.

- `event: "state"` — emitted whenever `gate_ready` changes, plus once on subscribe with the current value.

```json
{ "sub": 7, "event": "state", "gate_ready": true, "ms": 4801 }
```

`ms` is the device uptime at the transition (or at subscribe time for the initial value).

### 6.2 `lanes`

Per-lane debounced state changes.

- `event: "state"` — emitted on subscribe (one per configured lane) and on every debounced edge.

```json
{ "sub": 7, "event": "state", "lane": 3, "triggered": true, "ms": 5190 }
```

### 6.3 `edges`

Raw debounced edge stream — superset of `gate.state` and `lanes.state` with edge direction. Same payload as v1 `dbg_watch` but framed.

```json
{ "sub": 7, "event": "edge", "pin": "gate", "edge": "opened", "ms": 4523 }
{ "sub": 7, "event": "edge", "pin": "lane", "lane": 3, "edge": "triggered", "ms": 5190 }
```

### 6.4 `race`

Race lifecycle.

- `event: "armed"` — engine accepted the configured lanes and is waiting for the gate.
- `event: "started"` — gate opened; race timer running.
- `event: "completed"` — race ended; same payload as `wait_race`'s `ok`.

```json
{ "sub": 7, "event": "armed", "lanes": "123456", "ms": 4500 }
{ "sub": 7, "event": "started", "ms": 4801 }
{ "sub": 7, "event": "completed", "race_id": "uuid", "times_ms": { "1": 2150, "3": 2401 }, "ms": 7202 }
```

### 6.5 `engine`

Phase transitions.

- `event: "phase"`:

```json
{ "sub": 7, "event": "phase", "phase": "ARMED", "prev": "IDLE", "ms": 4500 }
```

Phases: `IDLE`, `ARMED`, `RUNNING`, `DONE`.

---

## 7. Errors

Error response envelope:

```json
{ "id": <int>, "err": "<message>", "code": "<short>" }
```

Standard codes:

- `cancelled` — request was cancelled.
- `bad_args` — argument validation failed.
- `not_supported` — command/topic not recognized.
- `busy` — concurrency limit exceeded.
- `bad_state` — command not valid in current engine phase (e.g. `wait_race` while already running and `after` not provided).
- `bad_frame` — incoming frame did not parse / was not a valid request.

---

## 8. Examples

### 8.1 Live status during a race

```
host →  {"id":1,"cmd":"info"}
host ←  {"id":1,"ok":{"protocol":"2.0","lane_count":6,"topics":[...]}}

host →  {"id":2,"cmd":"subscribe","topics":["gate","lanes"]}
host ←  {"id":2,"ok":{"sub":2,"topics":["gate","lanes"]}}
host ←  {"sub":2,"event":"state","gate_ready":true,"ms":1000}
host ←  {"sub":2,"event":"state","lane":1,"triggered":false,"ms":1000}
host ←  {"sub":2,"event":"state","lane":2,"triggered":false,"ms":1000}
…

host →  {"id":3,"cmd":"wait_race","lanes":"123456"}
host ←  {"sub":2,"event":"state","gate_ready":false,"ms":4801}    # gate dropped
host ←  {"sub":2,"event":"state","lane":1,"triggered":true,"ms":7100}
host ←  {"sub":2,"event":"state","lane":2,"triggered":true,"ms":7220}
host ←  {"id":3,"ok":{"race_id":"u-1","times_ms":{"1":2299,"2":2419,...}}}

# Operator wants a deeper look — fires a dbg snapshot mid-stream.
host →  {"id":4,"cmd":"dbg"}
host ←  {"id":4,"ok":{...}}
```

Note that `id:3` (`wait_race`) and `id:4` (`dbg`) overlap. v1 could not do this.

### 8.2 Cancelling a subscription cleanly

```
host →  {"id":9,"cmd":"unsubscribe","sub":2}
host ←  {"id":9,"ok":{}}
# No more sub:2 events from this point on.
```

### 8.3 Dual-host scenario (HTTP + serial host on same device)

If the device permits both transports concurrently (it MAY), each transport is its own session with its own `id` namespace and its own subscriptions. Events are delivered only to the session that subscribed.

---

## 9. Backpressure

If the host stops reading (slow consumer, disconnect-without-close), the device MUST NOT block the race engine. Behavior:

- The device maintains a **bounded outbound queue per session** (suggested 64 frames).
- When the queue is full, **subscription events are dropped first**, in arrival order. Request responses are never dropped — they may queue behind events instead.
- When the host catches up, the device emits one synthetic frame per affected subscription:

```json
{ "sub": 7, "event": "overflow", "dropped": 142 }
```

`dropped` is the count of events lost since the last delivered frame for that `sub`.

---

## 10. Open Questions

- Should subscriptions support **filters** (e.g. only lane 3 edges) at the protocol level, or is per-topic filtering on the host fine? Lean: host-side filter for now, revisit if bandwidth bites.
- SSE for HTTP, or websocket? SSE is simpler and we don't need client→server events on that channel.
- Should the human-form input grammar accept **shorthand** for very common args (e.g. `wait_race 123456` as a positional alias for `lanes=123456`)? Lean yes for `wait_race`; document per-command in §5.

---

**End of Track Controller Protocol v2.0 (Draft)**
