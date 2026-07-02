import json
import logging
from pathlib import Path

log = logging.getLogger(__name__)

PRESETS_FILE = Path(__file__).parent / "krea2_eq_presets.json"


def _load_presets():
    if not PRESETS_FILE.is_file():
        return {}
    try:
        with PRESETS_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as e:
        log.error("[darkilNodes.krea2_eq_presets] load error: %s", e)
        return {}


def _save_presets(presets):
    try:
        with PRESETS_FILE.open("w", encoding="utf-8") as f:
            json.dump(presets, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        log.error("[darkilNodes.krea2_eq_presets] save error: %s", e)
        return False


def _normalize_entry(body):
    try:
        multiplier = float(body.get("multiplier"))
    except (TypeError, ValueError):
        multiplier = 0.0
    weights = body.get("weights")
    weights = weights if isinstance(weights, str) else ""
    return {"multiplier": multiplier, "weights": weights}


try:
    from aiohttp import web
    from server import PromptServer

    routes = PromptServer.instance.routes

    @routes.get("/darkil/krea2_eq/presets")
    async def darkil_krea2_eq_get_presets(request):
        return web.json_response({"presets": _load_presets()})

    @routes.post("/darkil/krea2_eq/presets")
    async def darkil_krea2_eq_save_preset(request):
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "invalid json"}, status=400)

        name = (body.get("name") or "").strip()
        if not name:
            return web.json_response({"error": "empty name"}, status=400)

        presets = _load_presets()
        presets[name] = _normalize_entry(body)
        _save_presets(presets)
        return web.json_response({"presets": presets})

    @routes.delete("/darkil/krea2_eq/presets")
    async def darkil_krea2_eq_delete_preset(request):
        name = (request.rel_url.query.get("name") or "").strip()
        presets = _load_presets()
        if name in presets:
            del presets[name]
            _save_presets(presets)
        return web.json_response({"presets": presets})

    log.info("[darkilNodes] Krea2 EQ preset routes registered")

except Exception as e:
    log.error("[darkilNodes] Krea2 EQ preset routes not registered: %s", e)
