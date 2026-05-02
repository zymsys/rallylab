# serial_handler.py — USB serial transport for protocol v2.
#
# Owns one v2 Session bound to stdin/stdout. Pumps inbound lines into the
# session and drains outbound frames as one JSON object per line.
#
# See specs/03-track-controller-protocol-v2.md.

import sys
import select


class SerialHandler:
    def __init__(self, dispatcher):
        self._d = dispatcher
        self._buf = ""
        self._poller = select.poll()
        self._poller.register(sys.stdin, select.POLLIN)

        # One session for the serial transport.
        self._session = dispatcher.new_session(self._write_line)

    def _write_line(self, line):
        # One JSON object per line, no pretty-print on the wire.
        # If stdout fails, the session will catch the exception and close.
        sys.stdout.write(line)
        sys.stdout.write("\n")
        return True

    def poll(self):
        """Read available stdin bytes; dispatch complete lines."""
        while self._poller.poll(0):
            ch = sys.stdin.read(1)
            if ch in ("\n", "\r"):
                line = self._buf
                self._buf = ""
                if line:
                    self._session.feed_line(line)
            else:
                self._buf += ch
        # Drain any buffered output the session has queued.
        self._session.drain()

    @property
    def session(self):
        return self._session
