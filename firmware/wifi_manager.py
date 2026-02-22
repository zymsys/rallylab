# wifi_manager.py — WiFi connection management
#
# Handles credential storage (wifi.json on flash), connecting to
# venue WiFi as a station (STA_IF), and exposing connection status.

import json
import time
import network
from config import WIFI_CONNECT_TIMEOUT_MS

_CRED_FILE = "wifi.json"


def _default_hostname():
    """Build unique hostname from last 3 octets of MAC, e.g. rallylab-a1b2c3."""
    wlan = network.WLAN(network.STA_IF)
    mac = wlan.config("mac")
    suffix = "".join("%02x" % b for b in mac[-3:])
    return "rallylab-" + suffix


class WiFiManager:
    def __init__(self):
        self._wlan = network.WLAN(network.STA_IF)
        self.hostname = self._load_hostname() or _default_hostname()
        network.hostname(self.hostname)

    # -- persistence -----------------------------------------------------------

    def _load_config(self):
        """Read wifi.json from flash. Return dict or empty dict."""
        try:
            with open(_CRED_FILE, "r") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _save_config(self, data):
        """Write wifi.json to flash."""
        with open(_CRED_FILE, "w") as f:
            json.dump(data, f)

    def load_credentials(self):
        """Return {ssid, password} or None."""
        cfg = self._load_config()
        if "ssid" in cfg and "password" in cfg:
            return {"ssid": cfg["ssid"], "password": cfg["password"]}
        return None

    def save_credentials(self, ssid, password):
        cfg = self._load_config()
        cfg["ssid"] = ssid
        cfg["password"] = password
        self._save_config(cfg)

    def clear_credentials(self):
        cfg = self._load_config()
        cfg.pop("ssid", None)
        cfg.pop("password", None)
        self._save_config(cfg)

    def _load_hostname(self):
        """Return saved custom hostname, or None."""
        return self._load_config().get("hostname")

    def set_hostname(self, name):
        """Persist a custom hostname. Takes effect on next boot."""
        cfg = self._load_config()
        cfg["hostname"] = name
        self._save_config(cfg)
        self.hostname = name
        network.hostname(name)

    def clear_hostname(self):
        """Remove custom hostname, reverting to MAC-based default."""
        cfg = self._load_config()
        cfg.pop("hostname", None)
        self._save_config(cfg)
        self.hostname = _default_hostname()
        network.hostname(self.hostname)

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
            "hostname": self.hostname + ".local",
        }
        if connected:
            result["ssid"] = self._wlan.config("essid")
            result["ip"] = self._wlan.ifconfig()[0]
            try:
                result["rssi"] = self._wlan.status("rssi")
            except (ValueError, OSError):
                pass
        return result
