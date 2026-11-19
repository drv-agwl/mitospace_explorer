"""
First-party visit log: which organization each visit comes from, how it arrived and what it did.

The app posts a `start` beacon once per tab and a cumulative `end` summary whenever the tab is
hidden. Beacons reach this API even when the browser blocks Umami and Google Analytics. IP addresses
are used only for the lookup; they are never logged, stored or forwarded.
"""
from __future__ import annotations

import ipaddress
import json
import logging
import re
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Literal, Mapping, Optional
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

log = logging.getLogger("mitospace.visits")

IPAPI_URL = "https://api.ipapi.is"
LOOKUP_TIMEOUT_S = 3.0
WEBHOOK_TIMEOUT_S = 5.0
CACHE_TTL_S = 24 * 3600
CACHE_MAX = 5_000
# A summary is forwarded again only after this much more active time, so tab switching doesn't spam.
SUMMARY_FORWARD_STEP_S = 300
UTM_KEYS = ("source", "medium", "campaign", "content", "term")
# ipapi.is organization types that name who is behind a network, rather than their ISP or cloud.
IDENTIFYING_TYPES = {"education", "government", "banking", "business"}
NETWORK_FIELDS = ("org", "org_type", "org_domain", "network", "via", "city", "region", "country")

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_EVENT_NAME = re.compile(r"^[a-z0-9_]{1,40}$")
_BOT_UA = re.compile(r"bot|crawl|spider|slurp|headless|lighthouse", re.I)
_TEXT_LIMITS = {"landing": 300, "referrer": 300, "ref": 64, "screen": 20, "lang": 35, "tz": 64}
_BROWSERS = (
    ("Edg/", "Edge"), ("OPR/", "Opera"), ("Firefox/", "Firefox"), ("FxiOS/", "Firefox"),
    ("CriOS/", "Chrome"), ("Chrome/", "Chrome"), ("Safari/", "Safari"),
)
_SYSTEMS = (
    ("iPhone", "iOS"), ("iPad", "iPadOS"), ("Android", "Android"), ("Mac OS X", "macOS"),
    ("Windows", "Windows"), ("CrOS", "ChromeOS"), ("Linux", "Linux"),
)


def _text(value: Any, limit: int) -> Optional[str]:
    if value is None:
        return None
    text = _CONTROL.sub("", str(value)).strip()[:limit]
    return text or None


