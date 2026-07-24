import json
import logging

from comfy.comfy_types.node_typing import IO


log = logging.getLogger(__name__)


MAX_TEXT = 200000
MAX_POINTS = 512
MAX_SERIES = 200
MAX_IMAGES = 16


def _is_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _tensor_kind(v):
    try:
        import torch
    except Exception:
        return None
    if not isinstance(v, torch.Tensor):
        return None
    if v.dim() == 4 and v.shape[-1] in (1, 3, 4):
        return "image"
    return "mask"


def _is_video(v):
    try:
        from comfy_api.input import VideoInput
    except Exception:
        return False
    try:
        return isinstance(v, VideoInput)
    except Exception:
        return False


def _detect(v):
    if v is None:
        return "empty"

    tk = _tensor_kind(v)
    if tk:
        return tk

    if isinstance(v, dict):
        if "waveform" in v and "sample_rate" in v:
            return "audio"
        if "samples" in v:
            return "latent"
        return "json"

    if _is_video(v):
        return "video"

    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return "string"

    if isinstance(v, (list, tuple)):
        seq = list(v)
        if seq and all(_is_number(x) for x in seq):
            return "numlist"
        if seq and all(isinstance(x, (list, tuple)) and x and all(_is_number(y) for y in x) for x in seq):
            return "numlists"
        return "listjson"

    return "unknown"


def _safe_repr(v):
    try:
        return repr(v)
    except Exception:
        return object.__repr__(v)


def _json_ok(text):
    t = text.strip()
    if not t or t[0] not in "{[":
        return False
    try:
        json.loads(t)
        return True
    except Exception:
        return False


def _pretty_json(obj):
    try:
        return json.dumps(obj, indent=2, ensure_ascii=False, default=str)
    except Exception:
        return _safe_repr(obj)


def _numeric_from_json(text):
    t = text.strip()
    if not t or t[0] != "[":
        return None
    try:
        data = json.loads(t)
    except Exception:
        return None
    if not isinstance(data, list) or not data:
        return None
    if all(_is_number(x) for x in data):
        return ("values", [float(x) for x in data[:MAX_POINTS]])
    if all(isinstance(x, list) and x and all(_is_number(y) for y in x) for x in data):
        return ("series", [[float(y) for y in row] for row in data[:MAX_SERIES]])
    return None


def _tensor_summary(v):
    try:
        return f"{type(v).__name__} shape={tuple(v.shape)} dtype={v.dtype}"
    except Exception:
        return _safe_repr(v)


def _audio_summary(v):
    try:
        return f"AUDIO waveform={tuple(v['waveform'].shape)} sample_rate={v['sample_rate']}"
    except Exception:
        return _safe_repr(v)


def _latent_summary(v):
    try:
        return f"LATENT samples={tuple(v['samples'].shape)} dtype={v['samples'].dtype}"
    except Exception:
        return _safe_repr(v)


def _mask_to_image(mask):
    m = mask
    if m.dim() == 2:
        m = m.unsqueeze(0)
    return m.unsqueeze(-1).repeat(1, 1, 1, 3)


def _save_images(images):
    import os
    import numpy as np
    from PIL import Image
    import folder_paths

    out_dir = folder_paths.get_temp_directory()
    height = int(images.shape[1])
    width = int(images.shape[2])
    full, fn, counter, sub, _ = folder_paths.get_save_image_path("darkil_showany", out_dir, width, height)

    results = []
    total = min(int(images.shape[0]), MAX_IMAGES)
    for idx in range(total):
        arr = np.clip(255.0 * images[idx].cpu().numpy(), 0, 255).astype(np.uint8)
        if arr.shape[-1] == 1:
            arr = arr[..., 0]
        img = Image.fromarray(arr)
        file = f"{fn}_{counter + idx:05}_.png"
        img.save(os.path.join(full, file), compress_level=1)
        results.append({"filename": file, "subfolder": sub, "type": "temp"})
    return results


