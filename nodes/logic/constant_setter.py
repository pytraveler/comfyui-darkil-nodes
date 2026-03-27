from typing import Dict, Any, Union
import json
import logging
import math

log = logging.getLogger(__name__)


def _get_precision_from_type(const_type: str) -> int:
    """Extract precision from type string (e.g., FLOAT3 -> 3, SLIDER2 -> 2)."""
    const_type = const_type.upper()
    if len(const_type) > 1:
        last_char = const_type[-1]
        if last_char.isdigit():
            return int(last_char)
    return None


class ConstantSetter:

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {},
            "hidden": {
                "nodeProperties": ("STRING", {"default": "{}"}),
                "COMFY_LOCALE_SETTING": ("STRING", {})
            },
        }

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("value",)
    FUNCTION = "get_value"
    CATEGORY = "darkilNodes/logic"
    DEFAULT_NODE_NAME = "ConstantSetter"

    def _get_property(self, key: str, default: Any = None, properties: Dict[str, Any] = None) -> Any:
        """Get property value with default fallback."""
        if properties is None:
            properties = {}
        return properties.get(key, default)

    def _convert_to_type(self, value: Any, const_type: str, minimum: float, maximum: float, values_str: str) -> Any:
        """Convert value to the specified type."""
        const_type = const_type.upper() if const_type else "STRING"
        
        # Get precision from type suffix (e.g., FLOAT3 -> 3, SLIDER2 -> 2)
        precision = _get_precision_from_type(const_type)

        try:
            if const_type == "STRING":
                return str(value) if value is not None else ""

            elif const_type in ("INT", "INTEGER"):
                # Use math.floor for proper truncation (not rounding)
                if isinstance(value, (int, float)):
                    result = math.floor(value)
                else:
                    result = math.floor(float(str(value)))
                return result

            elif const_type.startswith("SLIDER") or const_type.startswith("KNOB"):
                # For slider/knob types with precision
                if isinstance(value, (int, float)):
                    raw_value = float(value)
                else:
                    raw_value = float(str(value))
                
                # Apply range constraints first
                result = max(minimum, min(maximum, raw_value))
                
                # Then apply precision-based rounding
                if precision is not None and precision > 0:
                    factor = 10 ** precision
                    result = round(result * factor) / factor
                else:
                    # Base SLIDER/KNOB - convert to int with floor
                    result = math.floor(result)
                return result

            elif const_type in ("FLOAT", "REAL") or const_type.startswith(("FLOAT", "REAL")):
                # FLOAT/REAL with optional precision suffix
                if isinstance(value, (int, float)):
                    raw_value = float(value)
                else:
                    raw_value = float(str(value))
                
                if precision is not None and precision > 0:
                    # Round to specified decimal places
                    result = round(raw_value, precision)
                else:
                    result = raw_value
                return result

            elif const_type == "BOOLEAN":
                if isinstance(value, bool):
                    return value
                if isinstance(value, str):
                    lower_val = value.lower().strip()
                    if lower_val in ("true", "1", "yes", "on"):
                        return True
                    elif lower_val in ("false", "0", "no", "off"):
                        return False
                return bool(value)

            elif const_type == "COMBO":
                # Parse values from semicolon-separated string
                available_values = [v.strip() for v in values_str.split(";") if v.strip()]
                if available_values and value in available_values:
                    return value
                elif available_values:
                    return available_values[0]
                return str(value) if value is not None else ""

            else:
                log.warning(f"[ConstantSetter] Unknown type: {const_type}, returning as STRING")
                return str(value) if value is not None else ""

        except (ValueError, TypeError) as e:
            log.warning(f"[ConstantSetter] Conversion error for type {const_type}: {e}")
            raise

    def get_value(self, var_to_convert: Any = None, nodeProperties: str = None, **kwargs) -> tuple:
        """
        Get constant value based on node properties.
        
        Args:
            input_value: Optional input from node's input slot
            nodeProperties: JSON string with node properties from frontend
            **kwargs: Additional arguments including COMFY_LOCALE_SETTING
            
        Returns:
            Tuple with single value element
        """
        # Parse node properties from JSON
        if nodeProperties is None:
            nodeProperties = "{}"
        
        try:
            properties = json.loads(nodeProperties)
        except Exception as e:
            log.warning(f"[ConstantSetter] Failed to parse nodeProperties: {e}")
            properties = {}

        # Get properties from parsed dict or use defaults
        const_type = self._get_property("const_type", "STRING", properties)
        minimum = float(self._get_property("minimum", 0, properties))
        maximum = float(self._get_property("maximum", 100, properties))
        values_str = self._get_property("values", "", properties)
        input_enable = bool(self._get_property("input_enable", False, properties))

        # Parse default_value from properties - could be any JSON-serializable type
        raw_default = self._get_property("default_value", "", properties)
        
        # Determine the actual default value based on type
        try:
            const_upper = const_type.upper()
            precision = _get_precision_from_type(const_upper)
            
            if const_upper in ("INT", "INTEGER"):
                default_value = int(raw_default) if raw_default not in (None, "") else 0
            elif const_upper.startswith("SLIDER") or const_upper.startswith("KNOB"):
                # Slider/Knob - use float for precision variants, int for base
                if precision is not None and precision > 0:
                    default_value = float(raw_default) if raw_default not in (None, "") else 0.0
                else:
                    default_value = int(raw_default) if raw_default not in (None, "") else 0
            elif const_upper in ("FLOAT", "REAL") or const_upper.startswith(("FLOAT", "REAL")):
                default_value = float(raw_default) if raw_default not in (None, "") else 0.0
            elif const_type.upper() == "BOOLEAN":
                default_value = bool(raw_default) if raw_default not in (None, "", "false", "true") else False
            else:
                default_value = str(raw_default) if raw_default is not None else ""
        except (ValueError, TypeError):
            default_value = ""

        # If input is enabled and we have a value, try to convert it        
        if input_enable and var_to_convert is not None:
            try:
                result = self._convert_to_type(var_to_convert, const_type, minimum, maximum, values_str)
                return (result,)
            except Exception as e:
                log.warning(f"[ConstantSetter] Failed to convert input value '{var_to_convert}' to {const_type}: {e}")
                return (default_value,)

        # No input or input disabled - use the configured constant value from properties
        try:
            # The actual constant value should be stored in node's widget values
            # For now, we'll use the default_value as the constant
            constant_value = kwargs.get("default_value", self._get_property("constant_value", default_value, properties))
            
            # Try to convert the constant value to proper type
            result = self._convert_to_type(constant_value, const_type, minimum, maximum, values_str)
            return (result,)
        except Exception as e:
            log.warning(f"[ConstantSetter] Error getting constant value: {e}")
            return (default_value,)
