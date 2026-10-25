"""
Creates a small fake dataset in the SAME format as the two real ones, so you can
run and test the whole app without downloading anything.

  python make_demo_data.py
  python prepare_data.py --spotify data/raw/demo_spotify.csv --genius data/raw/demo_genius.csv

Lyrics here are randomly assembled original lines, not real songs.
"""
import random
from pathlib import Path

import numpy as np
import pandas as pd

rng = random.Random(7)
nrng = np.random.default_rng(7)
RAW = Path(__file__).parent / "data" / "raw"
RAW.mkdir(parents=True, exist_ok=True)

GENRES = {  # tempo, energy, danceability, valence, acousticness, loudness, speechiness
    "pop":        (118, .70, .70, .60, .15, -6, .06),
    "hip-hop":    (130, .65, .78, .50, .12, -6.5, .25),
    "rock":       (128, .82, .45, .50, .08, -5.5, .05),
    "acoustic":   (98,  .30, .50, .45, .80, -11, .04),
    "electronic": (126, .85, .72, .45, .03, -5, .06),
}
ARTISTS = ["Mira Vale", "The Hollow Pines", "Dex Orion", "Luna Cove", "Kairo Blue", "Nova Ashby", "Juno Fields",
           "Rook & Ember", "Sable Rivers", "Tomas Reyes", "Aya Lindqvist", "Cedar Atlas", "Vera Quill",
           "Milo Strand", "Opal Harbor", "Zane Calloway", "Ivy Northcote", "Felix Moreau", "Rhea Lark", "Bram Tidal"]
THEMES = {
    "romance":    ["I hold your hand and the whole world slows", "Your kiss is the sweetest thing I know",
                   "Darling stay with me tonight", "My heart keeps finding its way to you",
                   "Love is the light that we carry", "Hold me close and never let go"],
    "heartbreak": ["You said goodbye and the room went cold", "Tears on the pillow where you used to be",
                   "I miss you more than I can say", "Broken and lonely I am gone without you",
                   "Every memory leaves me crying", "The hurt keeps coming back at night"],
    "party":      ["Dance until the morning light", "The club is loud and the night is young",
                   "Turn the music up tonight", "Raise a drink and celebrate",
                   "Feel the floor shake under us", "Everybody on the dance floor now"],
    "success":    ["Money in my pocket and the crown on my head", "We started from nothing now we win",
                   "Hustle every day and the gold is mine", "King of the city on the rise",
                   "Cash and fame and bands on bands", "Boss moves only and I never fall"],
    "freedom":    ["Roll the windows down and the road is wide", "Free as the wind on the highway",
                   "We run to the horizon wild and free", "Fly away and escape the town",
                   "Drive until the sun comes up", "Nothing can hold us down"],
    "nostalgia":  ["I remember the summer we were young", "Those childhood days are far behind",
                   "Yesterday feels like home again", "Old memories drift back to me",
                   "We were kids on the old street", "Take me back to those golden days"],
}
THEME_GENRE = {"pop": ["romance", "party", "heartbreak"], "hip-hop": ["success", "party", "nostalgia"],
               "rock": ["freedom", "heartbreak", "nostalgia"], "acoustic": ["romance", "nostalgia", "heartbreak"],
               "electronic": ["party", "freedom", "romance"]}
W1 = ["Midnight", "Paper", "Golden", "Velvet", "Silver", "Hidden", "Electric", "Quiet", "Burning", "Distant", "Neon", "Faded"]
W2 = ["Hearts", "Skyline", "Echoes", "Rivers", "Fire", "Letters", "Highway", "Shadows", "Summer", "Static", "Gravity", "Mirrors"]


def lyrics_for(theme):
    pool = THEMES[theme]
    hook = [rng.choice(pool) for _ in range(2)]
    verse = lambda: "\n".join(rng.choice(pool) for _ in range(4))
    return (f"[Intro]\n{rng.choice(pool)}\n\n[Verse 1]\n{verse()}\n\n[Chorus]\n" + "\n".join(hook * 2) +
            f"\n\n[Verse 2]\n{verse()}\n\n[Chorus]\n" + "\n".join(hook * 2) +
            f"\n\n[Bridge]\n{verse()}\n\n[Chorus]\n" + "\n".join(hook * 2))


# Each artist has a home genre and a small personal sound offset, so their songs cluster.
artist_genre = {a: rng.choice(list(GENRES)) for a in ARTISTS}
artist_bias = {a: nrng.normal(0, 0.05, 4) for a in ARTISTS}

sp_rows, gn_rows, used = [], [], set()
for n in range(420):
    lead = rng.choice(ARTISTS)
    artists = [lead] + ([rng.choice(ARTISTS)] if rng.random() < 0.2 else [])
    artists = list(dict.fromkeys(artists))
    genre = artist_genre[lead] if rng.random() < 0.85 else rng.choice(list(GENRES))
    title = f"{rng.choice(W1)} {rng.choice(W2)}"
    if (title, lead) in used:
        continue
    used.add((title, lead))
    t, en, da, va, ac, lo, spc = GENRES[genre]
    b = artist_bias[lead]
    clip = lambda x: float(min(max(x, 0.01), 0.99))
    album = f"{rng.choice(W2)} {rng.choice(['Sessions', 'Tapes', 'Stories', 'Volume 1'])}"
    sp_rows.append({
        "track_id": f"demo{n:04d}", "artists": ";".join(artists), "album_name": album, "track_name": title,
        "popularity": int(nrng.integers(5, 95)), "duration_ms": int(nrng.normal(205000, 30000)),
        "explicit": rng.random() < 0.2, "danceability": clip(nrng.normal(da + b[0], .08)),
        "energy": clip(nrng.normal(en + b[1], .08)), "key": rng.randrange(12), "loudness": float(nrng.normal(lo, 1.5)),
        "mode": rng.randrange(2), "speechiness": clip(nrng.normal(spc, .03)),
        "acousticness": clip(nrng.normal(ac, .08)), "instrumentalness": clip(abs(nrng.normal(0, .05))),
        "liveness": clip(nrng.normal(.18, .06)), "valence": clip(nrng.normal(va + b[2], .12)),
        "tempo": float(nrng.normal(t + 20 * b[3], 8)), "time_signature": 4 if rng.random() < .9 else 3,
        "track_genre": genre,
    })
    if rng.random() < 0.78:  # most songs have lyrics in the other dataset
        theme = rng.choice(THEME_GENRE[genre])
        # Write the credit the way Genius would: different separators, sometimes a suffix on the title.
        g_artist = " & ".join(artists) if len(artists) > 1 else lead
        g_title = title + (" (Remastered)" if rng.random() < 0.1 else "")
        gn_rows.append({"title": g_title, "artist": g_artist, "tag": genre, "year": rng.randint(1995, 2024),
                        "lyrics": lyrics_for(theme)})

pd.DataFrame(sp_rows).to_csv(RAW / "demo_spotify.csv", index=True)  # real file also has an index column
pd.DataFrame(gn_rows).to_csv(RAW / "demo_genius.csv", index=False)
print(f"Wrote {len(sp_rows)} Spotify style rows and {len(gn_rows)} Genius style rows to {RAW}")
