# Song Compare

Compare two songs on sound, structure, credits and lyrics.

## Setup
    pip install -r requirements.txt

## 1. Get the data
Spotify tracks (Kaggle): https://www.kaggle.com/datasets/maharshipandya/-spotify-tracks-dataset
Download dataset.csv into data/raw/.

Genius lyrics (Hugging Face): https://huggingface.co/datasets/theelderemo/genius-lyrics-cleaned
Either download the parquet files into data/raw/genius/ or let the script stream them with --hf.

## 2. Build the catalog (one time)
    python prepare_data.py --spotify data/raw/dataset.csv --genius data/raw/genius
    # or stream lyrics instead of downloading:
    python prepare_data.py --spotify data/raw/dataset.csv --hf

It prints and saves the match rate (data/processed/match_report.json).

## 3. Run
    python backend/app.py
Open http://localhost:5000

## No data yet? Try the demo
    python make_demo_data.py
    python prepare_data.py --spotify data/raw/demo_spotify.csv --genius data/raw/demo_genius.csv

## Lyrics and copyright
Raw lyric text is only held in memory during prepare_data.py. What is saved and served is derived
numbers (sentiment, themes, structure, vectors). Check the license terms of the lyrics source for
your use, as the dataset notes lyrics remain copyrighted by their owners.
