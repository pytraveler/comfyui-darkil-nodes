
import os
import re
import logging
from typing import (
    Any, 
    Dict, 
    Iterable, 
    List, 
    Optional, 
    Tuple, 
)
from functools import partial
from itertools import compress

import folder_paths


log = logging.getLogger(__name__)


class Wan22VideoLoraListBuilder:

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "input_list": ("STRING", {"forceInput": True, "default": ""},),
                "default_lora_strength": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.05},),
            },
            "optional": {
                "prev_low": ("WANVIDLORA", {"default": None}),
                "prev_high": ("WANVIDLORA", {"default": None}),
                "blocks": ("SELECTEDBLOCKS", {"default": None}),
                "low_mem_load": ("BOOLEAN", {"default": False}),
                "merge_loras": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("WANVIDLORA", "WANVIDLORA", "STRING")
    RETURN_NAMES = ("lora_low", "lora_high", "❓help",)
    FUNCTION = "parse_loras"
    CATEGORY = "darkilNodes/lora"
    
    HELP_TEXT = """This node parses a textual list of LoRA definitions for WanVideoWrapper Nodes by Kijai and outputs two lists:
low-noise (LORA_LOW) and high-noise (LORA_HIGH).

**Input format**
- Provide a string (or list of strings) where each line defines one LoRA.
- Items can be separated by newlines, semicolons `;` or pipes `|`.
- Syntax: `<LoRA name>[:<strength>]`
    - `<LoRA name>` is a substring that matches a file in the ComfyUI `loras` folder.
    - Optional `<strength>` overrides the default strength (default from the node).

**Comments**
- Block comments `/* ... */` and line comments `// ...` are ignored.

**Low / High model targeting**
- Prefix an entry with any of the low triggers (`l<<`, `l<`, `<low:`, `low:`) to apply only to the low-noise model.
- Prefix with high triggers (`h<<`, `h<`, `<high:`, `high:`) for the high-noise model.
- No prefix → applies to both.

**Block selection**
- Pass a dictionary via the optional *blocks* input. Expected keys:
    - `selected_blocks` – mapping of block names to booleans.

**Additional flags**
- *low_mem_load*: if true, LoRAs will be loaded in low-memory mode.
- *merge_loras*: if true, multiple LoRAs will be merged into a single tensor when possible.

**Merging with previous lists**
- Provide previous low/high LoRA lists via `prev_low` / `prev_high`. The node will prepend these to the newly parsed items.

The third output is this help string for reference."""

    @staticmethod
    def _resolve_path(name: str) -> Optional[Tuple[str, str]]:
        candidates = folder_paths.get_filename_list("loras")
        for fn in candidates:
            if name in fn: 
                try:
                    full_path = folder_paths.get_full_path("loras", fn)
                    return full_path, fn
                except Exception as exc:
                    log.error(f"[darkilNodes.Wan22VideoLoraListBuilder] Invalid filename `{fn}`: {exc}")
        return None

    @staticmethod
    def _clean_comment(text: str) -> str:
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)          # /** ... */
        text = re.sub(r"//.*?(?=\n|$)", "", text)                  # //...
        return text.strip()

    def _parse_item(
        self,
        raw: str,
        default_strength: float,
        blocks_dict: Dict[str, Any],
        low_mem_load: bool,
        merge_loras: bool,
    ) -> Optional[Dict[str, Any]]:
        sstrip = partial(lambda _: _.strip(" \t<>"))
        if ":" in raw:
            name_part, strength_part = map(sstrip, raw.rsplit(":", 1))
            try:
                strength_val = round(float(strength_part), 4)
            except Exception:
                log.debug(
                    f"[darkilNodes.Wan22VideoLoraListBuilder] Bad lora strength `{strength_part}` – "
                    "default value using"
                )
                strength_val = default_strength
        else:
            name_part = raw.strip()
            strength_val = default_strength

        if not name_part:         
            return None

        if ":" in name_part:
            _, name_part = map(sstrip, name_part.rsplit(":", 1))
            
        if not name_part:          
            return None

        resolved = self._resolve_path(name_part)
        if resolved is None:
            log.error(f"[darkilNodes.Wan22VideoLoraListBuilder] LoRA `{name_part}` not found in `loras`.")
            return None

        full_path, filename = resolved

        meta: Dict[str, Any] = {
            "path": full_path,
            "strength": strength_val,
            "name": os.path.splitext(filename)[0],
            "blocks": blocks_dict.get("selected_blocks", {}),
            "layer_filter": blocks_dict.get("layer_filter", ""),
            "low_mem_load": low_mem_load,
            "merge_loras": merge_loras,
        }
        
        return meta

    def parse_loras(
        self,
        input_list,
        default_lora_strength: float,
        prev_low=None,
        prev_high=None,
        blocks=None,
        low_mem_load: bool = False,
        merge_loras: bool = True,
    **kwargs) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        if isinstance(input_list, str):
            cleaned = self._clean_comment(input_list)
            parts: List[str] = []
            for line in cleaned.split("\n"):
                for seg in line.split(";"):
                    parts.extend(seg.split("|"))
            raw_items = [p.strip() for p in parts if p.strip()]
        elif isinstance(input_list, (list, tuple)):
            raw_items = [str(i).strip() for i in input_list if str(i).strip()]
        else:
            log.warning(
                f"[darkilNodes.Wan22VideoLoraListBuilder] input_list type error {type(input_list)} – "
                "need STRING or list/tuple."
            )
            raw_items = []

        blocks_dict: Dict[str, Any] = blocks or {}

        low_res: List[Dict[str, Any]] = []
        high_res: List[Dict[str, Any]] = []

        for raw in raw_items:
            clean_raw = self._clean_comment(raw)

            if not clean_raw or clean_raw.startswith("#"):
                continue

            target_low = target_high = True      # lora to both models
            lower_clean_raw = clean_raw.lower().strip()
            low_lora_triggers = ["l<<", "l<", "<l:lora", "<l:", "<low:", "low:"]
            high_lora_triggers = ["h<<", "h<", "<h:lora", "<h:", "<high:", "high:"]
            raw_starts = partial(lower_clean_raw.startswith)
            low_found = [raw_starts(t) for t in low_lora_triggers]
            high_found = [raw_starts(t) for t in high_lora_triggers]
            if any(high_found):
                target_low = False
                clean_raw = clean_raw[len(list(compress(high_lora_triggers, high_found))[0]):].strip()   
            elif any(low_found):
                target_high = False
                clean_raw = clean_raw[len(list(compress(low_lora_triggers, low_found))[0]):].strip()

            meta = self._parse_item(
                raw=clean_raw,
                default_strength=default_lora_strength,
                blocks_dict=blocks_dict,
                low_mem_load=low_mem_load,
                merge_loras=merge_loras,
            )
            if meta is None:
                continue

            if target_low:
                low_res.append(meta)
            if target_high:
                high_res.append(meta)

        def _extend(prev: Optional[Iterable[Dict[str, Any]]], cur: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
            if prev is None:
                return cur
            if isinstance(prev, (list, tuple)):
                return list(prev) + cur
            log.warning("[darkilNodes.Wan22VideoLoraListBuilder] prev_* type error")
            return cur

        low_res = _extend(prev_low, low_res)
        high_res = _extend(prev_high, high_res)

        return (low_res, high_res, self.HELP_TEXT,)
