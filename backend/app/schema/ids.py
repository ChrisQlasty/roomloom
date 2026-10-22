"""Readable, prefixed entity ids such as `r_room_3a`, `w_12` or `mat_oak_floor`."""

import re
import unicodedata
from collections.abc import Collection
from typing import Literal

IdKind = Literal[
    "room", "wall", "opening", "transition", "object", "material", "pin", "note", "asset"
]

PREFIXES: dict[IdKind, str] = {
    "room": "r_",
    "wall": "w_",
    "opening": "op_",
    "transition": "tr_",
    "object": "obj_",
    "material": "mat_",
    "pin": "pin_",
    "note": "note_",
    "asset": "ast_",
}

_BODY = "[a-z0-9]+(?:_[a-z0-9]+)*"


def id_pattern(kind: IdKind) -> str:
    """Regex an id of this kind must match, e.g. `^r_[a-z0-9]+(?:_[a-z0-9]+)*$`."""
    return f"^{PREFIXES[kind]}{_BODY}$"


# Latin letters that Unicode does not decompose into a base letter plus accent.
_LATIN_EXTRAS = str.maketrans({"ł": "l", "ø": "o", "đ": "d", "æ": "ae", "œ": "oe", "þ": "th"})


def slugify(text: str) -> str:
    """Transliterate Latin letters to ASCII (`Źródło` gives `zrodlo`), lowercase `text` and
    collapse every run of other characters into one underscore."""
    folded = text.casefold().translate(_LATIN_EXTRAS)
    ascii_text = unicodedata.normalize("NFKD", folded).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", ascii_text).strip("_")


def new_id(kind: IdKind, taken: Collection[str], hint: str | None = None) -> str:
    """Return an unused id of `kind`.

    With a `hint` the id is readable (`new_id("room", taken, "Room 3A")` gives `r_room_3a`,
    then `r_room_3a_2`, ...). Without one it is numbered: `r_1`, `r_2`, ...
    """
    prefix = PREFIXES[kind]
    base = slugify(hint) if hint else ""
    if base and prefix + base not in taken:
        return prefix + base
    stem = f"{prefix}{base}_" if base else prefix
    n = 2 if base else 1
    while f"{stem}{n}" in taken:
        n += 1
    return f"{stem}{n}"
