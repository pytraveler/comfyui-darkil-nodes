"""MiniMax H3 Multi Keyframe.

The stock MiniMaxH3ImageToVideo node anchors two keyframes: pixel frame 0 and
pixel frame frame_count - 1. The rest of the path is already written for a list
of any length - the conditioning carries a list, model_base turns it into a
list of cond latents, and the DiT lays out one cond segment per entry - but the
packed layout refuses any other anchor:

    comfy/ldm/minimax/model.py, PackedLayout.__init__
    raise ValueError("only first/last keyframe anchors are supported")

The temporal RoPE coordinate of a cond row is linear in the pixel frame index,
at FRAME_RESCALE = 5/3 units per frame (40 Hz RoPE over 24 fps video):

    cond_t = target_video_origin + FRAME_RESCALE * pixel_index

That single expression reproduces both stock cases exactly: index 0 gives the
origin, and index frame_count - 1 gives origin + sum(video t spans) -
FRAME_RESCALE, which is the expression the stock code uses for the last frame
(the sum of the video spans is exactly FRAME_RESCALE * frame_count).

So this node builds the keyframe list with real frame indices and returns a
model that installs a marker-gated PackedLayout patch for the duration of one
sampling run. Keyframes without the marker are handed to the stock code
untouched, and the patch is removed again in a finally block, so nothing stays
patched process wide. The model output has to be wired into the sampler; if it
is not, the stock ValueError above fires and the run stops instead of quietly
stacking every keyframe on frame 0.

Anchors between the first and the last frame are outside what H3 was trained on
(the model ships t2va / i2va / fl2va / ref2va), so treat the middle frames as an
experiment: keyframe_noise_aug is the knob that softens an anchor the model
fights against.
"""

import contextlib
import logging
from typing import Any, Dict, List, Tuple

import torch

import comfy.model_management
import comfy.nested_tensor
import comfy.patcher_extension
import comfy.utils
import node_helpers
import nodes


log = logging.getLogger(__name__)


FRAME_INDEX_KEY = "darkil_h3_frame_index"
PATCH_MARKER = "_darkil_h3_multi_keyframe_layout_patch"
WRAPPER_KEY = "darkil_h3_multi_keyframe"

FPS = 24
AUDIO_LATENT_FPS = 40
VAE_DOWNSCALE = 16
VIDEO_LATENT_CHANNELS = 24
AUDIO_LATENT_CHANNELS = 32
AUDIO_LATENT_CHANNELS_PER_FRAME = 2


def _minimax_model_module():
    try:
        import comfy.ldm.minimax.model as module
    except Exception as e:
        raise RuntimeError(
            "[darkilNodes.MiniMaxH3MultiKeyframe] this ComfyUI has no MiniMax H3 support "
            "(comfy.ldm.minimax.model could not be imported): %s" % e
        )
    return module


