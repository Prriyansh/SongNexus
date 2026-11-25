// Combines MusicBrainz collaborators with what Genius and Discogs report, and says in words what
// each source contributed. Pure, so the honest-gaps wording can be tested.
import type { Collaborator, CreditSource, MoreCredits, SourcedCollaborator, SourceReport } from '@/lib/types';

const normalizeName = (name: string) =>
  name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export type MergedCredits = {
  /** MusicBrainz collaborator id → the other sources that list the same name on both artists. */
  confirmed: Map<string, { source: CreditSource; url: string }[]>;
  /** People MusicBrainz didn't show, one row per person even when both sources list them. */
  extra: SourcedCollaborator[];
};

export function mergeSourcedCredits(mutual: Collaborator[], more?: MoreCredits): MergedCredits {
  const byName = new Map(mutual.map(c => [normalizeName(c.name), c.id]));
  const confirmed: MergedCredits['confirmed'] = new Map();
  const extra = new Map<string, SourcedCollaborator>();
  for (const person of more?.collaborators ?? []) {
    const key = normalizeName(person.name);
    const id = byName.get(key);
    if (id) confirmed.set(id, [...(confirmed.get(id) ?? []), { source: person.source, url: person.url }]);
    else if (!extra.has(key)) extra.set(key, person);
  }
  return { confirmed, extra: [...extra.values()] };
}

const reportText = (report: SourceReport) => {
  const scanned = report.scanned && report.unit ? `${report.scanned.a} and ${report.scanned.b} ${report.unit}` : '';
  switch (report.status) {
    case 'ok': return `${report.source}: checked ${scanned}.`;
    case 'partial': return `${report.source}: checked ${scanned} before stopping early, so more may exist.`;
    case 'no-key': return `${report.source} isn’t set up here.`;
    case 'no-match': return `${report.source}: couldn’t confirm both artists there.`;
    case 'failed': return `${report.source} couldn’t be reached.`;
  }
};

/** A sentence per source, so "nobody found" can always be read against what was actually checked. */
export function sourceNote(sources?: SourceReport[], error?: Error): string {
  if (error) return 'Genius and Discogs couldn’t be checked.';
  return (sources ?? []).map(reportText).join(' ');
}