def _save_audio(audio):
    import os
    import wave
    import numpy as np
    import folder_paths

    sample_rate = int(audio["sample_rate"])
    wf = audio["waveform"].cpu().numpy()
    if wf.ndim == 2:
        wf = wf[None, ...]

    out_dir = folder_paths.get_temp_directory()
    full, fn, counter, sub, _ = folder_paths.get_save_image_path("darkil_showany", out_dir)

    results = []
    total = min(int(wf.shape[0]), MAX_IMAGES)
    for idx in range(total):
        data = np.clip(wf[idx], -1.0, 1.0)
        pcm = (data * 32767.0).astype("<i2")
        interleaved = pcm.T.reshape(-1)
        file = f"{fn}_{counter + idx:05}_.wav"
        with wave.open(os.path.join(full, file), "wb") as w:
            w.setnchannels(int(data.shape[0]))
            w.setsampwidth(2)
            w.setframerate(sample_rate)
            w.writeframes(interleaved.tobytes())
        results.append({"filename": file, "subfolder": sub, "type": "temp"})
    return results


def _save_video(video):
    import os
    import folder_paths

    out_dir = folder_paths.get_temp_directory()
    try:
        width, height = video.get_dimensions()
    except Exception:
        width, height = 0, 0
    full, fn, counter, sub, _ = folder_paths.get_save_image_path("darkil_showany", out_dir, width, height)
    file = f"{fn}_{counter:05}_.mp4"
    video.save_to(os.path.join(full, file))
    return [{"filename": file, "subfolder": sub, "type": "temp"}]


class ShowAny:

    DEFAULT_NODE_NAME = "ShowAny"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "source": (IO.ANY, {}),
            },
            "hidden": {
                "view_mode": ("STRING", {"default": "auto"}),
            },
        }

    RETURN_TYPES = (IO.ANY,)
    RETURN_NAMES = ("value",)
    FUNCTION = "show"
    CATEGORY = "darkilNodes/logic"
    OUTPUT_NODE = True

    HELP_TEXT = """Show Any previews whatever is connected, rendered by its runtime type:
text/number as copyable text, JSON as a formatted view, booleans as a check/cross,
images/audio/video as inline players, and number lists as an equalizer chart.
It also passes the value through unchanged on the `value` output."""

    @classmethod
    def VALIDATE_INPUTS(cls, *args, **kwargs):
        return True

    def show(self, source=None, view_mode="auto", **kwargs):
        ui = {}
        kind = _detect(source)
        payload = {"kind": kind}

        if kind == "empty":
            payload = {"kind": "text", "text": ""}
        elif kind == "boolean":
            payload["value"] = bool(source)
        elif kind == "number":
            payload["value"] = source
            payload["text"] = repr(source)
        elif kind == "string":
            payload["json_ok"] = _json_ok(source)
            num = _numeric_from_json(source)
            if num:
                payload[num[0]] = num[1]
            if len(source) > MAX_TEXT:
                payload["text"] = source[:MAX_TEXT]
                payload["truncated"] = True
            else:
                payload["text"] = source
        elif kind in ("json", "listjson"):
            payload = {"kind": "json", "text": _pretty_json(list(source) if kind == "listjson" else source)}
        elif kind == "numlist":
            payload = {"kind": "numlist", "values": [float(x) for x in list(source)[:MAX_POINTS]]}
            if len(source) > MAX_POINTS:
                payload["truncated"] = True
        elif kind == "numlists":
            payload = {"kind": "numlists", "series": [[float(y) for y in row] for row in list(source)[:MAX_SERIES]]}
            if len(source) > MAX_SERIES:
                payload["truncated"] = True
        elif kind == "latent":
            payload = {"kind": "text", "text": _latent_summary(source)}
        elif kind in ("image", "mask"):
            try:
                imgs = source if kind == "image" else _mask_to_image(source)
                payload = {"kind": "image", "images": _save_images(imgs)}
                if kind == "image" and int(source.shape[0]) > MAX_IMAGES:
                    payload["truncated"] = True
            except Exception as e:
                log.warning(f"[darkilNodes.ShowAny] image preview failed: {e}")
                payload = {"kind": "text", "text": _tensor_summary(source)}
        elif kind == "audio":
            try:
                payload = {"kind": "audio", "audio": _save_audio(source)}
            except Exception as e:
                log.warning(f"[darkilNodes.ShowAny] audio preview failed: {e}")
                payload = {"kind": "text", "text": _audio_summary(source)}
        elif kind == "video":
            try:
                payload = {"kind": "video", "video": _save_video(source)}
            except Exception as e:
                log.warning(f"[darkilNodes.ShowAny] video preview failed: {e}")
                payload = {"kind": "text", "text": "VIDEO"}
        else:
            payload = {"kind": "text", "text": _safe_repr(source)}

        ui["darkil_show"] = (json.dumps(payload, ensure_ascii=False, default=str),)
        return {"ui": ui, "result": (source,)}
