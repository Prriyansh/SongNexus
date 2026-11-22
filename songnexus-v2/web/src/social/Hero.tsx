/**
 * The hero at the top of the personal and social pages (Around you, Friends,
 * Library, You, About, Privacy): an overline, the page's largest type, one
 * line of what it is, the primary action, and art on the end side. It takes
 * the color of its subject through `--hue` (the same hash as covers).
 */
import {useId, type CSSProperties, type ReactNode} from 'react';

import {hueOf} from '../components/ArtistRow';
import {Icon, type IconName} from '../components/Icon';

export function Hero({
  overline,
  icon,
  title,
  titleId,
  body,
  actions,
  footnote,
  art,
  hue,
  compact = false,
}: {
  overline: string;
  icon?: IconName;
  title: ReactNode;
  titleId?: string;
  body?: ReactNode;
  actions?: ReactNode;
  /** A quiet line under the actions (a privacy promise, a source). */
  footnote?: ReactNode;
  /** Decorative: hidden from assistive technology. */
  art?: ReactNode;
  /** A name (hashed like a cover) or a hue in degrees. */
  hue?: string | number;
  /** A shorter hero for secondary pages (About, Privacy). */
  compact?: boolean;
}) {
  const h = typeof hue === 'number' ? hue : hue ? hueOf(hue) : undefined;
  return (
    <section
      className={compact ? 'p-hero p-hero--compact' : 'p-hero'}
      aria-labelledby={titleId}
      style={h === undefined ? undefined : ({'--hue': h} as CSSProperties)}
    >
      <div className="p-hero__text">
        <p className="stage__overline">
          {icon && <Icon name={icon} />}
          {overline}
        </p>
        <h1 className="p-hero__title" id={titleId}>
          {title}
        </h1>
        {body && <div className="p-hero__body">{body}</div>}
        {actions && <div className="p-hero__actions">{actions}</div>}
        {footnote && <div className="p-hero__footnote">{footnote}</div>}
      </div>
      {art && (
        <div className="p-hero__art" aria-hidden="true">
          {art}
        </div>
      )}
    </section>
  );
}

/** A one-line promise with a shield: "Opt-in. Counts as ranges. Never who plays what." */
export function PromiseLine({children}: {children: ReactNode}) {
  return (
    <p className="promise">
      <Icon name="shield" />
      <span>{children}</span>
    </p>
  );
}

/** Concentric rings with a pin at the center and a few listeners around it. */
export function RadarArt({names = []}: {names?: string[]}) {
  return (
    <div className="radar">
      <span className="radar__ring" />
      <span className="radar__ring" />
      <span className="radar__ring" />
      <span className="radar__pulse" />
      <span className="radar__pin">
        <Icon name="place" />
      </span>
      {names.slice(0, 5).map((name, i) => (
        <span
          key={`${name}-${i}`}
          className="radar__dot"
          data-i={i}
          style={{'--hue': hueOf(name)} as CSSProperties}
        />
      ))}
    </div>
  );
}

/* The globe's geometry, in a viewBox centered on 0,0. Latitudes are ellipses
   squashed by the tilt; meridians are ellipses narrowing toward the edge. */
const R = 80;
const TILT = (20 * Math.PI) / 180;
const LATITUDES = [-60, -30, 0, 30, 60].map(deg => {
  const phi = (deg * Math.PI) / 180;
  return {
    deg,
    cy: -R * Math.sin(phi) * Math.cos(TILT),
    rx: R * Math.cos(phi),
    ry: R * Math.cos(phi) * Math.sin(TILT),
  };
});
const MERIDIANS = [30, 60].map(deg => R * Math.sin((deg * Math.PI) / 180));
/* Abstract land masses: shapes that read as "map" without being a real one. */
const LAND = [
  'M-52 -38c14-12 34-14 44-4s2 22-10 26-10 16-24 14-26-8-24-18 6-10 14-18z',
  'M8 -60c16-6 36 0 42 12s-6 20-18 18-14 10-26 6-10-14-6-22 2-10 8-14z',
  'M14 6c18-4 34 6 36 20s-10 30-24 34-20-6-22-20-8-30 10-34z',
  'M-58 22c10-4 22 2 24 12s-6 18-16 18-18-6-18-14 2-12 10-16z',
];

/** A stylised globe with a pin dropped on it: where "Around you" begins. */
export function GlobeArt() {
  const id = useId();
  const fill = `${id}-fill`;
  const clip = `${id}-clip`;
  return (
    <div className="globe">
      <svg className="globe__svg" viewBox="-100 -100 200 200">
        <defs>
          <radialGradient id={fill} cx="35%" cy="30%" r="80%">
            <stop offset="0%" className="globe__stop-light" />
            <stop offset="100%" className="globe__stop-dark" />
          </radialGradient>
          <clipPath id={clip}>
            <circle r={R} />
          </clipPath>
        </defs>
        <circle className="globe__halo" r={R + 8} />
        <circle className="globe__sphere" r={R} fill={`url(#${fill})`} />
        <g clipPath={`url(#${clip})`}>
          {LAND.map(d => (
            <path key={d} className="globe__land" d={d} />
          ))}
          {LATITUDES.map(({deg, cy, rx, ry}) => (
            <ellipse
              key={deg}
              className={
                deg === 0 ? 'globe__line globe__line--equator' : 'globe__line'
              }
              cy={cy}
              rx={rx}
              ry={ry}
            />
          ))}
          <line className="globe__line" y1={-R} y2={R} />
          {MERIDIANS.map(rx => (
            <ellipse key={rx} className="globe__line" rx={rx} ry={R} />
          ))}
        </g>
        <circle className="globe__rim" r={R} />
        <ellipse className="globe__spot" cx="22" cy="-14" rx="14" ry="5" />
        <ellipse className="globe__pulse" cx="22" cy="-14" rx="14" ry="5" />
      </svg>
      <span className="globe__pin">
        <Icon name="place" />
      </span>
    </div>
  );
}

/** A labelled section with a large title, used on every personal page. */
export function Block({
  id,
  eyebrow,
  title,
  action,
  children,
  className,
}: {
  id: string;
  eyebrow?: string | undefined;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={className ? `block ${className}` : 'block'}
      aria-labelledby={id}
    >
      <div className="block__header">
        <div className="shelf__titles">
          {eyebrow && <p className="shelf__eyebrow">{eyebrow}</p>}
          <h2 id={id} className="block__title">
            {title}
          </h2>
        </div>
        {action && <div className="block__action">{action}</div>}
      </div>
      {children}
    </section>
  );
}
