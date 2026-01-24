import html
import re
import string
import textwrap


def directive_spaceless(text: str) -> str:
    """Collapse whitespace and strip ends."""
    return re.sub(r'\s+', ' ', text).strip()

def directive_lower(text: str) -> str:
    return text.lower()

def directive_upper(text: str) -> str:
    return text.upper()

def directive_title(text: str) -> str:
    return text.title()

def sentence_case(s: str) -> str:
    """Capitalize the first character of each sentence."""
    s = s.strip()
    if not s:
        return s
    # Ensure the very first character is uppercase
    s = s[0].upper() + s[1:]

    def cap(match):
        return match.group(1) + match.group(2).upper()

    return re.sub(r'([.!?]\s+)(\w)', cap, s)

def directive_sentence(text: str) -> str:
    return sentence_case(text)

def directive_trim(text: str) -> str:
    return text.strip()

def directive_dedent(text: str) -> str:
    return textwrap.dedent(text)

def directive_collapse_newlines(text: str) -> str:
    return re.sub(r'\n{2,}', '\n', text)

def directive_strip_punct(text: str) -> str:
    punct_re = re.compile('[' + re.escape(string.punctuation) + ']')
    return punct_re.sub('', text)

def directive_unescape_html(text: str) -> str:
    return html.unescape(text)

def directive_list(text: str) -> str:
    lines = [ln.lstrip() for ln in text.splitlines()]
    non_empty = [ln for ln in lines if ln]
    return "\n".join(non_empty)
    
def directive_list_right(text: str) -> str:
    lines = [ln.strip() for ln in text.splitlines()]
    non_empty = [ln for ln in lines if ln]
    return "\n".join(non_empty)

def directive_list_and(text: str) -> str:
    lines = [ln.strip() for ln in text.splitlines()]
    non_empty = [ln for ln in lines if ln]
    if non_empty:
        last_word = non_empty.pop()
    else:
        last_word = ""
    result = ", ".join(non_empty)
    if not result:
        result = last_word
    else:
        result = f"{result} and {last_word}"
    return result.strip()
