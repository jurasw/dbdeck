import { Heading, Lede, Shell } from "./primitives";
import { SearchFigure } from "./animated-figures";

export function Organize() {
  return (
    <section>
      <Shell>
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <Heading lead="Grouped your way." rest="Found in a keystroke." />
            <Lede>Paste a connection URL from Neon, Supabase or PlanetScale, or pick a SQLite file. The form fills itself.</Lede>
          </div>
          <div className="relative lg:col-span-7">
            <div aria-hidden className="pointer-events-none absolute inset-0 rounded-full bg-brand/10 blur-3xl" />
            <SearchFigure className="relative mx-auto max-w-[520px]" />
          </div>
        </div>
      </Shell>
    </section>
  );
}
