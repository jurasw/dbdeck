import { easeInOut, keys, ramp, type Key } from "../lib/motion";

export type CursorKey = Key & { x: number; y: number };

export function Cursor({ t, path, clicks = [] }: { t: number; path: CursorKey[]; clicks?: number[] }) {
  const x = keys(t, path, "x", easeInOut);
  const y = keys(t, path, "y", easeInOut);
  const shown = ramp(t, path[0].at - 250, 250);
  const click = clicks.find((c) => t >= c && t < c + 450);
  const press = click === undefined ? 0 : 1 - Math.abs((t - click) / 110 - 1);
  const ring = click === undefined ? 0 : (t - click) / 450;
  return (
    <div className="pointer-events-none absolute top-0 left-0 z-50" style={{ transform: `translate(${x}px, ${y}px)`, opacity: shown }}>
      {click !== undefined && (
        <span
          className="absolute rounded-full border-2 border-brand"
          style={{
            width: 44,
            height: 44,
            left: -22,
            top: -22,
            opacity: 1 - ring,
            transform: `scale(${0.3 + ring * 0.9})`,
          }}
        />
      )}
      <svg
        width={30}
        height={30}
        viewBox="0 0 24 24"
        style={{ transform: `scale(${1 - Math.max(0, press) * 0.18})`, transformOrigin: "4px 3px", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.55))" }}
      >
        <path d="M4.5 2.8 19 11.2l-6.4 1.6-3.3 6.1L4.5 2.8Z" fill="#fff" stroke="#0b0f19" strokeWidth={1.4} strokeLinejoin="round" />
      </svg>
    </div>
  );
}
