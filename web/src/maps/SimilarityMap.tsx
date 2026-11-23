/**
 * The similar-music map: avatars placed by how similar they are, lines that mean "listeners
 * connect these" (never a credit), and a card that says why anything is there. Ported from the
 * team app's Connection Web canvas (Helen's map and camera): drag to pan, scroll or +/- to zoom,
 * arrow keys to move, 0 to reset. Cards keep their pixel size while the map scales, so zooming
 * in makes room for more names; zooming in near an artist can load more around it (`onExplore`).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import {Icon} from '../components/Icon';
import {useI18n} from '../i18n/i18n';

import {
  initialCamera,
  MAX_ZOOM,
  MIN_ZOOM,
  nodeOpacity,
  seedOf,
  toScreen,
  zoomCamera,
  type Camera,
  type MapLink,
  type Placed,
} from './layout';

/** Zooming in this far near an artist asks for more around it. */
export const EXPLORE_ZOOM = 1.3;
const OVERSCAN = 160;
const AVATAR = {center: 40, other: 28};

interface Props {
  /** Where everything goes for a map size; keep it stable between renders. */
  place: (width: number, height: number) => Placed[];
  lines: readonly MapLink[];
  label: string;
  /** The explanation card's body for a node. */
  explain: (node: Placed) => ReactNode;
  /** Buttons on a pinned card. */
  actions: (node: Placed) => ReactNode;
  /** Where the camera starts, for maps wider than the view. */
  startAt?: (width: number) => Camera;
  onExplore?: ((node: Placed, zoom: number) => void) | undefined;
  status?: ReactNode;
  legend?: ReactNode;
}

