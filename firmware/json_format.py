# json_format.py — Shared pretty-printer for JSON responses
#
# MicroPython's ujson.dumps() does not support the indent parameter,
# so we provide our own minimal pretty-printer used by both serial
# and HTTP handlers.

import json


def pretty(obj, indent=0):
    """Minimal pretty-printer for JSON-serialisable objects."""
    sp = "  " * indent
    sp1 = "  " * (indent + 1)
    if obj is None:
        return "null"
    if isinstance(obj, bool):
        return "true" if obj else "false"
    if isinstance(obj, int):
        return str(obj)
    if isinstance(obj, str):
        return json.dumps(obj)
    if isinstance(obj, list):
        if not obj:
            return "[]"
        parts = [sp1 + pretty(v, indent + 1) for v in obj]
        return "[\n" + ",\n".join(parts) + "\n" + sp + "]"
    if isinstance(obj, dict):
        if not obj:
            return "{}"
        parts = []
        for k in sorted(obj.keys(), key=str):
            v = obj[k]
            parts.append(sp1 + json.dumps(str(k)) + ": " + pretty(v, indent + 1))
        return "{\n" + ",\n".join(parts) + "\n" + sp + "}"
    return str(obj)
