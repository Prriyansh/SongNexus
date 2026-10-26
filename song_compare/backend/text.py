"""Title and artist normalisation, shared by data preparation and the catalog's song lookup."""
import re
import unicodedata


def norm_text(s):
    """lowercase, strip accents, drop (feat...), [..], 'remastered' tails and punctuation."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower()
    s = re.sub(r"[\(\[].*?[\)\]]", " ", s)                       # (feat. X), [Live]
    s = re.sub(r"\s[-]\s(remaster|live|mono|stereo|single|radio|version|edit|remix).*$", " ", s)
    s = re.sub(r"\b(feat|ft|featuring)\.?\b.*$", " ", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


_SPLIT = re.compile(r"\s*(?:;|,|&|\band\b|\bx\b|\bfeat\.?\b|\bft\.?\b|\bwith\b)\s*", re.I)


def artist_variants(artist):
    """All artist names a credit string could refer to: whole string + each part."""
    if not isinstance(artist, str):
        return []
    parts = [p for p in _SPLIT.split(artist) if p]
    out = {norm_text(artist)} | {norm_text(p) for p in parts}
    return [a for a in out if a]
