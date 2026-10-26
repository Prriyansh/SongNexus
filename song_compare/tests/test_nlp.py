import nlp


def test_tokenize_lowercases_and_keeps_apostrophes():
    assert nlp.tokenize("Don't STOP me now!") == ["don't", "stop", "me", "now"]


def test_parse_structure_counts_sections_and_repetition():
    raw = "[Intro]\nOh\n[Verse 1]\nLine one\nLine two\n[Chorus]\nHook line\nHook line\n[Verse 2]\nLine three\n[Bridge: Someone]\nBridge line\n[Outro]\nBye"
    structure, clean = nlp.parse_structure(raw)
    assert structure["verses"] == 2
    assert structure["choruses"] == 1
    assert structure["bridges"] == 1
    assert structure["has_intro"] and structure["has_outro"]
    assert structure["sections_total"] == 6
    assert "[" not in clean
    # 8 lines, 7 unique ("Hook line" repeats once)
    assert structure["lines"] == 8
    assert structure["repetition"] == round(1 - 7 / 8, 3)


def test_parse_structure_handles_empty_lyrics():
    structure, clean = nlp.parse_structure("")
    assert structure["lines"] == 0 and structure["repetition"] == 0.0 and structure["lexical_diversity"] == 0.0
    assert clean == ""


def test_analyze_lyrics_finds_emotion_theme_and_sign(monkeypatch):
    monkeypatch.setattr(nlp, "_vader", None)  # use the built-in lexicon so the test is deterministic
    features, _ = nlp.analyze_lyrics("[Chorus]\nI love you darling, kiss me\nhappy and sweet forever together")
    assert features["top_emotion"] == "love"
    assert features["top_themes"][0] == "romance"
    assert features["sentiment"]["compound"] > 0


def test_analyze_lyrics_is_neutral_without_lexicon_words(monkeypatch):
    monkeypatch.setattr(nlp, "_vader", None)
    features, _ = nlp.analyze_lyrics("the table is next to the chair")
    assert features["top_emotion"] == "neutral"
    assert features["top_themes"] == []
    assert features["sentiment"]["compound"] == 0
