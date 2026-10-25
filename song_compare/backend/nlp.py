"""
Lyric NLP helpers.

Everything here works on lyrics that are loaded in memory ONLY while the
prepare step runs. We keep derived numbers (sentiment, themes, structure,
vectors) and throw the raw text away, so the app never stores or serves lyrics.
"""
import re
from collections import Counter

# Use VADER if it is installed (better quality). Otherwise fall back to a tiny
# built in lexicon so the pipeline still runs anywhere.
try:
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
    _vader = SentimentIntensityAnalyzer()
except Exception:  # ImportError or any packaging problem
    _vader = None

_POS = set("""love loved loving happy joy smile smiling shine shining light bright hope dream dreams
free freedom beautiful beauty heaven sweet kiss alive better best good great glad warm gold wonderful
perfect forever together win winning rise rising believe faith strong dance party celebrate""".split())
_NEG = set("""hate hurt pain cry crying tears sad sorrow lonely alone dark death dead die dying broken break
lost lose losing never gone goodbye fear afraid scared cold hell kill blood bleed fall falling regret
lie lies liar miss missing empty wrong bad worse worst tired war fight""".split())

# Emotion lexicons. Small on purpose: easy to read, easy to extend.
EMOTIONS = {
    "sadness": set("cry crying tears sad sorrow lonely alone goodbye gone miss missing empty broken hurt pain grief lost rain".split()),
    "hope": set("hope dream dreams tomorrow rise rising believe faith light sunrise morning heal healing better someday future".split()),
    "love": set("love loved loving kiss heart darling baby touch hold holding forever desire sweet romance".split()),
    "anger": set("hate angry rage fight war kill hell damn mad revenge liar lies enemy burn".split()),
    "joy": set("happy joy smile dance party celebrate laugh sunshine fun alive shine paradise".split()),
    "fear": set("fear afraid scared panic nightmare dark shadow haunt tremble danger run hiding".split()),
}

# Theme lexicons used for a simple "what is this song about" vector.
THEMES = {
    "romance": set("love kiss heart darling baby touch lips eyes hold sweet romance together".split()),
    "heartbreak": set("goodbye broken tears miss missing gone leave left lonely cry hurt over ex".split()),
    "party": set("dance party club night drink drinking tonight floor music dj shots celebrate".split()),
    "success": set("money cash rich gold boss win winning top king queen crown fame hustle bands".split()),
    "struggle": set("struggle fight pain streets scars grind survive tired fall rise broke work".split()),
    "freedom": set("free freedom road drive highway wind fly flying wild escape run horizon".split()),
    "nostalgia": set("remember memories yesterday childhood young old days summer past home back".split()),
    "faith": set("god heaven lord pray prayer soul angel faith spirit grace saved".split()),
}

_WORD = re.compile(r"[a-z']+")
_HEADER = re.compile(r"^\s*\[(.*?)\]\s*$", re.MULTILINE)


def tokenize(text):
    return _WORD.findall(text.lower())


def _line_sentiment(line):
    """Sentiment of one line in [-1, 1]."""
    if _vader is not None:
        return _vader.polarity_scores(line)["compound"]
    toks = tokenize(line)
    if not toks:
        return 0.0
    score = sum(t in _POS for t in toks) - sum(t in _NEG for t in toks)
    return max(-1.0, min(1.0, score / (len(toks) ** 0.5)))


def parse_structure(raw):
    """
    Reads Genius section headers like [Verse 1] / [Chorus] and returns
    (structure_dict, cleaned_text_without_headers).
    """
    sections = []
    for h in _HEADER.findall(raw):
        name = h.split(":")[0].lower()
        name = re.sub(r"[\d\s]+$", "", name).strip()   # "verse 2" -> "verse"
        sections.append(name)
    counts = Counter(sections)
    body = _HEADER.sub("", raw)
    lines = [l.strip() for l in body.splitlines() if l.strip()]
    words = tokenize(body)
    uniq_lines = len(set(l.lower() for l in lines))

    structure = {
        "verses": counts.get("verse", 0) + counts.get("part", 0),
        "choruses": counts.get("chorus", 0) + counts.get("refrain", 0) + counts.get("hook", 0),
        "bridges": counts.get("bridge", 0),
        "has_intro": counts.get("intro", 0) > 0,
        "has_outro": counts.get("outro", 0) > 0,
        "sections_total": len(sections),
        "lines": len(lines),
        "words": len(words),
        # Share of lines that are repeats of an earlier line (hooks, refrains).
        "repetition": round(1 - uniq_lines / len(lines), 3) if lines else 0.0,
        # Unique words / total words: a quick vocabulary richness measure.
        "lexical_diversity": round(len(set(words)) / len(words), 3) if words else 0.0,
    }
    return structure, "\n".join(lines)


def analyze_lyrics(raw):
    """
    Turns raw lyrics into numbers. Returns (features_dict, clean_text).
    clean_text is only used to fit TF IDF during preparation, then discarded.
    """
    structure, clean = parse_structure(raw)
    lines = clean.splitlines()
    words = tokenize(clean)
    n = max(len(words), 1)

    # Sentiment: average per line sentiment, because VADER style scores
    # saturate when you feed them a whole song at once.
    line_scores = [_line_sentiment(l) for l in lines] or [0.0]
    sentiment = {
        "compound": round(sum(line_scores) / len(line_scores), 4),
        "positive_share": round(sum(s > 0.2 for s in line_scores) / len(line_scores), 3),
        "negative_share": round(sum(s < -0.2 for s in line_scores) / len(line_scores), 3),
    }

    # Emotions and themes: lexicon hits per 100 words (length independent).
    wc = Counter(words)
    emotions = {k: round(100 * sum(wc[w] for w in v) / n, 3) for k, v in EMOTIONS.items()}
    themes = {k: round(100 * sum(wc[w] for w in v) / n, 3) for k, v in THEMES.items()}

    top_emotion = max(emotions, key=emotions.get) if any(emotions.values()) else "neutral"
    top_themes = [k for k, v in sorted(themes.items(), key=lambda kv: -kv[1]) if v > 0][:3]

    features = {
        "sentiment": sentiment,
        "emotions": emotions,
        "top_emotion": top_emotion,
        "themes": themes,
        "top_themes": top_themes,
        "structure": structure,
    }
    return features, clean
