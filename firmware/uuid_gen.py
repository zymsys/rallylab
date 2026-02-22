# uuid_gen.py — UUID v4 generation from os.urandom

import os


def uuid4():
    b = bytearray(os.urandom(16))
    b[6] = (b[6] & 0x0F) | 0x40  # version 4
    b[8] = (b[8] & 0x3F) | 0x80  # variant 1
    h = ''.join('%02x' % x for x in b)
    return '%s-%s-%s-%s-%s' % (h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])
