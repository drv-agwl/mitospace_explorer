"""
Endpoint tests for the data API on a small synthetic v3 dataset (no parquet, no startup event).

    python -m unittest discover -s server/tests -t .
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "server"))

import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import dataset_registry  # noqa: E402
import main  # noqa: E402

FEATURE = "fragment_length_mean"
N = 400
MISSING = 20
LABELS = ["control"] * 200 + ["cccp"] * 200


def _synthetic_v3() -> dataset_registry.Dataset:
    rng = np.random.default_rng(7)
    values = rng.normal(2.0, 0.5, N).astype(np.float32)
    values[:MISSING] = np.nan
    ds = dataset_registry.Dataset(
        version="v3",
        umap_points=rng.normal(size=(N, 3)).astype(np.float32),
        feature_values={FEATURE: values},
        row_hash=dataset_registry.row_order_hash(LABELS),
    )
    dataset_registry._fit_axis_models(ds, [FEATURE])
    return ds


class DataApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._previous = dataset_registry._REGISTRY.get("v3")
        dataset_registry.register(_synthetic_v3())
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        dataset_registry._REGISTRY.pop("v3", None)
        if cls._previous is not None:
            dataset_registry.register(cls._previous)

    def test_health_is_minimal(self):
        r = self.client.get("/api/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(
            r.json(),
            {
                "status": "ok",
                "version": "v3",
                "point_count": N,
                "row_order": dataset_registry.row_order_hash(LABELS),
            },
        )

    def test_ready(self):
        self.assertEqual(self.client.get("/api/ready").status_code, 200)
        saved = dataset_registry._REGISTRY.pop("v3")
        try:
            self.assertEqual(self.client.get("/api/ready").status_code, 503)
        finally:
            dataset_registry.register(saved)

    def test_feature_values_json_marks_missing_as_null(self):
        r = self.client.get(f"/api/features/{FEATURE}")
        self.assertEqual(r.status_code, 200)
        values = r.json()["values"]
        self.assertEqual(len(values), N)
        self.assertEqual(sum(v is None for v in values), MISSING)

    def test_feature_values_binary(self):
        r = self.client.get(f"/api/features/{FEATURE}?format=f32")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["content-type"], "application/octet-stream")
        values = np.frombuffer(r.content, dtype="<f4")
        self.assertEqual(len(values), N)
        self.assertEqual(int(np.isnan(values).sum()), MISSING)

    def test_etag_revalidation(self):
        first = self.client.get(f"/api/features/{FEATURE}?format=f32")
        self.assertIn("max-age", first.headers["cache-control"])
        again = self.client.get(
            f"/api/features/{FEATURE}?format=f32", headers={"If-None-Match": first.headers["etag"]}
        )
        self.assertEqual(again.status_code, 304)
        self.assertEqual(again.content, b"")

    def test_feature_stats(self):
        r = self.client.get(f"/api/feature-stats?feature={FEATURE}")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["missing"], MISSING)
        self.assertLess(body["min"], body["max"])

    def test_axis_trajectory(self):
        r = self.client.get(f"/api/axis-trajectory?feature={FEATURE}&num_points=12")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()["points"]), 12)

    def test_project(self):
        r = self.client.post("/api/project", json={"pointIndex": 0, "targetValue": 2.0, "feature": FEATURE})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(all(isinstance(r.json()[k], float) for k in ("x", "y", "z")))

    def test_unknown_version_is_rejected(self):
        for url in (f"/api/features/{FEATURE}?version=v9", "/api/health?version=v9"):
            self.assertEqual(self.client.get(url).status_code, 400, url)

    def test_unknown_feature_is_404(self):
        self.assertEqual(self.client.get("/api/features/not_a_feature").status_code, 404)

    def test_docs_are_off_by_default(self):
        if main._docs_enabled:
            self.skipTest("ENABLE_DOCS is set")
        self.assertEqual(self.client.get("/docs").status_code, 404)
        self.assertEqual(self.client.get("/openapi.json").status_code, 404)


class RequestLimitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def test_declared_oversize_body_is_rejected(self):
        r = self.client.post(
            "/api/project",
            content=b"x" * (main.MAX_BODY_BYTES + 1),
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(r.status_code, 413)

    def test_streamed_oversize_body_is_rejected(self):
        chunks = (b"x" * 8192 for _ in range(main.MAX_BODY_BYTES // 8192 + 2))
        r = self.client.post("/api/project", content=chunks, headers={"Content-Type": "application/json"})
        self.assertEqual(r.status_code, 413)

    def test_long_fields_are_rejected(self):
        r = self.client.post(
            "/api/project", json={"pointIndex": 0, "targetValue": 1, "feature": "x" * 500}
        )
        self.assertEqual(r.status_code, 422)


class CorsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def test_production_origin_is_allowed_without_credentials(self):
        r = self.client.get("/", headers={"Origin": "https://mitospace.ai"})
        self.assertEqual(r.headers.get("access-control-allow-origin"), "https://mitospace.ai")
        self.assertNotIn("access-control-allow-credentials", r.headers)

    def test_other_hosted_sites_are_not_allowed(self):
        for origin in ("https://evil.onrender.com", "https://anything.netlify.app"):
            r = self.client.get("/", headers={"Origin": origin})
            self.assertNotIn("access-control-allow-origin", r.headers, origin)

    def test_settings_for_render_with_previews(self):
        import re

        origins, pattern = main._cors_settings({"RENDER": "true", "NETLIFY_SITE_NAME": "mitospace"})
        self.assertIn("https://mitospace.ai", origins)
        allowed = re.compile(pattern)
        self.assertTrue(allowed.fullmatch("https://deploy-preview-12--mitospace.netlify.app"))
        self.assertTrue(allowed.fullmatch("https://mitospace.netlify.app"))
        self.assertIsNone(allowed.fullmatch("https://evil.netlify.app"))
        self.assertIsNone(allowed.fullmatch("http://localhost:5173"))

    def test_settings_on_render_without_previews(self):
        _, pattern = main._cors_settings({"RENDER": "true"})
        self.assertIsNone(pattern)


class RowOrderHashTests(unittest.TestCase):
    def test_matches_the_explorer_implementation(self):
        # Same value as rowOrderHash(['control', 'cccp']) in src/data/compactPoints.ts.
        self.assertEqual(dataset_registry.row_order_hash(["control", "cccp"]), "f8beb041")


if __name__ == "__main__":
    unittest.main()
