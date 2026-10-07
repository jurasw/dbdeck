import { loadFont as loadDisplay } from "@remotion/google-fonts/FunnelDisplay";
import { loadFont as loadMono } from "@remotion/google-fonts/GeistMono";
import { Layers, Lock, Network, Search, Sparkles, Wand2 } from "lucide-react";
import { AbsoluteFill, Series } from "remotion";
import { frames } from "./lib/motion";
import { EndCard, PrivacyShot, ServicesShot, StackShot } from "./scenes/closing";
import { Hook } from "./scenes/hook";
import { NoSqlShot } from "./scenes/nosql";
import { BrowseShot, DiagramShot, FilterShot, QueryShot, SearchShot } from "./scenes/product";
import { Reveal } from "./scenes/reveal";
import { TitleCard } from "./scenes/title-card";
import { Backdrop, Shot } from "./ui/stage";
import "./style.css";

const display = loadDisplay("normal", { weights: ["400", "600", "700", "800"], subsets: ["latin", "latin-ext"] });
const mono = loadMono("normal", { weights: ["400", "500"], subsets: ["latin", "latin-ext"] });

const card = 1000;

const timeline: [number, React.ReactNode][] = [
  [3800, <Hook />],
  [3600, <Reveal />],
  [4200, <Shot><BrowseShot /></Shot>],
  [card, <TitleCard icon={Search} title="Omnisearch" />],
  [3600, <Shot><SearchShot /></Shot>],
  [card, <TitleCard icon={Wand2} title="AI filter" />],
  [6200, <Shot><FilterShot /></Shot>],
  [card, <TitleCard icon={Sparkles} title="AI query" />],
  [6600, <Shot><QueryShot /></Shot>],
  [card, <TitleCard icon={Network} title="Schema diagram" />],
  [4600, <Shot><DiagramShot /></Shot>],
  [card, <TitleCard icon={Layers} title="Beyond SQL" kicker="Redis · MongoDB · Elasticsearch" />],
  [3800, <Shot><NoSqlShot /></Shot>],
  [3400, <ServicesShot />],
  [card, <TitleCard icon={Lock} title="Private by design" />],
  [3200, <PrivacyShot />],
  [2800, <StackShot />],
  [4200, <EndCard />],
];

export const PROMO_FRAMES = timeline.reduce((sum, [d]) => sum + frames(d), 0);

export function Promo() {
  return (
    <AbsoluteFill style={{ ["--font-display" as string]: display.fontFamily, ["--font-geist-mono" as string]: mono.fontFamily }} className="font-sans">
      <Backdrop />
      <Series>
        {timeline.map(([d, node], i) => (
          <Series.Sequence key={i} durationInFrames={frames(d)}>
            {node}
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  );
}
