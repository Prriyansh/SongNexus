// "Data sources and licenses": every source the app reads, its terms, and what it's used for.
import { DATA_SOURCES } from '../sources';

export function DataSources() {
  return <details className="data-sources">
    <summary>Data sources and licenses</summary>
    <ul>
      {DATA_SOURCES.map(source => <li key={source.name}>
        <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a>
        {' · '}<a href={source.termsUrl} target="_blank" rel="noreferrer">{source.terms}</a>
        <span>{source.feeds}{source.needsKey && ' (only when its key is set)'}</span>
      </li>)}
    </ul>
  </details>;
}
