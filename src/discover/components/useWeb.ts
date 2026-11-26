"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ease,
  fitView,
  growWeb,
  layoutWeb,
  mixPoints,
  mixViews,
  startWeb,
  type Point,
  type View,
  type Web,
} from "../lib/layout";
import type { GraphData } from "../lib/types";

const MOVE_MS = 550;

type Scene = { web: Web; points: Map<string, Point> };

/** The web as first shown: the starting artist, and anyone the address says was opened. */
function firstScene(start: GraphData, opened: GraphData[]): Scene {
  let scene: Scene = { web: startWeb(start), points: layoutWeb(startWeb(start)) };
  for (const data of opened) {
    const web = growWeb(scene.web, data);
    scene = { web, points: layoutWeb(web, scene.points) };
  }
  return scene;
}

const prefersStill = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A connection web that grows, can be undone, and moves smoothly from one layout to the next. */
export function useWeb(start: GraphData, opened: GraphData[]) {
  const [history, setHistory] = useState<Scene[]>(() => [firstScene(start, opened)]);
  const scene = history[history.length - 1];
  const [shown, setShown] = useState(() => ({
    points: scene.points,
    view: fitView(scene.points.values()),
  }));
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /** Glides from what is on screen to a scene that fits the view. */
  const glide = useCallback((to: Scene, origin: Point) => {
    cancelAnimationFrame(frame.current);
    const target = { points: to.points, view: fitView(to.points.values()) };
    if (prefersStill()) {
      setShown(target);
      return;
    }
    let began = 0;
    let from: typeof target | null = null;
    const step = (now: number) => {
      began ||= now;
      const t = Math.min(1, (now - began) / MOVE_MS);
      setShown((current) => {
        from ??= current;
        if (t === 1) return target;
        return {
          points: mixPoints(from.points, target.points, ease(t), origin),
          view: mixViews(from.view, target.view, ease(t)),
        };
      });
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    // New artists have to be on screen from the first frame, so they begin where they come out.
    setShown((current) => ({
      points: mixPoints(current.points, target.points, 0, origin),
      view: current.view,
    }));
    frame.current = requestAnimationFrame(step);
  }, []);

  const grow = useCallback(
    (data: GraphData) => {
      const web = growWeb(scene.web, data);
      const next = { web, points: layoutWeb(web, scene.points) };
      setHistory((past) => [...past, next]);
      glide(next, scene.points.get(data.center)!); // only artists already on the web open
      return web;
    },
    [scene, glide],
  );

  const undo = useCallback(() => {
    if (history.length < 2) return null;
    const previous = history[history.length - 2];
    setHistory(history.slice(0, -1));
    glide(previous, { x: 0, y: 0 });
    return previous.web;
  }, [history, glide]);

  const setView = useCallback((change: (view: View) => View) => {
    cancelAnimationFrame(frame.current);
    setShown((current) => ({ ...current, view: change(current.view) }));
  }, []);

  const fit = useCallback(() => glide(scene, { x: 0, y: 0 }), [glide, scene]);

  return {
    web: scene.web,
    points: shown.points,
    view: shown.view,
    canUndo: history.length > 1,
    grow,
    undo,
    fit,
    setView,
  };
}
