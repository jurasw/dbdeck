import { loadFont as loadDisplay } from "@remotion/google-fonts/FunnelDisplay";
import { loadFont as loadMono } from "@remotion/google-fonts/GeistMono";

const display = loadDisplay("normal", { weights: ["400", "600", "700", "800"], subsets: ["latin", "latin-ext"] });
const mono = loadMono("normal", { weights: ["400", "500"], subsets: ["latin", "latin-ext"] });

export const fontVars = { ["--font-display" as string]: display.fontFamily, ["--font-geist-mono" as string]: mono.fontFamily };
