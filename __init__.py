from .nodes.text.variable_builder import (
    TextVariableBuilder,
)


NODE_CLASS_MAPPINGS = {
    # TEXTS
    "TextVariableBuilder": TextVariableBuilder,
}


NODE_DISPLAY_NAME_MAPPINGS = {
    # TEXTS
    "TextVariableBuilder": "Text variable builder [darkilNodes]",
}


WEB_DIRECTORY = "./web/js"


__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
