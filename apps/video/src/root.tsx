import { Composition, Still } from "remotion";
import { FPS } from "./lib/motion";
import { Promo, PROMO_FRAMES } from "./promo";
import { Thumbnail } from "./thumbnail";

export function Root() {
  return (
    <>
      <Composition id="promo" component={Promo} durationInFrames={PROMO_FRAMES} fps={FPS} width={1920} height={1080} />
      <Still id="thumbnail" component={Thumbnail} width={1280} height={720} />
    </>
  );
}
