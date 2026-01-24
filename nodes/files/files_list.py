import logging
from pathlib import Path
from typing import List, Tuple, Dict, Any


log = logging.getLogger(__name__)


class FilesList:  
    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "folder_path": ("STRING", {"default": ""}),
                "files_extension": ("STRING", {"default": "*.*"}),  
                "sort_by": (
                    [
                        "by_date",
                        "by_date_desc",
                        "by_name",
                        "by_name_desc",
                        "by_size",
                        "by_size_desc",
                    ],
                    {"default": "by_date_desc"},
                ),
                "sub_foldres": ("BOOLEAN", {"default": False}),     
                "keep_extensions": ("BOOLEAN", {"default": True}),  
                "keep_full_path": ("BOOLEAN", {"default": False}),  
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "INT", "STRING",)
    RETURN_NAMES = ("found_list", "found_as_text", "last_filename", "first_filename", "files_count", "❓help",)
    FUNCTION = "process"
    CATEGORY = "darkilNodes/files"
    OUTPUT_IS_LIST = (True, False, False, False, False)
    
    HELP_TEXT = """Lists files in a folder based on a glob pattern. Parameters:
- **folder_path** (STRING): Path to the directory.
- **files_extension** (STRING): Extension filter; can be a simple extension (e.g., “png”) or any glob pattern (e.g., “*.txt”).
- **sort_by** (COMBO): Sorting method – by date, name, size and their descending variants.
- **sub_foldres** (BOOL): If true, search recursively in sub-folders.
- **keep_extensions** (BOOL): Keep file extensions in the output names.
- **keep_full_path** (BOOL): Return full absolute paths instead of just filenames.

Outputs:
1. **found_list** – list of file names/paths.
2. **found_as_text** – newline-separated string of all files.
3. **last_filename** – name/path of the last file after sorting.
4. **first_filename** – name/path of the first file after sorting.
5. **files_count** – total number of files found.
6. **❓help** – this help text.

The node returns an empty list if the folder does not exist or contains no matching files."""

    # Helper – turn whatever the user typed into a proper glob pattern
    @staticmethod
    def _make_pattern(ext: str) -> str:
        """
        Normalise ``files_extension`` to a glob pattern.

        * ``*.*`` → ``*.*`` (already a pattern)
        * ``png``  → ``*.png``
        * ``.jpg`` → ``*.jpg``
        * ``*.txt`` → ``*.txt`` (unchanged)
        """
        ext = ext.strip()
        if not ext:
            return "*"

        # If the string already contains glob wildcards we assume it is a full pattern.
        if any(ch in ext for ch in ("*", "?", "[")):
            return ext

        # Ensure leading dot before the extension.
        if not ext.startswith("."):
            ext = f".{ext}"
        return f"*{ext}"

    # Main logic
    def process(
        self,
        folder_path: str,
        files_extension: str,
        sort_by: str,
        sub_foldres: bool,
        keep_extensions: bool,
        keep_full_path: bool,
        **kwargs
    ) -> Tuple[List[str], str, str, str]:

        if not folder_path:
            return [], "", "", "", 0, self.HELP_TEXT

        base_dir = Path(folder_path).expanduser().resolve()
        if not base_dir.is_dir():
            # Gracefully handle wrong paths – the UI will just see an empty list.
            return [], "", "", "", 0, self.HELP_TEXT

        pattern = self._make_pattern(files_extension)

        try:
            if sub_foldres:
                raw_candidates = list(base_dir.rglob(pattern))
            else:
                raw_candidates = list(base_dir.glob(pattern))
        except Exception as exc:                     # pragma: no cover – safety net
            log.error(f"[darkilNodes.FilesList] glob error: {exc}")
            return [], "", "", "", 0, self.HELP_TEXT

        # Keep only real files (skip directories, symlinks that point to dirs, etc.)
        candidates = [p for p in raw_candidates if p.is_file()]

        def _key_date(p: Path):
            try:
                return p.stat().st_mtime
            except Exception:
                return 0.0

        def _key_name(p: Path):
            # Case‑insensitive alphabetical order
            return p.name.lower()

        def _key_size(p: Path):
            try:
                return p.stat().st_size
            except Exception:
                return 0

        sort_map = {
            "by_date": (_key_date, False),
            "by_date_desc": (_key_date, True),
            "by_name": (_key_name, False),
            "by_name_desc": (_key_name, True),
            "by_size": (_key_size, False),
            "by_size_desc": (_key_size, True),
        }

        key_func, reverse = sort_map.get(sort_by, (_key_date, False))
        sorted_files = sorted(candidates, key=key_func, reverse=reverse)

        found_list: List[str] = []
        for p in sorted_files:
            if keep_full_path:
                out_name = str(p.resolve())
            else:
                out_name = p.name

            if not keep_extensions:
                # Strip the extension – preserve directory part when we output a full path.
                if keep_full_path:
                    out_name = str(p.parent / p.stem)
                else:
                    out_name = p.stem

            found_list.append(out_name)

        found_as_text = "\n".join(found_list)   # newline‑separated – easy to copy/paste
        first_filename = found_list[0] if found_list else ""
        last_filename = found_list[-1] if found_list else ""

        return found_list, found_as_text, last_filename, first_filename, len(found_list), self.HELP_TEXT


    @classmethod
    def IS_CHANGED(
        cls, 
        folder_path: str,
        files_extension: str,
        sort_by: str,
        sub_foldres: bool,
        keep_extensions: bool,
        keep_full_path: bool,
        **kwargs
    ):
        # recalc node
        return float("NaN")
