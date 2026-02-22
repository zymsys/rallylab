# wifi_manager.py — WiFi connection management
#
# Handles credential storage (wifi.json on flash), connecting to
# venue WiFi as a station (STA_IF), and exposing connection status.

import json
import time
import network
from config import WIFI_CONNECT_TIMEOUT_MS

_CRED_FILE = "wifi.json"


class WiFiManager:
    def __init__(self):
        self._wlan = network.WLAN(network.STA_IF)

    # -- credential persistence ------------------------------------------------

    def load_credentials(self):
        """Read wifi.json from flash. Return dict {ssid, password} or None."""
        try:
            with open(_CRED_FILE, "r") as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def save_credentials(self, ssid, password):
        """Write wifi.json to flash."""
        with open(_CRED_FILE, "w") as f:
            json.dump({"ssid": ssid, "password": password}, f)

    def clear_credentials(self):
        """Delete wifi.json from flash."""
        try:
            import os
            os.remove(_CRED_FILE)
        except OSError:
            pass

    # -- connection ------------------------------------------------------------

    def connect(self, ssid, password):
        """Blocking connect (up to WIFI_CONNECT_TIMEOUT_MS). Return bool."""
        self._wlan.active(True)
        self._wlan.connect(ssid, password)
        start = time.ticks_ms()
        while not self._wlan.isconnected():
            if time.ticks_diff(time.ticks_ms(), start) >= WIFI_CONNECT_TIMEOUT_MS:
                return False
            time.sleep_ms(100)
        return True

    def auto_connect(self):
        """Load saved credentials and connect. Return bool."""
        creds = self.load_credentials()
        if creds is None:
            return False
        return self.connect(creds["ssid"], creds["password"])

    def disconnect(self):
        """Disconnect and deactivate WLAN."""
        try:
            self._wlan.disconnect()
        except OSError:
            pass
        self._wlan.active(False)

    # -- scanning --------------------------------------------------------------

    _AUTH_NAMES = {0: "open", 1: "WEP", 2: "WPA-PSK", 3: "WPA2-PSK",
                   4: "WPA/WPA2-PSK", 5: "WPA2-Enterprise"}

    def scan(self):
        """Scan for visible APs. Returns list of {ssid, rssi, security}."""
        was_active = self._wlan.active()
        self._wlan.active(True)
        raw = self._wlan.scan()
        if not was_active:
            self._wlan.active(False)
        results = []
        seen = set()
        for ssid_bytes, bssid, channel, rssi, auth, hidden in raw:
            ssid = ssid_bytes.decode()
            if not ssid or ssid in seen:
                continue
            seen.add(ssid)
            results.append({
                "ssid": ssid,
                "rssi": rssi,
                "security": self._AUTH_NAMES.get(auth, str(auth)),
            })
        results.sort(key=lambda ap: -ap["rssi"])
        return results

    # -- status ----------------------------------------------------------------

    def is_connected(self):
        return self._wlan.isconnected()

    @property
    def ip_address(self):
        """IP address string, or None if not connected."""
        if not self._wlan.isconnected():
            return None
        return self._wlan.ifconfig()[0]

    def status(self):
        """Return status dict for debug / wifi command."""
        connected = self._wlan.isconnected()
        result = {
            "mode": "sta",
            "connected": connected,
        }
        if connected:
            result["ssid"] = self._wlan.config("essid")
            result["ip"] = self._wlan.ifconfig()[0]
            try:
                result["rssi"] = self._wlan.status("rssi")
            except (ValueError, OSError):
                pass
        return result