function Avatar({node}: {node: Placed}) {
  const initial = [...node.displayName.trim()][0]?.toUpperCase() ?? '?';
  const style = {
    '--smap-hue': Math.round(seedOf(node.id) * 360),
  } as CSSProperties;
  return (
    <span
      className={`smap__avatar${node.kind === 'SONG' ? ' smap__avatar--song' : ''}`}
      style={style}
    >
      {node.imageUrl ? (
        <img src={node.imageUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </span>
  );
}

const inView = (
  p: {x: number; y: number},
  size: {width: number; height: number},
  pad = 0,
) =>
  p.x >= -pad &&
  p.x <= size.width + pad &&
  p.y >= -pad &&
  p.y <= size.height + pad;

export function SimilarityMap({
  place,
  lines,
  label,
  explain,
  actions,
  startAt,
  onExplore,
  status,
  legend,
}: Props) {
  const {t} = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({width: 900, height: 560});
  const [camera, setCamera] = useState<Camera>(initialCamera);
  const cameraRef = useRef(camera);
  const drag = useRef<{
    x: number;
    y: number;
    from: Camera;
    moved: boolean;
  } | null>(null);
  const exploreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  const move = useCallback((next: Camera) => {
    cameraRef.current = next;
    setCamera(next);
  }, []);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const resize = () => {
      const {width, height} = element.getBoundingClientRect();
      if (width > 0 && height > 0)
        setSize(s =>
          s.width === width && s.height === height ? s : {width, height},
        );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const start = useCallback(
    (width: number) => startAt?.(width) ?? initialCamera(),
    [startAt],
  );
  useEffect(() => {
    move(start(box.current?.getBoundingClientRect().width || 900));
  }, [start, move]);

  const nodes = useMemo(() => place(size.width, size.height), [place, size]);
  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  /** The node nearest a screen point, for zoom-in discovery. */
  const nearestTo = useCallback(
    (point: {x: number; y: number}, at: Camera) => {
      let best: Placed | null = null;
      let distance = Infinity;
      for (const node of nodes) {
        const s = toScreen(node, at);
        const d = Math.hypot(s.x - point.x, s.y - point.y);
        if (d < distance) {
          distance = d;
          best = node;
        }
      }
      return best;
    },
    [nodes],
  );

  const zoomAt = useCallback(
    (factor: number, focal: {x: number; y: number}) => {
      const next = zoomCamera(
        cameraRef.current,
        cameraRef.current.zoom * factor,
        focal,
      );
      move(next);
      if (!onExplore || factor <= 1 || next.zoom < EXPLORE_ZOOM) return;
      if (exploreTimer.current) clearTimeout(exploreTimer.current);
      exploreTimer.current = setTimeout(() => {
        const node = nearestTo(focal, next);
        if (node && node.kind === 'ARTIST' && node.artist)
          onExplore(node, next.zoom);
      }, 160);
    },
    [move, onExplore, nearestTo],
  );

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('.smap__card')) return;
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const c = cameraRef.current;
        move({...c, x: c.x - (event.deltaX || event.deltaY)});
        return;
      }
      zoomAt(Math.exp(-event.deltaY * (event.ctrlKey ? 0.006 : 0.0015)), {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
    };
    element.addEventListener('wheel', wheel, {passive: false});
    return () => element.removeEventListener('wheel', wheel);
  }, [move, zoomAt]);

  useEffect(
    () => () => {
      if (exploreTimer.current) clearTimeout(exploreTimer.current);
    },
    [],
  );

  const middle = {x: size.width / 2, y: size.height / 2};
  const reset = () => {
    move(start(size.width));
    setPinned(null);
  };

  const present = nodes
    .map(node => ({
      node,
      shown: nodeOpacity(node, camera.zoom),
      screen: toScreen(node, camera),
    }))
    .filter(item => item.node.isCenter || inView(item.screen, size, OVERSCAN));
  const opacity = new Map(present.map(p => [p.node.id, p.shown]));
  const focus = hover ?? pinned;
  const card = focus ? byId.get(focus) : undefined;
  const preview = !!card && card.id !== pinned;
  const scaled = {x: 0, y: 0, zoom: camera.zoom};

  return (
    <div
      className="smap"
      ref={box}
      tabIndex={0}
      role="application"
      aria-label={label}
      aria-roledescription={t('map.roleDescription')}
      data-panning={drag.current?.moved || undefined}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          setPinned(null);
          return;
        }
        if (event.target !== event.currentTarget) return;
        const steps: Record<string, [number, number]> = {
          ArrowLeft: [40, 0],
          ArrowRight: [-40, 0],
          ArrowUp: [0, 40],
          ArrowDown: [0, -40],
        };
        const step = steps[event.key];
        if (step) {
          event.preventDefault();
          const c = cameraRef.current;
          move({...c, x: c.x + step[0], y: c.y + step[1]});
        } else if (['+', '=', '-', '0'].includes(event.key)) {
          event.preventDefault();
          if (event.key === '0') reset();
          else zoomAt(event.key === '-' ? 1 / 1.35 : 1.35, middle);
        }
      }}
      onPointerDown={event => {
        if (
          event.button !== 0 ||
          (event.target as Element).closest('.smap__controls, .smap__card, a')
        )
          return;
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          from: cameraRef.current,
          moved: false,
        };
      }}
      onPointerMove={event => {
        const d = drag.current;
        if (!d) return;
        if (
          !d.moved &&
          Math.hypot(event.clientX - d.x, event.clientY - d.y) < 4
        )
          return;
        if (!d.moved) {
          d.moved = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setHover(null);
        }
        move({
          ...d.from,
          x: d.from.x + event.clientX - d.x,
          y: d.from.y + event.clientY - d.y,
        });
      }}
      onPointerUp={event => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved && !(event.target as Element).closest('.smap__node'))
          setPinned(null);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onClickCapture={event => {
        if (drag.current?.moved) event.stopPropagation();
      }}
    >
      <div
        className="smap__grid"
        style={{
          backgroundPosition: `${camera.x}px ${camera.y}px`,
          backgroundSize: `${28 * camera.zoom}px ${28 * camera.zoom}px`,
        }}
        aria-hidden="true"
      />
      <div
        className="smap__world"
        style={{
          width: size.width,
          height: size.height,
          transform: `translate3d(${camera.x}px, ${camera.y}px, 0)`,
        }}
      >
        <svg className="smap__lines" aria-hidden="true">
          {lines.map(line => {
            const a = byId.get(line.a);
            const b = byId.get(line.b);
            if (!a || !b) return null;
            if (!Math.min(opacity.get(a.id) ?? 0, opacity.get(b.id) ?? 0))
              return null;
            const p = toScreen(a, scaled);
            const q = toScreen(b, scaled);
            const length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
            const ra = a.isCenter ? AVATAR.center : AVATAR.other;
            const rb = b.isCenter ? AVATAR.center : AVATAR.other;
            const touches = !!focus && (line.a === focus || line.b === focus);
            return (
              <line
                key={`${line.kind}:${line.a}:${line.b}`}
                className={`smap__line smap__line--${line.kind.toLowerCase()}${touches ? ' is-lit' : ''}${focus && !touches ? ' is-muted' : ''}`}
                style={
                  {'--strength': 0.15 + line.strength * 0.45} as CSSProperties
                }
                x1={p.x + ((q.x - p.x) / length) * ra}
                y1={p.y + ((q.y - p.y) / length) * ra}
                x2={q.x - ((q.x - p.x) / length) * rb}
                y2={q.y - ((q.y - p.y) / length) * rb}
              />
            );
          })}
        </svg>
        {present.map(({node, shown, screen}) => {
          const point = toScreen(node, scaled);
          const visible = shown > 0.5 && inView(screen, size);
          return (
            <button
              key={node.id}
              type="button"
              className={`smap__node smap__node--${node.group.toLowerCase()}${node.isCenter ? ' smap__node--center' : ''}${pinned === node.id ? ' is-pinned' : ''}`}
              style={
                {
                  left: point.x,
                  top: point.y,
                  '--shown': shown,
                  pointerEvents: shown > 0.1 ? undefined : 'none',
                } as CSSProperties
              }
              tabIndex={visible ? 0 : -1}
              aria-pressed={pinned === node.id}
              aria-label={t(
                node.isCenter ? 'map.node.center' : 'map.node.why',
                {
                  name: node.displayName,
                },
              )}
              data-node-id={node.id}
              onPointerEnter={() => !drag.current?.moved && setHover(node.id)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(node.id)}
              onBlur={() => setHover(null)}
              onClick={() => setPinned(node.id)}
            >
              <Avatar node={node} />
              <strong>{node.displayName}</strong>
              {node.subtitle && <small>{node.subtitle}</small>}
            </button>
          );
        })}
      </div>
      {card && (
        <section
          className={`smap__card${preview ? ' is-preview' : ''}`}
          aria-label={t('map.card.label', {name: card.displayName})}
        >
          {!preview && (
            <button
              type="button"
              className="smap__close"
              aria-label={t('map.card.close')}
              onClick={() => setPinned(null)}
            >
              <Icon name="close" />
            </button>
          )}
          <h3>{card.displayName}</h3>
          {card.subtitle && <p className="smap__card-sub">{card.subtitle}</p>}
          {explain(card)}
          {!preview && <div className="smap__actions">{actions(card)}</div>}
        </section>
      )}
      {status}
      {legend}
      <div className="smap__controls">
        <button
          type="button"
          aria-label={t('map.zoomOut')}
          disabled={camera.zoom <= MIN_ZOOM}
          onClick={() => zoomAt(1 / 1.35, middle)}
        >
          <Icon name="remove" />
        </button>
        <output aria-label={t('map.zoomLevel')}>
          {Math.round(camera.zoom * 100)}%
        </output>
        <button
          type="button"
          aria-label={t('map.zoomIn')}
          disabled={camera.zoom >= MAX_ZOOM}
          onClick={() => zoomAt(1.35, middle)}
        >
          <Icon name="add" />
        </button>
        <button type="button" aria-label={t('map.fit')} onClick={reset}>
          <Icon name="fit" />
        </button>
      </div>
    </div>
  );
}
