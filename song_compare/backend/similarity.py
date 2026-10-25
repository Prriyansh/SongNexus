"""
All the comparison math lives here.

compare(a, b) returns:
  audio similarity    (Euclidean distance on scaled audio features)
  lyric similarity    (semantic LSA + TF IDF + themes + sentiment)
  shared credits      (artists, album, genre)
  structure facts     (tempo, key, time signature, sections, repetition)
  overall score and a plain English list of reasons
"""
import math

import numpy as np

from catalog import AUDIO_COLS, PITCH


# audio
def _closest_tempo(a, b):
    """
    Tempo helper. A 70 BPM song and a 140 BPM song feel the same (half/double time),
    so we compare b, 2b and b/2 against a and use whichever is closest.
    """
    return min((b, 2 * b, b / 2), key=lambda t: abs(t - a))


def audio_similarity(cat, i, j):
    """
    Euclidean distance between two songs in scaled feature space:
        d = sqrt( sum_k w_k * (a_k - b_k)^2 / sum_k w_k )
    Then mapped to a 0..1 score with sim = 1 / (1 + (d / d_median)^2), where d_median is
    the typical distance between two random songs. So 50% means "as different as a random
    pair", 100% means identical.
    """
    a= cat.audio[i].copy()
    b = cat.audio[j].copy()
    ta, tb = float(cat.tracks.at[i, "tempo"]), float(cat.tracks.at[j, "tempo"])
    t_idx = AUDIO_COLS.index("tempo")
    b[t_idx] = cat.scale("tempo", np.array([_closest_tempo(ta, tb)], dtype="float32"))[0]

    d = float(cat.weighted_dist(a, b))
    sim = 1.0 / (1.0 + (d / cat.median_dist) ** 2)
    per_feature = {c: round(1 - abs(float(a[k] - b[k])), 3) for k, c in enumerate(AUDIO_COLS)}
    return {"score": round(sim, 4), "distance": round(d, 4), "per_feature": per_feature}


#====== lyrics
def _cos(u, v):
    nu, nv = np.linalg.norm(u), np.linalg.norm(v)
    return float(u @ v / (nu * nv)) if nu and nv else 0.0


def lyric_similarity(cat, i, j):
    ra, rb = int(cat.tracks.at[i, "lyric_row"]), int(cat.tracks.at[j, "lyric_row"])
    if ra < 0 or rb < 0 or cat.lsa is None:
        return None
    la, lb = cat.tracks.at[i, "lyrics_analysis"], cat.tracks.at[j, "lyrics_analysis"]

    # Semantic: cosine of LSA topic vectors (same subject, even with different words)
    semantic = max(0.0, float(cat.lsa[ra] @ cat.lsa[rb]))
    # Vocabulary: cosine of TF IDF vectors (shared distinctive words)
    vocab = float((cat.tfidf[ra].multiply(cat.tfidf[rb])).sum())
    # Themes: cosine between the 8 theme score vectors
    theme = max(0.0, _cos(np.array(list(la["themes"].values())), np.array(list(lb["themes"].values()))))
    # Sentiment: 1 when both songs have the same polarity, 0 when one is +1 and the other -1
    sent = 1 - abs(la["sentiment"]["compound"] - lb["sentiment"]["compound"]) / 2

    # Weighted blend. Semantic carries the most because it captures meaning.
    score = 0.4 * semantic + 0.2 * vocab + 0.2 * theme + 0.2 * sent
    return {
        "score": round(score, 4),
        "semantic": round(semantic, 4), "vocabulary": round(vocab, 4),
        "themes": round(theme, 4), "sentiment": round(sent, 4),
        "shared_themes": [t for t in la["top_themes"] if t in lb["top_themes"]],
        "emotion_a": la["top_emotion"], "emotion_b": lb["top_emotion"],
    }


# ==== credits and structure
def shared_credits(a, b):
    sa = {x.lower(): x for x in a["artists"]}
    sb = {x.lower(): x for x in b["artists"]}
    return {
        "artists": [sa[k] for k in sa if k in sb],
        "same_album": bool(a["album"]) and a["album"] == b["album"],
        "same_genre": a["genre"] == b["genre"],
        "genre": a["genre"] if a["genre"] == b["genre"] else None,
        "album": a["album"] if a["album"] == b["album"] else None,
    }


def key_relation(a, b):
    """Musical key compatibility using the circle of fifths."""
    if a["key"] is None or b["key"] is None:
        return "unknown"
    if a["key"] == b["key"] and a["mode"] == b["mode"]:
        return "same key"
    # relative major/minor share the same notes (e.g. C major and A minor)
    major_a = a["key"] if a["mode"] == 1 else (a["key"] + 3) % 12
    major_b = b["key"] if b["mode"] == 1 else (b["key"] + 3) % 12
    if major_a == major_b:
        return "relative major/minor"
    steps = min((((major_a - major_b) * 7) % 12), (((major_b - major_a) * 7) % 12))  # fifths apart
    return "closely related key" if steps == 1 else f"{steps} steps apart on the circle of fifths"


