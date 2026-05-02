# RallyLab — Firmware Update Protocol

**Version:** 1.0 (Draft)
**Status:** Specification
**Depends on:** `03-track-controller-protocol-v2.md`

---

## 0. Goals

- The host (RallyLab web app) can detect that a connected Track Controller is out-of-date and **flash the latest firmware** without the user shelling into MicroPython.
- Two flash paths, in priority order:
  1. **In-band update** (preferred) — the running v2 firmware accepts a sequence of `update_*` commands, writes new files to its filesystem, and reboots into them. Works over USB serial **and** WiFi/HTTP, no raw-REPL needed.
  2. **Out-of-band fallback** — when the device is at the MicroPython REPL, runs no firmware, or speaks a protocol we don't recognize, the host drops to **raw-REPL flashing** using the same primitives already wired up in `public/js/pico-debug/` (`raw-repl.js`, `file-manager.js`).
- A **v1 → v2 cutover** uses path 2 automatically: a v1 device announces `protocol: "1.0"` from `info`, the host refuses to drive races, prompts the user to flash, and uses raw-REPL to overwrite the firmware.

A user with one Pico, no terminal experience, and no USB cable expertise must be able to upgrade by clicking a button.

---

## 1. Versioning

- `firmware` field in `info` is a free-form string but SHOULD be `<major>.<minor>.<patch>` (semver).
- The host determines "out of date" by comparing the device's `firmware` to the version of the firmware it's about to flash (downloaded from GitHub at `FIRMWARE_API`). Strict equality is sufficient — we don't try to be clever about "newer than".
- The host also checks `info.protocol`. If `!= "2.0"`, the device is **incompatible** regardless of firmware version, and the user is prompted to flash.

---

## 2. In-Band Update Command Family

All commands are v2 protocol frames. The full sequence is:

1. `update_begin` — declare the upload session.
2. `update_chunk` × N — stream file chunks, base64-encoded.
3. `update_commit` — atomically swap and reboot, or
4. `update_abort` — discard the pending upload.

The device accepts at most **one** active update session. A second `update_begin` while one is open returns `code: busy`.

While an update session is open, **no race commands are accepted** (`wait_race`, `wait_gate` return `code: bad_state`). Subscriptions remain active so the host can still see gate/lane state if it wants to.

### 2.1 `update_begin`

```json
{ "id": 1, "cmd": "update_begin", "version": "0.2.1", "files": [
    { "name": "main.py",         "size": 1234, "sha256": "..." },
    { "name": "protocol_v2.py",  "size": 9876, "sha256": "..." }
] }
```

- `version`: the firmware version being uploaded (string).
- `files`: list of file descriptors. `name` is a leaf filename (no directories — RallyLab firmware is flat). `size` is bytes. `sha256` is hex.

Response on success:

```json
{ "id": 1, "ok": { "session": "u-1234", "chunk_size": 256 } }
```

- `session`: opaque token; subsequent `update_chunk` and `update_commit` frames MUST carry it.
- `chunk_size`: maximum bytes per chunk the device will accept (post-base64 decode). Suggested: **256** for serial, **1024** for HTTP.

Errors:

- `bad_args` — manifest malformed.
- `busy` — another update session is open.
- `not_supported` — device doesn't have enough free flash for the declared sizes.

### 2.2 `update_chunk`

```json
{ "id": 2, "cmd": "update_chunk", "session": "u-1234",
  "name": "main.py", "offset": 0, "data": "<base64>" }
```

- `name` MUST match a file declared in `update_begin`.
- `offset` MUST be the running byte count for that file. The device rejects out-of-order chunks.
- `data` is base64. After decode, `len <= chunk_size`.

Response:

```json
{ "id": 2, "ok": { "received": 256 } }
```

After the last chunk for a file, the device automatically validates `sha256` against the manifest. Mismatch returns `code: bad_args` and discards the file (the rest of the session continues — host MAY restart that file).

### 2.3 `update_commit`

```json
{ "id": 99, "cmd": "update_commit", "session": "u-1234" }
```

Pre-commit checks:
- All files declared in `update_begin` MUST be fully uploaded and SHA-verified.
- Engine MUST be in `IDLE` (not `ARMED` / `RACING`) — otherwise returns `code: bad_state`.

