"""Schemas for the sound & lyrics comparison of two songs (the song_compare service)."""

from __future__ import annotations

import enum

from pydantic import Field

from songnexus.service.schemas import ApiModel


class SoundStatus(enum.StrEnum):
    """Whether the sound & lyrics comparison could be made."""

    OK = "OK"
    # One or both songs aren't in the sound dataset (a 2022 snapshot); `missing` says which.
    NOT_FOUND = "NOT_FOUND"
    # Both songs match the same dataset track (for example a remaster and the original).
    SAME_TRACK = "SAME_TRACK"
    # The service isn't configured or didn't answer.
    UNAVAILABLE = "UNAVAILABLE"


class SoundFeature(enum.StrEnum):
    """An audio feature on a 0–1 scale, as the dataset measures it."""

    ENERGY = "ENERGY"
    DANCEABILITY = "DANCEABILITY"
    VALENCE = "VALENCE"
    ACOUSTICNESS = "ACOUSTICNESS"
    SPEECHINESS = "SPEECHINESS"
    LIVENESS = "LIVENESS"
    INSTRUMENTALNESS = "INSTRUMENTALNESS"


class FeatureValue(ApiModel):
    """One audio feature of a song."""

    feature: SoundFeature
    value: float = Field(ge=0, le=1)


class LyricStructure(ApiModel):
    """Counts from a song's lyrics (the lyrics themselves are never sent)."""

    verses: int
    choruses: int
    bridges: int
    words: int
    repetition: float = Field(ge=0, le=1, description="Share of lines that repeat.")


class LyricProfile(ApiModel):
    """What a song's lyrics are about, computed from them."""

    top_emotion: str
    sentiment: float = Field(ge=-1, le=1, description="Compound sentiment, -1 to 1.")
    top_themes: list[str]
    structure: LyricStructure


class SoundTrack(ApiModel):
    """A song as the sound dataset knows it."""

    title: str
    artists: list[str]
    album: str | None = None
    genre: str | None = None
    tempo_bpm: float
    key: str = Field(description="Key name, e.g. `F# minor`; `Unknown` when not detected.")
    time_signature: int | None = Field(default=None, description="Beats per bar.")
    duration_ms: int
    features: list[FeatureValue]
    lyrics: LyricProfile | None = Field(
        default=None, description="Null when the dataset has no lyrics for the song."
    )


class LyricSimilarity(ApiModel):
    """How alike two songs' lyrics are, by part (each 0–1)."""

    score: float
    meaning: float
    shared_words: float
    themes: float
    sentiment: float
    shared_themes: list[str]


class SoundStructure(ApiModel):
    """Tempo and key side by side."""

    half_or_double_time: bool = Field(description="The tempos line up in half or double time.")
    key_relation: str = Field(
        description="How the keys relate, e.g. `same key`, `relative major/minor`, `unknown`."
    )


class SoundComparison(ApiModel):
    """The comparison: an explained similarity, both songs' profiles, and why."""

    track_a: SoundTrack
    track_b: SoundTrack
    similarity: float = Field(
        description="0–1: sound and lyric similarity blended (sound alone without lyrics)."
    )
    sound_similarity: float
    lyric_similarity: LyricSimilarity | None = None
    structure: SoundStructure
    reasons: list[str] = Field(description="Plain-language reasons, most telling first.")


class SimilarSong(ApiModel):
    """A song from the dataset that sounds like one of the two."""

    title: str
    artists: list[str]
    genre: str | None = None
    similarity: float
    shares_artist: bool
    recording: str | None = Field(
        default=None,
        description="`recordings/{id}` when the song is in our catalog, so it can be opened; "
        "matched by title and an unambiguous artist, never guessed.",
    )


class CompareSoundResponse(ApiModel):
    """CompareRecordingSound."""

    status: SoundStatus
    comparison: SoundComparison | None = None
    similar_a: list[SimilarSong] = Field(default_factory=list)
    similar_b: list[SimilarSong] = Field(default_factory=list)
    missing: list[str] = Field(
        default_factory=list,
        description="For NOT_FOUND: which songs (`recordings/{id}`) the dataset lacks.",
    )
    sources: list[str] = Field(
        default_factory=list,
        description="Data sources behind the analysis, `dataSources/{source}`.",
    )
