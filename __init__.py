from .nodes.text.variable_builder import (
    TextVariableBuilder,
)
from .nodes.text.advanced_variable_builder import (
    AdvancedVariableBuilder,
)
from .nodes.text.prompt_builder import (
    SimplePromptBuilder,
)


NODE_CLASS_MAPPINGS = {
    # TEXTS
    "darkilTextVariableBuilder": TextVariableBuilder,
    "darkilAdvancedVariableBuilder": AdvancedVariableBuilder,
    "darkilPromptBuilder": SimplePromptBuilder,
}


NODE_DISPLAY_NAME_MAPPINGS = {
    # TEXTS
    "darkilTextVariableBuilder": "Variable builder [darkilNodes]",
    "darkilAdvancedVariableBuilder": "Advanced variable builder [darkilNodes]",
    "darkilPromptBuilder": "Building dynamic prompt [darkilNodes]",
}


WEB_DIRECTORY = "./web/js"


__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