class VisitIn(BaseModel):
    """One beacon from the app. Free text is cleaned and truncated rather than rejected."""

    model_config = ConfigDict(extra="ignore")

    kind: Literal["start", "end"]
    sid: str = Field(pattern=r"^[A-Za-z0-9_-]{8,64}$")
    landing: Optional[str] = None
    referrer: Optional[str] = None
    ref: Optional[str] = None
    screen: Optional[str] = None
    lang: Optional[str] = None
    tz: Optional[str] = None
    utm: dict[str, str] = Field(default_factory=dict)
    visit_number: Optional[int] = None
    active_s: Optional[int] = None
    pages: list[str] = Field(default_factory=list)
    events: dict[str, int] = Field(default_factory=dict)

    @field_validator(*_TEXT_LIMITS, mode="before")
    @classmethod
    def _short_text(cls, value: Any, info: ValidationInfo) -> Optional[str]:
        return _text(value, _TEXT_LIMITS[info.field_name])

    @field_validator("utm", mode="before")
    @classmethod
    def _utm(cls, value: Any) -> dict[str, str]:
        if not isinstance(value, dict):
            return {}
        cleaned = {key: _text(value.get(key), 100) for key in UTM_KEYS}
        return {key: v for key, v in cleaned.items() if v}

    @field_validator("visit_number", "active_s", mode="before")
    @classmethod
    def _count(cls, value: Any) -> Optional[int]:
        try:
            return max(0, min(int(value), 10_000_000)) if value is not None else None
        except (TypeError, ValueError):
            return None

    @field_validator("pages", mode="before")
    @classmethod
    def _pages(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [page for page in (_text(v, 120) for v in value[:20]) if page]

    @field_validator("events", mode="before")
    @classmethod
    def _events(cls, value: Any) -> dict[str, int]:
        if not isinstance(value, dict):
            return {}
        return {
            name: max(0, min(count, 1_000_000))
            for name, count in list(value.items())[:40]
            if isinstance(name, str) and _EVENT_NAME.match(name) and type(count) is int
        }


def client_ip(headers: Mapping[str, str], peer: Optional[str]) -> Optional[str]:
    """The visitor's address: Cloudflare's header (Render's edge), else the first X-Forwarded-For hop."""
    raw = headers.get("cf-connecting-ip") or headers.get("true-client-ip")
    if not raw:
        forwarded = headers.get("x-forwarded-for")
        raw = forwarded.split(",")[0] if forwarded else peer
    try:
        return str(ipaddress.ip_address((raw or "").strip()))
    except ValueError:
        return None


def summarize_network(data: Any) -> dict:
    """The parts of an ipapi.is response worth keeping: who owns the network, where, and what kind."""
    if not isinstance(data, dict):
        return {}
    company = data.get("company") if isinstance(data.get("company"), dict) else {}
    asn = data.get("asn") if isinstance(data.get("asn"), dict) else {}
    location = data.get("location") if isinstance(data.get("location"), dict) else {}
    egress = data.get("egress_service") if isinstance(data.get("egress_service"), dict) else {}
    info = {
        "org": company.get("name") or asn.get("org"),
        "org_type": company.get("type") or asn.get("type"),
        "org_domain": company.get("domain") or asn.get("domain"),
        "network": asn.get("org"),
        # Zscaler, iCloud Private Relay…: the traffic is a real user's, the owner is the service.
        "via": egress.get("provider"),
        "city": location.get("city"),
        "region": location.get("state"),
        "country": location.get("country_code"),
        "crawler": data.get("is_crawler") or None,
        "datacenter": bool(data.get("is_datacenter")),
        "vpn": bool(data.get("is_vpn") or data.get("is_tor") or data.get("is_proxy")),
    }
    if info["network"] == info["org"]:
        info["network"] = None
    return {key: value for key, value in info.items() if value not in (None, "", False)}


def is_identified(network: Mapping[str, Any]) -> bool:
    """The network belongs to an organization, not to an ISP, cloud, VPN or relay."""
    if network.get("datacenter") or network.get("vpn") or network.get("crawler") or network.get("via"):
        return False
    return network.get("org_type") in IDENTIFYING_TYPES


class NetworkLookup:
    """ipapi.is lookups, cached per address for a day; pauses when the key is refused or out of quota."""

    def __init__(self) -> None:
        self._cache: OrderedDict[str, tuple[float, dict]] = OrderedDict()
        self._lock = threading.Lock()
        self._paused_until = 0.0

    def __call__(self, ip: Optional[str], key: str) -> dict:
        if not ip or not key or not ipaddress.ip_address(ip).is_global:
            return {}
        now = time.monotonic()
        with self._lock:
            hit = self._cache.get(ip)
            if hit and now - hit[0] < CACHE_TTL_S:
                return hit[1]
            if now < self._paused_until:
                return {}
        request = urllib.request.Request(
            IPAPI_URL,
            # The key goes in the body, which keeps it out of URLs and proxy logs.
            data=json.dumps({"q": ip, "key": key}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=LOOKUP_TIMEOUT_S) as response:
                info = summarize_network(json.load(response))
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 429):
                retry_after = (exc.headers.get("Retry-After") or "").strip()
                pause = int(retry_after) if retry_after.isdigit() else 3600
                with self._lock:
                    self._paused_until = now + pause
                log.warning("ip lookup paused", extra={"status": exc.code, "seconds": pause})
            return {}
        except (OSError, ValueError):
            return {}
        with self._lock:
            self._cache[ip] = (now, info)
            self._cache.move_to_end(ip)
            while len(self._cache) > CACHE_MAX:
                self._cache.popitem(last=False)
        return info


lookup = NetworkLookup()


def browser_name(user_agent: str) -> Optional[str]:
    browser = next((name for token, name in _BROWSERS if token in user_agent), None)
    system = next((name for token, name in _SYSTEMS if token in user_agent), None)
    return " on ".join(part for part in (browser, system) if part) or None


def _traffic(network: Mapping[str, Any], user_agent: str) -> Optional[str]:
    if network.get("crawler") or _BOT_UA.search(user_agent):
        return "bot"
    if network.get("vpn"):
        return "vpn"
    if network.get("datacenter") and not network.get("via"):
        return "datacenter"
    return None


def build_record(beacon: VisitIn, network: Mapping[str, Any], user_agent: str) -> dict:
    """A flat, spreadsheet-friendly record of one beacon (without the IP address)."""
    record = {
        "event": f"visit_{beacon.kind}",
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sid": beacon.sid,
        **{field: network.get(field) for field in NETWORK_FIELDS},
        "traffic": _traffic(network, user_agent),
        "browser": browser_name(user_agent),
        "landing": beacon.landing,
        "referrer": beacon.referrer,
        "ref": beacon.ref,
        **{f"utm_{key}": value for key, value in beacon.utm.items()},
        "screen": beacon.screen,
        "lang": beacon.lang,
        "tz": beacon.tz,
        "visit_number": beacon.visit_number,
        "active_s": beacon.active_s,
        "pages": " ".join(beacon.pages) or None,
        "events": ", ".join(
            f"{name} x{count}" for name, count in sorted(beacon.events.items(), key=lambda kv: -kv[1])
        ) or None,
    }
    return {key: value for key, value in record.items() if value not in (None, "")}


def _duration(seconds: int) -> str:
    return f"{seconds // 60} min {seconds % 60} s" if seconds >= 60 else f"{seconds} s"


def describe(record: Mapping[str, Any]) -> str:
    """One line for a chat alert."""
    who = record.get("org") or "Unknown network"
    if record.get("org_type"):
        who += f" ({record['org_type']})"
    if record.get("via"):
        who += f" via {record['via']}"
    if record["event"] == "visit_start":
        referrer = urlsplit(record.get("referrer") or "").hostname
        number = record.get("visit_number") or 1
        parts = [
            f"New visit: {who}",
            ", ".join(p for p in (record.get("city"), record.get("region"), record.get("country")) if p),
            f"ref {record['ref']}" if record.get("ref") else None,
            f"campaign {record['utm_campaign']}" if record.get("utm_campaign") else None,
            f"from {referrer}" if referrer else "direct",
            f"landed on {record.get('landing') or '/'}",
            record.get("browser"),
            f"visit #{number}" if number > 1 else None,
        ]
    else:
        parts = [
            f"Visit summary: {who}",
            f"{_duration(record.get('active_s') or 0)} active",
            f"pages {record['pages']}" if record.get("pages") else None,
            record.get("events"),
        ]
    return " · ".join(part for part in parts if part)


def alert_payload(url: str, text: str) -> dict:
    """Discord wants `content`; Slack, Google Chat and Mattermost take `text`."""
    host = (urlsplit(url).hostname or "").lower()
    if host == "discord.com" or host.endswith((".discord.com", "discordapp.com")):
        return {"content": text[:2000]}
    return {"text": text}


def send_webhook(url: str, payload: dict) -> None:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "mitospace-api"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=WEBHOOK_TIMEOUT_S):
            pass
    except (OSError, ValueError) as exc:
        log.warning("visit webhook failed", extra={"error": type(exc).__name__})


