"""
Visit beacon: payload cleaning, organization lookup, webhooks, and that IP addresses are never logged.

    python -m unittest discover -s server/tests -t .
"""
from __future__ import annotations

import io
import json
import os
import sys
import unittest
import urllib.error
from email.message import Message
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "server"))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import visits  # noqa: E402

VISITOR_IP = "128.146.65.112"
CHROME_MAC = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/142.0.0.0 Safari/537.36"
)
SLACK_URL = "https://hooks.slack.com/services/T000/B000/XXXX"
SHEET_URL = "https://script.google.com/macros/s/abc/exec"

UNIVERSITY = {
    "ip": VISITOR_IP,
    "is_crawler": False,
    "is_datacenter": False,
    "is_tor": False,
    "is_proxy": False,
    "is_vpn": False,
    "company": {"name": "The Ohio State University", "domain": "osu.edu", "type": "education"},
    "asn": {"asn": 159, "org": "The Ohio State University", "domain": "osu.edu", "type": "education"},
    "location": {"country_code": "US", "state": "Ohio", "city": "Columbus"},
}
HOME_BROADBAND = {
    "ip": VISITOR_IP,
    "is_datacenter": False,
    "company": {"name": "Comcast Cable Communications, LLC", "domain": "comcast.com", "type": "isp"},
    "asn": {"org": "Comcast Cable Communications, LLC", "type": "isp"},
    "location": {"country_code": "US", "state": "California", "city": "San Jose"},
}


def _ipapi_reply(payload: dict) -> mock.MagicMock:
    response = mock.MagicMock()
    response.__enter__.return_value = io.BytesIO(json.dumps(payload).encode())
    return response


def _start(**extra) -> dict:
    return {"kind": "start", "sid": "tab-0001-abcd", "landing": "/about", "visit_number": 1, **extra}


class VisitHelpersTests(unittest.TestCase):
    def test_client_ip_prefers_the_edge_header(self):
        headers = {"cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1, 10.0.0.1"}
        self.assertEqual(visits.client_ip(headers, "10.0.0.2"), "203.0.113.9")
        self.assertEqual(visits.client_ip({"x-forwarded-for": "198.51.100.1, 10.0.0.1"}, None), "198.51.100.1")
        self.assertEqual(visits.client_ip({}, "127.0.0.1"), "127.0.0.1")
        self.assertIsNone(visits.client_ip({"x-forwarded-for": "not-an-ip"}, None))

    def test_network_summary(self):
        info = visits.summarize_network(UNIVERSITY)
        self.assertEqual(
            info,
            {
                "org": "The Ohio State University",
                "org_type": "education",
                "org_domain": "osu.edu",
                "city": "Columbus",
                "region": "Ohio",
                "country": "US",
            },
        )
        self.assertTrue(visits.is_identified(info))
        self.assertFalse(visits.is_identified(visits.summarize_network(HOME_BROADBAND)))
        relay = {**UNIVERSITY, "is_datacenter": True, "egress_service": {"provider": "iCloud Private Relay"}}
        self.assertFalse(visits.is_identified(visits.summarize_network(relay)))
        self.assertEqual(visits.summarize_network("not json object"), {})

    def test_beacon_is_cleaned_not_rejected(self):
        beacon = visits.VisitIn.model_validate(
            {
                "kind": "end",
                "sid": "tab-0001-abcd",
                "ref": "a16z\n-01" + "x" * 100,
                "utm": {"campaign": "seed\x00", "evil": "x"},
                "active_s": -5,
                "pages": ["/", "/about", 3],
                "events": {"select_cell": 4, "Bad Name": 1, "flag": True, "frac": 1.5},
            }
        )
        self.assertEqual(beacon.ref, ("a16z-01" + "x" * 100)[:64])
        self.assertEqual(beacon.utm, {"campaign": "seed"})
        self.assertEqual(beacon.active_s, 0)
        self.assertEqual(beacon.pages, ["/", "/about", "3"])
        self.assertEqual(beacon.events, {"select_cell": 4})

    def test_alert_payload_shapes(self):
        self.assertEqual(visits.alert_payload("https://discord.com/api/webhooks/1/x", "hi"), {"content": "hi"})
        self.assertEqual(visits.alert_payload(SLACK_URL, "hi"), {"text": "hi"})

    def test_quota_refusal_pauses_lookups(self):
        lookup = visits.NetworkLookup()
        headers = Message()
        headers["Retry-After"] = "120"
        refused = urllib.error.HTTPError(visits.IPAPI_URL, 429, "Too Many Requests", headers, None)
        with mock.patch.object(visits.urllib.request, "urlopen", side_effect=refused) as urlopen:
            self.assertEqual(lookup(VISITOR_IP, "key"), {})
            self.assertEqual(lookup("8.8.4.4", "key"), {})
        self.assertEqual(urlopen.call_count, 1)

    def test_private_addresses_are_not_looked_up(self):
        with mock.patch.object(visits.urllib.request, "urlopen") as urlopen:
            self.assertEqual(visits.NetworkLookup()("192.168.1.10", "key"), {})
        urlopen.assert_not_called()


class VisitEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def setUp(self):
        self._lookup = visits.lookup
        self._forwarded = visits._forwarded
        visits.lookup = visits.NetworkLookup()
        visits._forwarded = visits._ForwardedSummaries()
        self.send = mock.patch.object(visits, "send_webhook").start()
        self.addCleanup(mock.patch.stopall)

    def tearDown(self):
        visits.lookup = self._lookup
        visits._forwarded = self._forwarded

    def _post(self, payload, user_agent=CHROME_MAC):
        return self.client.post(
            "/api/visit",
            content=json.dumps(payload),
            headers={"Content-Type": "text/plain", "User-Agent": user_agent, "cf-connecting-ip": VISITOR_IP},
        )

    def test_identified_visit_is_returned_logged_and_alerted(self):
        env = {"IPAPI_KEY": "secret-key", "VISIT_LOG_WEBHOOK_URL": SHEET_URL, "VISIT_ALERT_WEBHOOK_URL": SLACK_URL}
        with mock.patch.dict(os.environ, env), mock.patch.object(
            visits.urllib.request, "urlopen", return_value=_ipapi_reply(UNIVERSITY)
        ) as urlopen, self.assertLogs("mitospace.visits", level="INFO") as logs:
            r = self._post(_start(referrer="https://www.linkedin.com/"))

        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["cache-control"], "no-store")
        self.assertEqual(
            r.json(), {"org": "The Ohio State University", "org_type": "education", "org_domain": "osu.edu"}
        )
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, visits.IPAPI_URL)
        self.assertEqual(json.loads(request.data), {"q": VISITOR_IP, "key": "secret-key"})

        deliveries = {call.args[0]: call.args[1] for call in self.send.call_args_list}
        self.assertEqual(set(deliveries), {SHEET_URL, SLACK_URL})
        self.assertEqual(
            deliveries[SLACK_URL]["text"],
            "New visit: The Ohio State University (education) · Columbus, Ohio, US · from www.linkedin.com"
            " · landed on /about · Chrome on macOS",
        )
        self.assertEqual(deliveries[SHEET_URL]["visit"]["org"], "The Ohio State University")
        for record in logs.records:
            self.assertNotIn(VISITOR_IP, json.dumps(vars(record), default=str))
        self.assertNotIn(VISITOR_IP, json.dumps(deliveries))

    def test_home_broadband_is_logged_but_not_alerted(self):
        env = {"IPAPI_KEY": "k", "VISIT_LOG_WEBHOOK_URL": SHEET_URL, "VISIT_ALERT_WEBHOOK_URL": SLACK_URL}
        with mock.patch.dict(os.environ, env), mock.patch.object(
            visits.urllib.request, "urlopen", return_value=_ipapi_reply(HOME_BROADBAND)
        ):
            r = self._post(_start())
        self.assertEqual(r.json()["org_type"], "isp")
        self.assertEqual([call.args[0] for call in self.send.call_args_list], [SHEET_URL])

    def test_personal_link_is_alerted_without_a_lookup_key(self):
        with mock.patch.dict(os.environ, {"IPAPI_KEY": "", "VISIT_ALERT_WEBHOOK_URL": SLACK_URL}), mock.patch.object(
            visits.urllib.request, "urlopen"
        ) as urlopen:
            r = self._post(_start(ref="vc-07"))
        self.assertEqual(r.json(), {})
        urlopen.assert_not_called()
        text = self.send.call_args.args[1]["text"]
        self.assertIn("ref vc-07", text)

    def test_bots_are_logged_but_not_forwarded(self):
        with mock.patch.dict(os.environ, {"IPAPI_KEY": "", "VISIT_LOG_WEBHOOK_URL": SHEET_URL}):
            r = self._post(_start(), user_agent="Mozilla/5.0 HeadlessChrome/142.0.0.0")
        self.assertEqual(r.json(), {"traffic": "bot"})
        self.send.assert_not_called()

    def test_summaries_are_forwarded_first_then_only_after_more_activity(self):
        with mock.patch.dict(os.environ, {"IPAPI_KEY": "", "VISIT_LOG_WEBHOOK_URL": SHEET_URL}):
            for active in (20, 100, 400):
                payload = {"kind": "end", "sid": "tab-0001-abcd", "active_s": active, "pages": ["/"]}
                self.assertEqual(self._post(payload).status_code, 200)
        forwarded = [call.args[1]["visit"]["active_s"] for call in self.send.call_args_list]
        self.assertEqual(forwarded, [20, 400])

    def test_invalid_beacons_are_rejected(self):
        self.assertEqual(self._post({"kind": "start", "sid": "x"}).status_code, 422)
        self.assertEqual(self._post({"kind": "other", "sid": "tab-0001-abcd"}).status_code, 422)
        r = self.client.post("/api/visit", content="not json", headers={"Content-Type": "text/plain"})
        self.assertEqual(r.status_code, 422)


if __name__ == "__main__":
    unittest.main()
