from pathlib import Path


def test_api_js_does_not_use_abortsignal_timeout():
    text = Path("web/js/api.js").read_text(encoding="utf-8")
    assert "AbortSignal.timeout" not in text
