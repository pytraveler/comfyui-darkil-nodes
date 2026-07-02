import logging
from typing import Any, Dict, Tuple

from .rebalance_core import scale_conditioning, _parse_floats


log = logging.getLogger(__name__)


KREA2_TAP_LAYERS = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35]


class Krea2RebalanceEqualizer:

    DEFAULT_WEIGHTS = "1.0,1.0,1.0,1.0,1.0,1.0,1.0,2.5,5.0,1.1,4.0,1.0"

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "conditioning": ("CONDITIONING",),
                "multiplier": ("FLOAT", {"default": 4.0, "min": -1000000000.0, "max": 1000000000.0, "step": 0.01, "tooltip": "Global scale applied to the whole conditioning"}),
            },
            "hidden": {
                "per_layer_weights": ("STRING", {"default": cls.DEFAULT_WEIGHTS}),
            },
        }

    RETURN_TYPES = ("CONDITIONING",)
    RETURN_NAMES = ("conditioning",)
    FUNCTION = "main"
    CATEGORY = "darkilNodes/conditioning"
    OUTPUT_NODE = False

    HELP_TEXT = """Krea2 Rebalance Equalizer:
Per-layer conditioning scaler for the Krea 2 (Qwen3-VL-4B, 12-layer tap) layout.

Each equalizer fader sets the gain for one model tap layer
(layers 2,5,8,11,14,17,20,23,26,29,32,35). The 12 fader values are applied to
the matching slices of the conditioning tensor, then the whole result is scaled
by `multiplier`. A negative fader inverts that layer's contribution.

Adapted from ComfyUI-Conditioning-Rebalance (ConditioningKrea2Rebalance)."""

    def main(self, conditioning, multiplier, per_layer_weights=None, **kwargs) -> Tuple[Any]:
        plw = _parse_floats(per_layer_weights) if per_layer_weights else None
        c = scale_conditioning(conditioning, multiplier, weights=plw)
        return (c,)