# ==== everything together
def compare(cat, id_a, id_b, w_audio=0.6):
    i, j = cat.index_of(id_a), cat.index_of(id_b)
    if i is None or j is None:
        return None
    a, b = cat.detail(i), cat.detail(j)

    audio = audio_similarity(cat, i, j)
    lyrics = lyric_similarity(cat, i, j)
    # Overall score: blend audio and lyrics. If either song has no lyrics match, use audio alone.
    overall = audio["score"] if lyrics is None else w_audio * audio["score"] + (1 - w_audio) * lyrics["score"]

    credits = shared_credits(a, b)
    structure = {
        "tempo": {"a": round(a["tempo"]), "b": round(b["tempo"]),
                  "half_double_match": abs(a["tempo"] - 2 * b["tempo"]) < 6 or abs(2 * a["tempo"] - b["tempo"]) < 6},
        "key": {"a": a["key_name"], "b": b["key_name"], "relation": key_relation(a, b)},
        "time_signature": {"a": a["time_signature"], "b": b["time_signature"]},
        "duration_sec": {"a": round(a["duration_ms"] / 1000), "b": round(b["duration_ms"] / 1000)},
    }

    return {"a": a, "b": b, "overall": round(overall, 4), "audio": audio, "lyrics": lyrics,
            "credits": credits, "structure": structure,
            "reasons": reasons(a, b, audio, lyrics, credits, structure)}


def reasons(a, b, audio, lyrics, credits, structure):
    """Plain English explanation of why the two songs feel similar (or not)."""
    out = []
    if credits["artists"]:
        out.append(f"Shared artist credit: {', '.join(credits['artists'])}.")
    if credits["same_album"]:
        out.append(f"Both appear on the album {credits['album']}.")
    if structure["tempo"]["half_double_match"]:
        out.append("Tempos line up in half time or double time.")
    elif abs(a["tempo"] - b["tempo"]) <= 8:
        out.append(f"Nearly the same tempo ({round(a['tempo'])} vs {round(b['tempo'])} BPM).")
    close = sorted(audio["per_feature"].items(), key=lambda kv: -kv[1])
    close = [k for k, v in close if v >= 0.9 and k not in ("tempo", "instrumentalness", "liveness")][:2]
    if close:
        out.append("Very close on " + " and ".join(close) + ".")
    far = [k for k, v in audio["per_feature"].items() if v < 0.6 and k in ("energy", "valence", "danceability")]
    if far:
        out.append("Noticeably different on " + ", ".join(far) + ".")
    if structure["key"]["relation"] in ("same key", "relative major/minor", "closely related key"):
        out.append(f"Keys are compatible ({structure['key']['relation']}).")
    if lyrics:
        if lyrics["shared_themes"]:
            out.append("Lyrics share themes: " + ", ".join(lyrics["shared_themes"]) + ".")
        if lyrics["emotion_a"] != lyrics["emotion_b"]:
            out.append(f"Emotional tone differs: {lyrics['emotion_a']} vs {lyrics['emotion_b']}.")
        elif lyrics["emotion_a"] != "neutral":
            out.append(f"Both lean toward {lyrics['emotion_a']}.")
    else:
        out.append("Lyrics were not available for one or both songs, so this score uses audio only.")
    return out[:6]


# == discovery
def similar_tracks(cat, track_id, k=10):
    """
    Nearest neighbours by audio. Computes the weighted distance from the chosen song to
    every song in the catalog at once (vectorised), then takes the k smallest.
    """
    i = cat.index_of(track_id)
    if i is None:
        return None
    d = cat.weighted_dist(cat.audio, cat.audio[i])
    d[i] = np.inf
    seed_artists = {x.strip().lower() for x in str(cat.tracks.at[i, "artists"]).split(";")}
    order = np.argsort(d)[: k * 4]
    out, seen = [], set()
    for j in order:
        brief = cat.brief(cat.tracks.iloc[j])
        key = (brief["title"].lower(), tuple(brief["artists"]))
        if key in seen:
            continue
        seen.add(key)
        brief["score"] = round(1.0 / (1.0 + (float(d[j]) / cat.median_dist) ** 2), 4)
        brief["shares_artist"] = bool(seed_artists & {x.lower() for x in brief["artists"]})
        out.append(brief)
        if len(out) == k:
            break
    return out
