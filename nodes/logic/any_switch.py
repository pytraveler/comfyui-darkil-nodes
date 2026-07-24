import json
import logging
from typing import Any, Dict, List, Tuple

from comfy.comfy_types.node_typing import IO


log = logging.getLogger(__name__)


class AnySwitch:

    DEFAULT_NODE_NAME = "AnySwitch"

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {},
            "optional": {
                "any_1": (IO.ANY,),
            },
            "hidden": {
                "enabled_mask": ("STRING", {"default": "{}"}),
                "COMFY_LOCALE_SETTING": ("STRING", {})
            },
        }

    RETURN_TYPES = (IO.ANY,)
    RETURN_NAMES = ("value",)
    FUNCTION = "switch"
    CATEGORY = "darkilNodes/logic"
    OUTPUT_NODE = False

    HELP_TEXT = """Any Switch outputs the first input that is both connected and enabled.

Connect any number of inputs (any_1, any_2, ...); a new slot appears once the
last one is filled. Each input has a checkbox in the right column: uncheck it to
skip that input without disconnecting the upstream node.

Inputs are scanned top to bottom and the first enabled + connected one is passed
through. If none qualifies the node outputs nothing (None) instead of raising."""

    @classmethod
    def VALIDATE_INPUTS(cls, *args, **kwargs) -> bool:
        return True

    def _parse_mask(self, enabled_mask: str) -> Dict[str, bool]:
        try:
            mask = json.loads(enabled_mask) if enabled_mask else {}
        except Exception as e:
            log.warning(f"[darkilNodes.AnySwitch] enabled_mask parse error: {e}")
            mask = {}
        return mask if isinstance(mask, dict) else {}

    def switch(self, enabled_mask: str = "{}", **kwargs) -> Tuple[Any]:
        mask = self._parse_mask(enabled_mask)

        candidates: List[Tuple[int, str, Any]] = []
        for name, value in kwargs.items():
            if not name.startswith("any_"):
                continue
            suffix = name[len("any_"):]
            try:
                order = int(suffix)
            except ValueError:
                order = 0
            candidates.append((order, suffix, value))

        candidates.sort(key=lambda item: item[0])

        for _order, suffix, value in candidates:
            if value is None:
                continue
            if not mask.get(suffix, True):
                continue
            return (value,)

        return (None,)
