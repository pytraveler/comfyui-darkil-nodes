import json
import logging
from pathlib import Path

from server import PromptServer  # comfy imports


DEFAULT_NODE_NAME_PREFIX = "darkil"
DEFAULT_CLASS_NAME_ATTRIBUTE_NAME = "DEFAULT_NODE_NAME"
DEFAULT_NODE_DEFS_FILE = "nodeDefs.json"


log = logging.getLogger(__name__)


def class_name_to_node_name(klass):
    
    if not klass:
        raise ValueError("[darkilNodes.class_name_to_node_name] Expected class or class name!")
    
    def _get_name(_part_name: str):
        return f"{DEFAULT_NODE_NAME_PREFIX}{_part_name}"
    
    if isinstance(klass, str):
        return _get_name(klass)
    
    try:
        class_name = getattr(
            klass, 
            DEFAULT_CLASS_NAME_ATTRIBUTE_NAME, 
            klass.__name__
        )
        if not class_name:
            log.error(f"[darkilNodes.class_name_to_node_name] Could not resolve class name: {e}")
            class_name = "Object"
        return _get_name(class_name)
    except AttributeError:
        try:
            return _get_name(type(klass).__name__)
        except Exception as e:
            log.error(f"[darkilNodes.class_name_to_node_name] Could not resolve class name: {e}")
            return _get_name("Unknown")


def load_localized_translation(node_class: str, translate_key: str, locale_str: str = None, default: str = None) -> str:
    if default is None:
        default = ""
        
    if not node_class or not isinstance(node_class, str) or not node_class.strip():
        log.error("[darkilNodes.load_localized_translation] The 'node_class' must be a string and must not be empty!")
        return default
    
    if locale_str is None:
        locale_str = "en"

    locale_dir = Path(__file__).parent.parent / "locales" / locale_str
    help_path = locale_dir / DEFAULT_NODE_DEFS_FILE
    
    if not help_path.is_file():
        log.error(f"[darkilNodes.load_localized_translation] '{help_path.absolute()}' is not a file!")
        return default
    
    try:
        with help_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get(node_class, {}).get(
            translate_key, default
        )
    except Exception as e:
        log.error(f"[darkilNodes.load_localized_translation] Error loading the {translate_key} locale: {e}")
        return default


def load_localized_help_text(node_class: str, default: str = None, locale_str: str = None):
    return load_localized_translation(node_class, "HELP_TEXT", locale_str=locale_str, default=default)
