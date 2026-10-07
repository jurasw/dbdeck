import { Composition } from "remotion";
import { FPS } from "./lib/motion";
import { Promo, PROMO_FRAMES } from "./promo";

export function Root() {
  return <Composition id="promo" component={Promo} durationInFrames={PROMO_FRAMES} fps={FPS} width={1920} height={1080} />;
}
