import { Html5Audio, Sequence, staticFile } from "remotion";
import { frames } from "../lib/motion";

export type SfxName = "swish" | "tick" | "ding" | "blip";

export function Sfx({ name, at, volume = 1 }: { name: SfxName; at: number; volume?: number }) {
  return (
    <Sequence from={frames(at)} layout="none">
      <Html5Audio src={staticFile(`audio/${name}.wav`)} volume={volume} />
    </Sequence>
  );
}