Commit semantics:
1. Files are written to a staging directory (`/_stage/`) during `update_chunk`.
2. On commit, the device atomically renames `/_stage/<name>` → `/<name>` for each file. Existing files are overwritten.
3. The device responds with `ok` **before** rebooting:
   ```json
   { "id": 99, "ok": { "committed": true, "rebooting_in_ms": 500 } }
   ```
4. After ~500ms, the device performs a soft-reset (`machine.soft_reset()`).

The host should:
- Drain pending requests after the `committed: true` response (any in-flight will fail with disconnect).
- Wait for the device to come back (typically 2s), then re-`info` to confirm new version.

### 2.4 `update_abort`

```json
{ "id": 50, "cmd": "update_abort", "session": "u-1234" }
```

Discards the staging directory. Response: `{ "id": 50, "ok": {} }`.

The session is also auto-aborted if no `update_chunk` arrives within **30 seconds** (configurable in firmware).

---

## 3. Out-of-Band Fallback (Raw-REPL Flash)

When `info` doesn't return v2-compatible JSON (timeout, parse error, or `protocol != "2.0"`), the host drops to raw-REPL flashing using the existing scaffolding in `public/js/pico-debug/`:

1. Open the serial port (`createSerialPort`).
2. Enter raw REPL (`createRawRepl(port).enter()`).
3. Use `createFileManager(rawRepl).writeFiles(entries)` to overwrite each file in `firmware/` with the contents fetched from `FIRMWARE_API`.
4. `softReset()` to boot the new firmware.
5. Re-probe `info` — should now be v2.

This path is also what `connectSerial` already does today when no firmware is on the device (the "Downloading firmware…" branch). The cutover work makes it run **also** when v1 firmware is detected.

WiFi has **no raw-REPL fallback** — if a WiFi-connected device is on v1, the user must connect via USB to flash. The host surfaces this clearly.

---

## 4. Host UX

### 4.1 Detection

After `connectSerial` or `connectWifi`, the host:
- Reads `info.protocol` and `info.firmware`.
- Reads the latest manifest from GitHub (`FIRMWARE_API`).
- If `info.protocol != "2.0"` → "Incompatible firmware. Flash now?" (USB only) or "USB connection required to flash." (WiFi).
- If `info.protocol == "2.0"` and `info.firmware != latest` → "Update available: x.y.z → a.b.c. Flash now?" (button on Track Manager dialog, not blocking).

### 4.2 Flash flow (UI)

The Track Manager dialog gains a "Firmware" section showing:
- Current device version and protocol.
- Latest available version from GitHub.
- One of: "Up to date" / "Update available [Flash]" / "Incompatible — flash required [Flash]".

`Flash` opens a modal:
1. "Connecting…" (open raw-REPL or open update session).
2. "Uploading n/N: filename.py…" with progress bar.
3. "Committing…"
4. "Rebooting…" (~2s).
5. "Done — firmware version 0.2.1." — auto-close after 2s.

If the device disappears or times out, show a Retry button. Cancellation aborts via `update_abort` (in-band) or simply re-probes (out-of-band — raw-REPL writes are partial-OK because we always overwrite all files in the next attempt).

### 4.3 Source of truth

The "latest" firmware is whatever `firmware/` looks like on the `main` branch of the repo, listed via `FIRMWARE_API` (already wired in `track-connection.js`). The version string the host compares against is read from `firmware/config.py`'s `FIRMWARE_VERSION` constant (parsed via regex from the GitHub raw content).

This keeps the spec light: the GitHub repo *is* the firmware registry. No separate manifest service.

---

## 5. Open Questions

- **Signed firmware?** Out of scope for v1 — anyone with USB access already has full control of the device. Revisit if/when WiFi flashing becomes a vector.
- **Multi-Pico fleet management?** Out of scope. RallyLab targets a single connected device per session.
- **Rollback?** Not supported. If a flash leaves the device unbootable, the user re-flashes via raw-REPL (path 2). We could add a "previous version" copy in `/_stage/`, but the failure mode is rare and disk space on the Pico is tight.

---

**End of Firmware Update Protocol v1.0 (Draft)**
