import { Layers, Lock, Network, Search, Sparkles, Wand2 } from "lucide-react";
import { AbsoluteFill, Html5Audio, Series, staticFile } from "remotion";
import { fontVars } from "./lib/fonts";
import { frames } from "./lib/motion";
import { EndCard, PrivacyShot, ServicesShot, StackShot } from "./scenes/closing";
import { Hook } from "./scenes/hook";
import { NoSqlShot } from "./scenes/nosql";
import { BrowseShot, DiagramShot, FilterShot, QueryShot, SearchShot } from "./scenes/product";
import { Reveal } from "./scenes/reveal";
import { TitleCard } from "./scenes/title-card";
import { Backdrop, Shot } from "./ui/stage";
import "./style.css";

const card = 1000;

const timeline: [number, React.ReactNode][] = [
  [4000, <Hook />],
  [3500, <Reveal />],
  [4000, <Shot><BrowseShot /></Shot>],
  [card, <TitleCard icon={Search} title="Omnisearch" />],
  [3500, <Shot><SearchShot /></Shot>],
  [card, <TitleCard icon={Wand2} title="AI filter" />],
  [6000, <Shot><FilterShot /></Shot>],
  [card, <TitleCard icon={Sparkles} title="AI query" />],
  [6500, <Shot><QueryShot /></Shot>],
  [card, <TitleCard icon={Network} title="Schema diagram" />],
  [4500, <Shot><DiagramShot /></Shot>],
  [card, <TitleCard icon={Layers} title="Beyond SQL" kicker="Redis · MongoDB · Elasticsearch" />],
  [4000, <Shot><NoSqlShot /></Shot>],
  [3500, <ServicesShot />],
  [card, <TitleCard icon={Lock} title="Private by design" />],
  [3000, <PrivacyShot />],
  [3000, <StackShot />],
  [4500, <EndCard />],
];

export const PROMO_FRAMES = timeline.reduce((sum, [d]) => sum + frames(d), 0);

export function Promo() {
  return (
    <AbsoluteFill style={fontVars} className="font-sans">
      <Backdrop />
      <Html5Audio src={staticFile("audio/music.wav")} volume={0.55} />
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
