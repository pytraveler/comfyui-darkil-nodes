import random
import re
from typing import Dict, List, Tuple, Union


def split_input_lines(
    inp: Union[bool, str, int, float, List[Union[bool, str, int, float]]],
) -> List[str]:
    if isinstance(inp, str) and any(check for _ in ("\n", "\r") if (check := _ in inp)):
        return re.split(r"[ \t]*[\n\r]+[ \t]*", inp, re.I + re.M)

    if isinstance(inp, (str, int, float, bool)):
        return [str(inp).strip()] if inp is not None else []

    result: List[str] = []
    for i in inp:
        if i is None:
            continue
        result.append(str(i).strip())
    return result


def parse_input_lines(lines: List[str]) -> Tuple[Dict[str, str], str]:
    raw: Dict[str, str] = {}
    default_value = ""

    for line in lines:
        if not line:
            continue

        if "=" in line:
            name, val = line.split("=", 1)
            raw[name.strip()] = val.strip()
        else:
            default_value = line      # last non‑empty “default” line wins
    return raw, default_value


def choose_variant(value: str) -> str:
    parts = [p.strip() for p in value.split("|")]
    return random.choice(parts) if parts else ""


def evaluate_part_bool(part: str, raw_dict: Dict[str, str]) -> bool:
    if part.lower() in {"true", "false"}:
        return part.lower() == "true"
    val = raw_dict.get(part, "")
    chosen = choose_variant(val)
    return chosen.lower() not in {"", "0", "false", "none"}


def raw_as_bool(token: str,
                raw_dict: Dict[str, str],
                default_single_line: str | None = None) -> bool:
    lowered = token.lower().strip()

    if default_single_line and (not token or lowered in ["default", "def", "_"]):
        return default_single_line.lower() not in {"", "0", "false", "none"}

    if lowered in {"true", "false"}:
        return lowered == "true"

    if "&&" in token or "||" in token:
        if "&&" in token:
            parts = [part.strip() for part in token.split("&&")]
            return all(evaluate_part_bool(part, raw_dict) for part in parts)
        elif "||" in token:
            parts = [part.strip() for part in token.split("||")]
            return any(evaluate_part_bool(part, raw_dict) for part in parts)
        else:
            return False 

    val = raw_dict.get(token, "")
    chosen = choose_variant(val)
    return chosen.lower() not in {"", "0", "false", "none"}


def strip_quotes(token: str) -> Union[str, None]:
    token = token.strip()
    if len(token) >= 2 and token[0] == '"' and token[-1] == '"':
        return token[1:-1]
    return None


def remove_multiline_comments(text: str) -> str:
    return re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)


def remove_singleline_comments(text: str) -> str:
    cleaned_lines = []
    for line in text.splitlines():
        cleaned_lines.append(line.split("#", 1)[0])
    return "\n".join(cleaned_lines)


def strip_all_comments(text: str) -> str:
    no_ml = remove_multiline_comments(text)
    return remove_singleline_comments(no_ml)
