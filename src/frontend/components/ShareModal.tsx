import { useState } from 'react';
import { Check, Copy, Info, Share2, X } from 'lucide-react';
import { detailsOf } from '../api';
import type { MusicProfile } from '../profile';
import type { Route } from '../routing';
import { shareLabel, shareSubject, shareUrl } from '../share';
import { nameOf } from '../types';
import type { Details } from '../types';
import { useAsync } from '../useAsync';
import { Modal } from './Modal';

/** Copies `text`; where the Clipboard API is refused, falls back to selecting it and copying. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    const copied = document.execCommand('copy');
    el.remove();
    return copied;
  }
}

/** The Share dialog: a link to this page's music (or About Me), with an optional note. */
export function ShareModal({ route, profile, onClose }: { route: Route; profile: MusicProfile; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const subject = shareSubject(route);
  const ids = subject.what === 'web' || subject.what === 'comparison' ? subject.ids : [];
  const kind = 'kind' in subject ? subject.kind : 'artist';
  const first = useAsync<Details>(ids[0] ? `${kind}:${ids[0]}` : null, () => detailsOf(kind, ids[0]!));
  const second = useAsync<Details>(ids[1] ? `${kind}:${ids[1]}` : null, () => detailsOf(kind, ids[1]!));
  const url = shareUrl(route, profile, note, window.location);
  const sharingProfile = subject.what === 'profile';

  const copy = async () => {
    const done = await copyText(url);
    setCopied(done);
    setCopyError(!done);
  };

  return (
    <Modal onClose={onClose} label={sharingProfile ? 'Share music profile' : 'Share music comparison'}>
      <div className="modal-heading">
        <div className="share-emblem">
          <Share2 size={23} />
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close share">
          <X size={19} />
        </button>
      </div>
      <h2>{sharingProfile ? 'Share your About Me.' : 'Pass the connection along.'}</h2>
      <p className="share-pair">{shareLabel(subject, profile, [nameOf(first.data), nameOf(second.data)])}</p>
      <p>
        {sharingProfile
          ? 'Copy a snapshot of your favorite artists, genres, albums, and songs. Anyone with the link can view it.'
          : route.page === 'connections'
            ? 'Copy a link to this Connection Web and its selected music.'
            : 'Copy a link to this comparison and its role filter.'}
      </p>
      <label className="field-label" htmlFor="share-note">
        OPTIONAL MESSAGE
      </label>
      <textarea
        id="share-note"
        maxLength={300}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setCopied(false);
        }}
        placeholder={sharingProfile ? 'A little about my music taste...' : 'This is why these two sound so familiar...'}
      />
      <label className="field-label" htmlFor="share-url">
        LINK
      </label>
      <input id="share-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
      {copyError && (
        <p className="error-text" role="alert">
          Copy was unavailable. Select the link above and copy it manually.
        </p>
      )}
      <div className="share-actions">
        <button className="primary-button" onClick={() => void copy()}>
          {copied ? <Check size={17} /> : <Copy size={17} />} {copied ? 'Copied!' : 'Copy link'}
        </button>
        {typeof navigator.share === 'function' && (
          <button
            className="secondary-button"
            onClick={() =>
              void navigator
                .share({ title: sharingProfile ? 'Song Nexus music profile' : 'Song Nexus comparison', url, text: note })
                .catch(() => {})
            }
          >
            <Share2 size={16} /> Share via...
          </button>
        )}
      </div>
      <p className="fine-print">
        <Info size={15} />
        {sharingProfile
          ? 'The link carries the snapshot itself, so it opens the same About Me for anyone.'
          : 'The link opens this comparison for anyone, on any device.'}
      </p>
    </Modal>
  );
}
