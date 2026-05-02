# http_handler.py — HTTP/SSE transport for protocol v2.
#
# Two routes:
#   POST /cmd   — body is one v2 JSON request frame; returns one v2 frame.
#   GET  /events?topics=gate,lanes — Server-Sent Events stream of v2 frames.
#
# Each SSE connection owns one v2 Session. /cmd creates a short-lived
# session, dispatches the request, captures the first frame, and closes.
#
# See specs/03-track-controller-protocol-v2.md §1.2.

import socket
import time
import errno

from config import HTTP_PORT
from protocol_v2 import HTTP_QUEUE_CAP


_PENDING_TIMEOUT_MS = 5000
_CORS = "Access-Control-Allow-Origin: *\r\n"


class HttpHandler:
    def __init__(self, dispatcher, wifi):
        self._d = dispatcher
        self._wifi = wifi
        self._server = None

        # (sock, buf, accept_ms) for in-progress request reads.
        self._pending = []
        # (sock, session, last_keepalive_ms) for active SSE clients.
        self._sse = []

    # ─── Lifecycle ─────────────────────────────────────────────────

    def start(self):
        self._server = socket.socket()
        self._server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._server.bind(("0.0.0.0", HTTP_PORT))
        self._server.listen(4)
        self._server.setblocking(False)

    def poll(self):
        """Accept new connections, read pending requests, drain SSE."""
        # Accept
        try:
            cl, _addr = self._server.accept()
            cl.setblocking(False)
            self._pending.append((cl, b"", time.ticks_ms()))
        except OSError as e:
            if e.errno != errno.EAGAIN:
                raise

        now = time.ticks_ms()

        # Read pending request bodies
        still = []
        for cl, buf, accept_ms in self._pending:
            if time.ticks_diff(now, accept_ms) > _PENDING_TIMEOUT_MS:
                cl.close()
                continue
            try:
                data = cl.recv(1024)
                if not data:
                    cl.close()
                    continue
                buf += data
            except OSError as e:
                if e.errno == errno.EAGAIN:
                    still.append((cl, buf, accept_ms))
                    continue
                cl.close()
                continue
            if self._request_complete(buf):
                self._handle_request(cl, buf)
            else:
                still.append((cl, buf, accept_ms))
        self._pending = still

        # SSE keepalive + drain queued frames
        sse_alive = []
        for cl, sess, last_ka in self._sse:
            try:
                # Drain any frames the session has queued.
                # Session.drain() will use _write_line; closure on error
                # will set sess._closed and we drop it below.
                sess.drain()
            except OSError:
                cl.close()
                continue
            if sess._closed:
                try:
                    cl.close()
                except Exception:
                    pass
                continue
            # Heartbeat every 15s.
            if time.ticks_diff(now, last_ka) > 15000:
                try:
                    cl.send(b": ping\n\n")
                    last_ka = now
                except OSError:
                    cl.close()
                    continue
            sse_alive.append((cl, sess, last_ka))
        self._sse = sse_alive

    # ─── Routing ───────────────────────────────────────────────────

    def _request_complete(self, buf):
        # Headers ended? If POST, also need the body length to be present.
        idx = buf.find(b"\r\n\r\n")
        if idx < 0:
            return False
        head = buf[:idx].decode("utf-8", "ignore")
        first = head.split("\r\n", 1)[0]
        if first.startswith("GET "):
            return True
        if first.startswith("POST "):
            body = buf[idx + 4:]
            length = 0
            for ln in head.split("\r\n")[1:]:
                if ln.lower().startswith("content-length:"):
                    try:
                        length = int(ln.split(":", 1)[1].strip())
                    except ValueError:
                        length = 0
                    break
            return len(body) >= length
        # Unknown verb — treat as complete so we 405 promptly.
        return True

    def _handle_request(self, cl, raw):
        head_end = raw.find(b"\r\n\r\n")
        head_bytes, body = raw[:head_end], raw[head_end + 4:]
        try:
            head = head_bytes.decode("utf-8", "ignore")
        except Exception:
            cl.close()
            return
        first = head.split("\r\n", 1)[0]
        parts = first.split()
        if len(parts) < 2:
            self._send_json(cl, 400, {"err": "bad request", "code": "bad_frame"})
            return
        method, path_raw = parts[0], parts[1]

        path, query = self._split_query(path_raw)

        if method == "OPTIONS":
            self._send_options(cl)
            return

        if method == "POST" and path == "/cmd":
            self._route_cmd(cl, body)
            return

        if method == "GET" and path == "/events":
            self._route_events(cl, query)
            return

        if method == "GET" and path == "/info":
            # Convenience for HTTP probing — mirror the v2 info command.
            self._route_info(cl)
            return

        self._send_json(cl, 404, {"err": "not found", "code": "not_supported"})

    def _split_query(self, url):
        if "?" in url:
            path, q = url.split("?", 1)
            params = {}
            for pair in q.split("&"):
                if "=" in pair:
                    k, v = pair.split("=", 1)
                    params[k] = v
            return path, params
        return url, {}

    # ─── /info ─────────────────────────────────────────────────────

    def _route_info(self, cl):
        # Use a transient session to render the info response once.
        captured = []
        sess = self._d.new_session(lambda l: captured.append(l) or True,
                                   queue_cap=HTTP_QUEUE_CAP)
        sess.feed_line('{"id":1,"cmd":"info"}')
        sess.drain()
        sess.close()
        if not captured:
            self._send_json(cl, 500, {"err": "no response"})
            return
        # Captured is a JSON line; forward as-is.
        body = captured[0]
        header = ("HTTP/1.1 200 OK\r\n"
                  "Content-Type: application/json\r\n"
                  + _CORS +
                  "Connection: close\r\n"
                  "Content-Length: %d\r\n\r\n" % len(body))
        try:
            cl.send(header.encode() + body.encode())
        except OSError:
            pass
        cl.close()

    # ─── /cmd ──────────────────────────────────────────────────────

    def _route_cmd(self, cl, body):
        try:
            line = body.decode("utf-8", "ignore").strip()
        except Exception:
            self._send_json(cl, 400, {"err": "bad body"})
            return
        if not line:
            self._send_json(cl, 400, {"err": "empty body"})
            return

        captured = []
        sess = self._d.new_session(lambda l: captured.append(l) or True,
                                   queue_cap=HTTP_QUEUE_CAP)
        sess.feed_line(line)
        sess.drain()
        # /cmd is request/response; close the transient session.
        sess.close()

        if not captured:
            # No synchronous response — request is a long wait.
            # /cmd is unsuitable for those; tell the client.
            self._send_json(cl, 202, {"err": "use SSE for waits", "code": "bad_state"})
            return

        body_out = captured[0]
        header = ("HTTP/1.1 200 OK\r\n"
                  "Content-Type: application/json\r\n"
                  + _CORS +
                  "Connection: close\r\n"
                  "Content-Length: %d\r\n\r\n" % len(body_out))
        try:
            cl.send(header.encode() + body_out.encode())
        except OSError:
            pass
        cl.close()

    # ─── /events (SSE) ─────────────────────────────────────────────

    def _route_events(self, cl, query):
        topics = query.get("topics", "")
        topic_list = [t.strip() for t in topics.split(",") if t.strip()]
        # Send SSE preamble.
        try:
            cl.send(("HTTP/1.1 200 OK\r\n"
                     "Content-Type: text/event-stream\r\n"
                     + _CORS +
                     "Cache-Control: no-cache\r\n"
                     "Connection: keep-alive\r\n\r\n").encode())
        except OSError:
            cl.close()
            return

        # Bind a session whose write_line emits SSE-framed lines.
        def write(line):
            try:
                cl.send(("data: " + line + "\n\n").encode())
                return True
            except OSError:
                return False  # tell session to back off

        sess = self._d.new_session(write, queue_cap=HTTP_QUEUE_CAP)

        # If the client passed topics in the query, auto-subscribe.
        if topic_list:
            import json as _json
            sess.feed_line(_json.dumps({"id": 1, "cmd": "subscribe",
                                         "topics": topic_list}))
        sess.drain()

        self._sse.append((cl, sess, time.ticks_ms()))

    # ─── Helpers ───────────────────────────────────────────────────

    def _send_json(self, cl, status, obj):
        try:
            import json as _json
            body = _json.dumps(obj)
        except Exception:
            body = '{"err":"encode error"}'
        text = "OK" if status == 200 else "Error"
        header = ("HTTP/1.1 %d %s\r\n"
                  "Content-Type: application/json\r\n"
                  + _CORS +
                  "Connection: close\r\n"
                  "Content-Length: %d\r\n\r\n") % (status, text, len(body))
        try:
            cl.send(header.encode() + body.encode())
        except OSError:
            pass
        cl.close()

    def _send_options(self, cl):
        header = ("HTTP/1.1 204 No Content\r\n"
                  + _CORS +
                  "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                  "Access-Control-Allow-Headers: Content-Type\r\n"
                  "Content-Length: 0\r\n\r\n")
        try:
            cl.send(header.encode())
        except OSError:
            pass
        cl.close()
