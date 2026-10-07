import { AbsoluteFill } from "remotion";
import { ramp } from "../lib/motion";
import { Cursor, type CursorKey } from "../ui/cursor";
import { Sfx } from "../ui/sfx";
import { Camera, useShot, type CamKey } from "../ui/stage";
import { filterAt, queryAt, Workbench, WORKBENCH, type SceneId } from "../ui/workbench";

function ProductShot({
  scene,
  camera,
  cursor,
  clicks = [],
  caption,
  chimes = [],
}: {
  scene: SceneId;
  camera: CamKey[];
  cursor?: CursorKey[];
  clicks?: number[];
  caption: string;
  chimes?: number[];
}) {
  const { t, dur } = useShot();
  const cap = ramp(t, 250, 500) * (1 - ramp(t, dur - 400, 300));
  return (
    <AbsoluteFill>
      <Camera t={t} path={camera} width={WORKBENCH.width} height={WORKBENCH.height}>
        <Workbench scene={scene} t={t} reveal={scene === "browse" ? t : Infinity} />
        {cursor && <Cursor t={t} path={cursor} clicks={clicks} />}
      </Camera>
      <AbsoluteFill className="items-center justify-end pb-12">
        <div
          className="rounded-full border border-white/10 bg-black/55 px-6 py-2.5 font-mono text-[22px] tracking-[0.18em] text-foreground/90 uppercase backdrop-blur-md"
          style={{ opacity: cap, transform: `translateY(${(1 - cap) * 14}px)` }}
        >
          {caption}
        </div>
      </AbsoluteFill>
      {clicks.map((at) => <Sfx key={`c${at}`} name="tick" at={at} volume={0.18} />)}
      {chimes.map((at) => <Sfx key={`h${at}`} name="ding" at={at} volume={0.14} />)}
    </AbsoluteFill>
  );
}

export function BrowseShot() {
  return (
    <ProductShot
      scene="browse"
      caption="Every connection in your sidebar"
      camera={[
        { at: 0, x: 0, y: 30, s: 1.05, rx: 24 },
        { at: 1500, x: 0, y: 0, s: 1.6, rx: 0 },
        { at: 4200, x: 40, y: 10, s: 1.72, rx: 0 },
      ]}
      cursor={[
        { at: 250, x: 380, y: 360 },
        { at: 900, x: 100, y: 198 },
        { at: 2400, x: 100, y: 198 },
        { at: 3400, x: 560, y: 330 },
      ]}
      clicks={[1000]}
    />
  );
}

export function SearchShot() {
  return (
    <ProductShot
      scene="search"
      caption="Omnisearch finds any table"
      camera={[
        { at: 0, x: -150, y: -160, s: 2.1 },
        { at: 500, x: -120, y: -150, s: 2.1 },
        { at: 1100, x: 115, y: -105, s: 2.35 },
        { at: 2600, x: 115, y: -100, s: 2.4 },
        { at: 3600, x: 60, y: 0, s: 1.75 },
      ]}
      cursor={[
        { at: 0, x: 120, y: 150 },
        { at: 380, x: 196, y: 56 },
        { at: 900, x: 196, y: 56 },
        { at: 1600, x: 420, y: 260 },
      ]}
      clicks={[420, 2500]}
    />
  );
}

export function FilterShot() {
  return (
    <ProductShot
      scene="filter"
      caption="Plain words become a WHERE clause"
      camera={[
        { at: 0, x: -10, y: -105, s: 2.25 },
        { at: filterAt.generated + 200, x: 30, y: -105, s: 2.3 },
        { at: filterAt.apply - 100, x: 180, y: -100, s: 2.2 },
        { at: filterAt.filtered + 600, x: 40, y: 10, s: 1.62 },
        { at: filterAt.filtered + 2400, x: 40, y: 20, s: 1.68 },
      ]}
      cursor={[
        { at: 900, x: 640, y: 240 },
        { at: filterAt.sparkle - 100, x: 735, y: 128 },
        { at: filterAt.generated + 300, x: 735, y: 128 },
        { at: filterAt.apply - 80, x: 958, y: 128 },
        { at: filterAt.filtered + 900, x: 900, y: 330 },
      ]}
      clicks={[filterAt.sparkle, filterAt.apply]}
      chimes={[filterAt.generated]}
    />
  );
}

export function QueryShot() {
  return (
    <ProductShot
      scene="query"
      caption="Describe it. Get ready-to-run SQL."
      camera={[
        { at: 0, x: 90, y: -80, s: 2.05 },
        { at: queryAt.generate + 200, x: 120, y: -70, s: 2.1 },
        { at: queryAt.stream + 600, x: 70, y: 20, s: 1.85 },
        { at: queryAt.open, x: 40, y: 50, s: 1.8 },
        { at: queryAt.results + 800, x: 30, y: 60, s: 1.62 },
      ]}
      cursor={[
        { at: 800, x: 760, y: 300 },
        { at: queryAt.generate - 100, x: 925, y: 230 },
        { at: queryAt.stream + 400, x: 925, y: 230 },
        { at: queryAt.open - 100, x: 310, y: 418 },
        { at: queryAt.results + 900, x: 520, y: 470 },
      ]}
      clicks={[queryAt.generate, queryAt.open]}
      chimes={[queryAt.results]}
    />
  );
}

export function DiagramShot() {
  return (
    <ProductShot
      scene="diagram"
      caption="Your schema, drawn for you"
      camera={[
        { at: 0, x: 80, y: 20, s: 1.3, ry: -18, rx: 8 },
        { at: 1600, x: 110, y: 20, s: 1.7, ry: 0, rx: 0 },
        { at: 4600, x: 120, y: 10, s: 1.85, ry: 0, rx: 0 },
      ]}
    />
  );
}