def _temporal_shape(length: int) -> Tuple[int, int, int]:
    """Frame count, video latent length, audio latent length.

    Uses the core helper when it is available so the 17k+5 frame grid stays in
    one place; the fallback mirrors comfy_extras/nodes_minimax_h3.py.
    """
    try:
        from comfy_extras import nodes_minimax_h3 as core

        return core.temporal_shape(length)
    except Exception:
        pass

    frame_count = max(5, int(length))
    while frame_count % 17 != 5:
        frame_count += 1
    latent_t = 2 if frame_count <= 5 else ((frame_count - 5) // 17) * 5 + 2
    return frame_count, latent_t, round(frame_count / FPS * AUDIO_LATENT_FPS)


def _empty_av_latent(width: int, height: int, length: int):
    frame_count, latent_t, audio_t = _temporal_shape(length)
    device = comfy.model_management.intermediate_device()
    video = torch.zeros(
        [1, VIDEO_LATENT_CHANNELS, latent_t, height // VAE_DOWNSCALE, width // VAE_DOWNSCALE],
        device=device,
    )
    audio = torch.zeros(
        [1, AUDIO_LATENT_CHANNELS, AUDIO_LATENT_CHANNELS_PER_FRAME, audio_t],
        device=device,
    )
    return {"samples": comfy.nested_tensor.NestedTensor((video, audio))}, frame_count


def _resize(image, width: int, height: int, crop: str):
    samples = image[..., :3].movedim(-1, 1)
    samples = comfy.utils.common_upscale(samples, width, height, "lanczos", crop)
    return samples.movedim(1, -1)


def _clamp_middle(index: int, frame_count: int) -> int:
    return max(1, min(int(index), frame_count - 2))


def _parse_positions(text: str, count: int, units: str, frame_count: int) -> List[int]:
    """Middle frame anchors, as pixel frame indices on the snapped timeline."""
    if count <= 0:
        return []

    chunks = [c.strip() for c in (text or "").replace(";", ",").split(",")]
    chunks = [c for c in chunks if c]

    if not chunks:
        return [_clamp_middle(round(frame_count * (i + 1) / (count + 1)), frame_count)
                for i in range(count)]

    if len(chunks) < count:
        raise ValueError(
            "[darkilNodes.MiniMaxH3MultiKeyframe] middle_positions holds %d value(s) "
            "for %d middle frame(s). Give one value per frame, or leave the field "
            "empty for even spacing." % (len(chunks), count)
        )
    if len(chunks) > count:
        log.warning(
            "[darkilNodes.MiniMaxH3MultiKeyframe] middle_positions holds %d value(s) "
            "for %d middle frame(s), the extra ones are ignored", len(chunks), count
        )
        chunks = chunks[:count]

    positions = []
    for chunk in chunks:
        try:
            value = float(chunk)
        except ValueError:
            raise ValueError(
                "[darkilNodes.MiniMaxH3MultiKeyframe] could not read the position %r, "
                "expected a number" % chunk
            )
        if units == "ratio":
            if not 0.0 <= value <= 1.0:
                raise ValueError(
                    "[darkilNodes.MiniMaxH3MultiKeyframe] ratio positions run from 0.0 "
                    "to 1.0, got %s" % chunk
                )
            index = round(value * (frame_count - 1))
        else:
            index = int(round(value))
        positions.append(_clamp_middle(index, frame_count))
    return positions


def _target_video_origin(layout) -> float:
    """t coordinate of the first row of the target video segment."""
    start, stop, kind = layout.segments[-1]
    if kind != "video" or stop <= start:
        raise RuntimeError(
            "[darkilNodes.MiniMaxH3MultiKeyframe] expected the target video as the last "
            "packed layout segment, got %r" % (kind,)
        )
    return float(layout.position_ids[start, 0])


def _build_patched_init(module, original):
    def patched_init(self, text_len, latent_t, latent_h, latent_w, audio_t,
                     keyframes=None, refs=None, frame_count=None):
        marked = bool(keyframes) and any(kf.get(FRAME_INDEX_KEY) is not None for kf in keyframes)
        if not marked:
            return original(self, text_len, latent_t, latent_h, latent_w, audio_t,
                            keyframes=keyframes, refs=refs, frame_count=frame_count)

        safe = []
        for kf in keyframes:
            if kf.get(FRAME_INDEX_KEY) is None:
                safe.append(kf)
            else:
                safe.append(dict(kf, resolved_frame_index=0))

        original(self, text_len, latent_t, latent_h, latent_w, audio_t,
                 keyframes=safe, refs=refs, frame_count=frame_count)

        cond_spans = [(a, b) for a, b, kind in self.segments if kind == "cond"]
        if len(cond_spans) != len(keyframes):
            raise RuntimeError(
                "[darkilNodes.MiniMaxH3MultiKeyframe] the layout built %d cond segment(s) "
                "for %d keyframe(s)" % (len(cond_spans), len(keyframes))
            )

        origin = _target_video_origin(self)
        for (start, stop), kf in zip(cond_spans, keyframes):
            index = kf.get(FRAME_INDEX_KEY)
            if index is None:
                continue
            wanted = origin + module.FRAME_RESCALE * float(index)
            self.position_ids[start:stop, 0] += wanted - float(self.position_ids[start, 0])

    setattr(patched_init, PATCH_MARKER, True)
    return patched_init


@contextlib.contextmanager
def _packed_layout_patch():
    """Marker-gated PackedLayout patch, alive for one sampling run."""
    module = _minimax_model_module()
    original = module.PackedLayout.__init__

    if getattr(original, PATCH_MARKER, False):
        yield
        return

    module.PackedLayout.__init__ = _build_patched_init(module, original)
    try:
        yield
    finally:
        module.PackedLayout.__init__ = original


def _outer_sample_wrapper(executor, *args, **kwargs):
    with _packed_layout_patch():
        return executor(*args, **kwargs)


class MiniMaxH3MultiKeyframe:

    DEFAULT_NODE_NAME = "MiniMaxH3MultiKeyframe"

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "model": ("MODEL", {"tooltip": "H3 diffusion model. The returned model carries the layout patch and has to reach the sampler"}),
                "clip": ("CLIP",),
                "vae": ("VAE",),
                "prompt": ("STRING", {"multiline": True, "dynamicPrompts": True}),
                "width": ("INT", {"default": 1344, "min": 32, "max": nodes.MAX_RESOLUTION, "step": 32}),
                "height": ("INT", {"default": 768, "min": 32, "max": nodes.MAX_RESOLUTION, "step": 32}),
                "length": ("INT", {"default": 124, "min": 5, "max": 3600, "step": 17, "tooltip": "Frame count at 24 fps, snapped up to the model's 17k+5 grid (124 = ~5s, trained range is ~124-362)"}),
                "middle_positions": ("STRING", {"default": "", "tooltip": "One position per image in middle_frames, comma separated. Empty spreads them evenly between the first and the last frame"}),
                "position_units": (["ratio", "frames"], {"default": "ratio", "tooltip": "ratio: 0.0-1.0 of the clip. frames: absolute frame index on the snapped timeline"}),
                "middle_fit": (["cover", "stretch"], {"default": "cover", "tooltip": "How a middle frame is fitted to the canvas. cover keeps the aspect and crops, like the stock last_frame"}),
                "keyframe_noise_aug": ("FLOAT", {"default": 0.999, "min": 0.0, "max": 1.0, "step": 0.001, "tooltip": "Condition strength for every keyframe row. 0.999 is the stock value, lower values blend noise into the anchors and let the model deviate from them"}),
            },
            "optional": {
                "first_frame": ("IMAGE",),
                "last_frame": ("IMAGE",),
                "middle_frames": ("IMAGE", {"tooltip": "Batch of images anchored between the first and the last frame, one anchor per image"}),
            },
        }

    RETURN_TYPES = ("CONDITIONING", "LATENT", "MODEL")
    RETURN_NAMES = ("positive", "latent", "model")
    FUNCTION = "build"
    CATEGORY = "darkilNodes/minimax"
    OUTPUT_NODE = False

    HELP_TEXT = """MiniMax H3 Multi Keyframe:
Drop-in replacement for 'MiniMax H3 Image to Video' that anchors keyframes
anywhere on the timeline, not only at the first and the last frame.

Wiring: clip, vae and model come from the same places as for the stock node,
and the 'model' output MUST reach the sampler (guider and scheduler). The
layout patch that places the extra anchors rides on that model and only lives
for the duration of one sampling run. Without it the run stops with the stock
error 'only first/last keyframe anchors are supported'.

middle_frames takes a batch of images: one anchor per image. middle_positions
holds one value per image ('0.33, 0.66'), or stays empty for even spacing.
position_units picks between a 0.0-1.0 ratio and absolute frame indices.
Anchors are clamped to the interior of the clip, and the frame count is snapped
up to the model's 17k+5 grid first.

Every anchor is presented to the text encoder as '<Picture N>' in temporal
order, so the first picture is the earliest frame.

Caveat: H3 was trained with first and last anchors (fl2va). A middle anchor is
outside that distribution - it may be ignored, or show as a cut around the
anchor. keyframe_noise_aug below 0.999 softens every anchor and is the first
knob to try when the model fights the middle frames. Each extra anchor also
adds one cond segment to the packed sequence, about 1000 rows at 1344x768."""

    def build(self, model, clip, vae, prompt, width, height, length,
              middle_positions="", position_units="ratio", middle_fit="cover",
              keyframe_noise_aug=0.999, first_frame=None, last_frame=None,
              middle_frames=None, **kwargs) -> Tuple[Any, Any, Any]:

        _minimax_model_module()

        latent, frame_count = _empty_av_latent(width, height, length)

        entries = []
        if first_frame is not None:
            entries.append((0, first_frame[:1], "disabled"))
        if last_frame is not None:
            entries.append((frame_count - 1, last_frame[:1], "center"))
        if middle_frames is not None and middle_frames.shape[0] > 0:
            crop = "center" if middle_fit == "cover" else "disabled"
            count = int(middle_frames.shape[0])
            positions = _parse_positions(middle_positions, count, position_units, frame_count)
            for i, index in enumerate(positions):
                entries.append((index, middle_frames[i:i + 1], crop))

        if not entries:
            raise ValueError(
                "[darkilNodes.MiniMaxH3MultiKeyframe] connect at least one keyframe "
                "(first_frame, last_frame or middle_frames)"
            )

        entries.sort(key=lambda entry: entry[0])
        ordered = []
        for entry in entries:
            if ordered and ordered[-1][0] == entry[0]:
                log.warning(
                    "[darkilNodes.MiniMaxH3MultiKeyframe] two keyframes land on frame %d, "
                    "keeping the first one", entry[0]
                )
                continue
            ordered.append(entry)

        images = []
        keyframes = []
        for index, image, crop in ordered:
            resized = _resize(image, width, height, crop)
            images.append(resized)
            keyframes.append({
                "resolved_frame_index": index,
                FRAME_INDEX_KEY: index,
                "image": resized,
            })

        tokens = clip.tokenize(prompt, images=images)
        cond = clip.encode_from_tokens_scheduled(tokens)

        for kf in keyframes:
            kf["latent"] = vae.encode(kf.pop("image"))

        cond = node_helpers.conditioning_set_values(cond, {
            "minimax_keyframes": keyframes,
            "minimax_frame_count": frame_count,
            "minimax_visual_cond_noise_aug": float(keyframe_noise_aug),
        })

        patched_model = model.clone()
        patched_model.remove_wrappers_with_key(
            comfy.patcher_extension.WrappersMP.OUTER_SAMPLE, WRAPPER_KEY
        )
        patched_model.add_wrapper_with_key(
            comfy.patcher_extension.WrappersMP.OUTER_SAMPLE, WRAPPER_KEY, _outer_sample_wrapper
        )

        log.info(
            "[darkilNodes.MiniMaxH3MultiKeyframe] %d keyframe(s) at frames %s of %d",
            len(keyframes), [index for index, _, _ in ordered], frame_count
        )

        return (cond, latent, patched_model)
