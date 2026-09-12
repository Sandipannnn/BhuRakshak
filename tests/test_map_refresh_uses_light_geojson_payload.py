from pathlib import Path


def test_map_refresh_uses_light_geojson_payload():
    text = Path("web/js/map.js").read_text(encoding="utf-8")
    assert "includeFeatures: false" in text
