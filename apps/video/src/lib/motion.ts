import { Easing, interpolate } from "remotion";

export const FPS = 60;

export const ms = (frame: number) => (frame / FPS) * 1000;
export const frames = (millis: number) => Math.round((millis / 1000) * FPS);

export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
export const easeIn = Easing.bezier(0.7, 0, 0.84, 0);

export function typed(text: string, t: number, start: number, msPerChar: number) {
  return text.slice(0, Math.max(0, Math.floor((t - start) / msPerChar)));
}

export function between(t: number, a: number, b: number) {
  return t >= a && t < b;
}

export function ramp(t: number, start: number, dur: number, easing = easeOut) {
  return interpolate(t, [start, start + dur], [0, 1], { easing, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

export function mix(a: number, b: number, p: number) {
  return a + (b - a) * p;
}

export type Key = { at: number } & Record<string, number>;

export function keys(t: number, list: Key[], prop: string, easing = easeInOut) {
  if (t <= list[0].at) return list[0][prop];
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    if (t <= b.at) {
      const p = easing((t - a.at) / (b.at - a.at));
      return mix(a[prop] ?? 0, b[prop] ?? a[prop] ?? 0, p);
    }
  }
  return list[list.length - 1][prop];
}

export function pulse(t: number, period = 1400) {
  return 0.55 + 0.45 * Math.cos((t / period) * Math.PI * 2);
}

export function spin(t: number) {
  return `rotate(${(t * 0.45) % 360}deg)`;
}

export function rise(t: number, start: number, dur = 500, dist = 6) {
  const p = ramp(t, start, dur);
  return { opacity: p, transform: `translateY(${(1 - p) * dist}px)` };
}