class _ForwardedSummaries:
    """Active seconds last forwarded per tab, so only the first and substantially longer summaries go out."""

    def __init__(self) -> None:
        self._seen: OrderedDict[str, int] = OrderedDict()
        self._lock = threading.Lock()

    def should_forward(self, sid: str, active_s: int) -> bool:
        with self._lock:
            last = self._seen.get(sid)
            if last is not None and active_s < last + SUMMARY_FORWARD_STEP_S:
                return False
            self._seen[sid] = active_s
            self._seen.move_to_end(sid)
            while len(self._seen) > CACHE_MAX:
                self._seen.popitem(last=False)
            return True


_forwarded = _ForwardedSummaries()


def record_visit(
    beacon: VisitIn, ip: Optional[str], user_agent: str, env: Mapping[str, str]
) -> tuple[dict, list[tuple[str, dict]]]:
    """Log one beacon. Returns what the browser may know about itself and the webhook deliveries to make."""
    network = lookup(ip, env.get("IPAPI_KEY", "").strip())
    record = build_record(beacon, network, user_agent)
    log.info("visit", extra=record)

    deliveries: list[tuple[str, dict]] = []
    forward = record.get("traffic") != "bot" and (
        beacon.kind == "start" or _forwarded.should_forward(beacon.sid, beacon.active_s or 0)
    )
    if forward:
        log_url = env.get("VISIT_LOG_WEBHOOK_URL", "").strip()
        if log_url:
            deliveries.append((log_url, {"text": describe(record), "visit": record}))
        alert_url = env.get("VISIT_ALERT_WEBHOOK_URL", "").strip()
        notable = is_identified(network) or bool(beacon.ref or beacon.utm.get("campaign"))
        if alert_url and notable:
            deliveries.append((alert_url, alert_payload(alert_url, describe(record))))

    reply: dict = {}
    if beacon.kind == "start":
        reply = {key: network[key] for key in ("org", "org_type", "org_domain") if key in network}
        if record.get("traffic"):
            reply["traffic"] = record["traffic"]
    return reply, deliveries
