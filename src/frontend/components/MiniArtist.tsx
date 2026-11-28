import { ArrowUpRight } from 'lucide-react';
import { ArtistAvatar, ArtistPicture } from './Artwork';

type Props = {
  artist: { id: string; name: string };
  onClick: () => void;
  subtitle?: string;
  /** Looks up the artist's details for a cover; leave it off for long or speculative lists. */
  picture?: boolean;
};

/** A small artist row that opens the artist. */
export function MiniArtist({ artist, onClick, subtitle, picture = true }: Props) {
  return (
    <button className="mini-entity" onClick={onClick}>
      {picture ? <ArtistPicture artist={artist} size="sm" /> : <ArtistAvatar artist={artist} size="sm" />}
      <span>
        <strong>{artist.name}</strong>
        {subtitle && <small>{subtitle}</small>}
      </span>
      <ArrowUpRight size={15} />
    </button>
  );
}
