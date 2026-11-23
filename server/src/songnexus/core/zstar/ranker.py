"""The ranker: three logistic heads and one value per candidate.

Heads (each P(label | features) from a logistic model over ``FEATURES``):

- ``open``: the listener opens the artist from the card;
- ``listen``: they press "Listen on YouTube Music";
- ``negative``: they press "not interested" or scroll past at once.

The value a card is ranked by is ``Σ utility[head] * P(head)``: listening
counts most, opening counts, and a likely "not interested" costs. Multi-task
heads like these are how large feeds balance engagement against annoyance.

``PRIOR`` is the hand-set model served before there is data: it encodes the
documented intuitions (agreement between sources, closeness to seeds, genre
fit, photos help, fatigue and negatives hurt). A stored ``ranker`` artifact,
when one is active, replaces it (see ``service.zstar_runtime``).
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import cast

from songnexus.core.zstar.features import FEATURES

HEADS = ("open", "listen", "negative")
UTILITY = {"open": 1.0, "listen": 2.0, "negative": -1.5}
PRIOR_VERSION = "prior-1"

_PRIOR_WEIGHTS: dict[str, dict[str, float]] = {
    "open": {
        "bias": -2.6,
        "walk": 0.9,
        "colisten": 0.8,
        "embed": 0.7,
        "genre": 0.4,
        "friends": 0.6,
        "explore": 0.1,
        "sources": 1.2,
        "genre_affinity": 1.0,
        "genre_penalty": -1.5,
        "negative_similarity": -1.2,
        "seed_similarity": 1.0,
        "popularity": 0.5,
        "has_image": 0.6,
        "seen_before": -0.4,
        "opened_before": 0.3,
        "skip_rate": -1.0,
        "fatigue": -1.5,
    },
    "listen": {
        "bias": -3.6,
        "walk": 0.8,
        "colisten": 1.0,
        "embed": 0.6,
        "genre": 0.4,
        "friends": 0.5,
        "sources": 1.0,
        "genre_affinity": 1.0,
        "genre_penalty": -1.5,
        "negative_similarity": -1.2,
        "seed_similarity": 1.0,
        "popularity": 0.6,
        "has_image": 0.3,
        "opened_before": 0.6,
        "skip_rate": -1.0,
        "fatigue": -1.5,
    },
    "negative": {
        "bias": -3.0,
        "explore": 0.4,
        "genre_affinity": -1.0,
        "genre_penalty": 2.0,
        "negative_similarity": 2.5,
        "seed_similarity": -0.8,
        "novelty": 0.3,
        "skip_rate": 1.5,
        "fatigue": 1.0,
    },
}


@dataclass(frozen=True)
class Model:
    """A ranking model: weights per head over ``features``, plus provenance.

    Attributes:
        version: ``prior-1`` or ``trained-<timestamp>``.
        weights: Head -> feature -> weight.
        features: The column order the weights were trained with.
        metrics: Training metrics (holdout AUC per head, examples, positives).
    """

    version: str
    weights: Mapping[str, Mapping[str, float]]
    features: tuple[str, ...] = FEATURES
    metrics: Mapping[str, float] = field(default_factory=dict)

    def heads(self, features: Mapping[str, float]) -> dict[str, float]:
        """P(head) for one candidate."""
        out = {}
        for head in HEADS:
            w = self.weights.get(head, {})
            z = sum(w.get(name, 0.0) * features.get(name, 0.0) for name in self.features)
            out[head] = 1.0 / (1.0 + math.exp(-max(min(z, 30.0), -30.0)))
        return out

    def value(self, features: Mapping[str, float]) -> tuple[float, dict[str, float]]:
        """The ranking value and the head probabilities behind it."""
        heads = self.heads(features)
        return sum(UTILITY[h] * p for h, p in heads.items()), heads

    def to_payload(self) -> dict[str, object]:
        """JSON-safe form for storage."""
        return {
            "version": self.version,
            "features": list(self.features),
            "weights": {h: dict(w) for h, w in self.weights.items()},
            "metrics": dict(self.metrics),
        }

    @classmethod
    def from_payload(cls, payload: Mapping[str, object]) -> Model:
        """Reads ``to_payload`` output."""
        weights = cast("Mapping[str, Mapping[str, float]]", payload["weights"])
        features = cast("Sequence[str]", payload.get("features", FEATURES))
        metrics = cast("Mapping[str, float]", payload.get("metrics", {}))
        return cls(
            version=str(payload["version"]),
            weights={str(h): {str(k): float(v) for k, v in w.items()} for h, w in weights.items()},
            features=tuple(str(f) for f in features),
            metrics={str(k): float(v) for k, v in metrics.items()},
        )


PRIOR = Model(version=PRIOR_VERSION, weights=_PRIOR_WEIGHTS)
