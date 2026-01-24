from typing import Any, Dict, Tuple

from .utilities import is_empty_text


class TextIsEmpty:
    
    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "text": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("BOOLEAN",)     
    FUNCTION = "empty_text_compare"         
    CATEGORY = "darkilNodes/text"
    OUTPUT_NODE = False              

    def empty_text_compare(self, text) -> Tuple[bool]:
        return (is_empty_text(text),)


class TextNotEmpty:
    
    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "text": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("BOOLEAN",)     
    FUNCTION = "empty_text_compare"         
    CATEGORY = "darkilNodes/text"
    OUTPUT_NODE = False              

    def empty_text_compare(self, text) -> Tuple[bool]:
        return (not is_empty_text(text),)


class TextLinesCount:
    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "text": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("INT",)
    FUNCTION = "count_lines"
    CATEGORY = "darkilNodes/text"
    OUTPUT_NODE = False

    def count_lines(self, text: str) -> Tuple[int]:
        return (len(text.splitlines()),)
