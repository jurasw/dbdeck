const size = 1024;
const cx = 512;
const rx = 304;
const ry = 76;
const height = 114;
const step = 164;
const top = 286;
const left = cx - rx;
const right = cx + rx;
const slabs = [1, 0.87, 0.74].map((tone, i) => ({ i, y: top + i * step, b: top + i * step + height, tone }));

const gray = value => {
  const c = Math.round(Math.max(0, Math.min(1, value)) * 255);
  return `rgb(${c},${c},${Math.min(255, c + 3)})`;
};

const squircle = (inset = 0, n = 5) => {
  const a = size / 2 - inset;
  const points = Array.from({ length: 360 }, (_, k) => {
    const angle = (k / 360) * Math.PI * 2;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [size / 2 + a * Math.sign(c) * Math.abs(c) ** (2 / n), size / 2 + a * Math.sign(s) * Math.abs(s) ** (2 / n)];
  });
  return "M" + points.map(p => p.map(v => v.toFixed(2)).join(" ")).join("L") + "Z";
};

const side = ({ y, b }) => `M${left} ${y}V${b}A${rx} ${ry} 0 0 0 ${right} ${b}V${y}A${rx} ${ry} 0 0 1 ${left} ${y}Z`;
const body = ({ y, b }) => `M${left} ${y}V${b}A${rx} ${ry} 0 0 0 ${right} ${b}V${y}A${rx} ${ry} 0 0 0 ${left} ${y}Z`;
const bottomArc = ({ b }, lift = 0) => `M${left} ${b - lift}A${rx} ${ry} 0 0 0 ${right} ${b - lift}`;
const ellipseGradient = (id, x, y, r, scale, stops) =>
  `<radialGradient id="${id}" cx="${x}" cy="${y}" r="${r}" gradientUnits="userSpaceOnUse" gradientTransform="translate(${x} ${y}) scale(1 ${scale}) translate(${-x} ${-y})">${stops}</radialGradient>`;

export function iconSvg() {
  const defs = [
    `<clipPath id="tile"><path d="${squircle()}"/></clipPath>`,
    `<linearGradient id="tileFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b1b1d"/><stop offset=".45" stop-color="#0a0a0b"/><stop offset="1" stop-color="#030303"/></linearGradient>`,
    `<radialGradient id="tileSheen" cx="512" cy="-120" r="760" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".55" stop-color="#fff" stop-opacity=".03"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="tileRim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset=".18" stop-color="#fff" stop-opacity=".08"/><stop offset=".8" stop-color="#fff" stop-opacity=".03"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient>`,
    `<filter id="blur2" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2"/></filter>`,
    `<filter id="blur6" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="6"/></filter>`,
    `<filter id="blur14" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="14"/></filter>`,
    `<filter id="aura" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="46"/></filter>`,
    `<linearGradient id="fade" x1="${left}" x2="${right}" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset=".3" stop-color="#fff"/><stop offset=".7" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity=".25"/></linearGradient>`,
    `<mask id="fadeMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="url(#fade)"/></mask>`,
  ];
  const first = slabs[0];
  const last = slabs[slabs.length - 1];
  const art = [
    `<path d="${squircle()}" fill="url(#tileFill)"/>`,
    `<path d="${squircle()}" fill="url(#tileSheen)"/>`,
    `<g clip-path="url(#tile)">`,
    `<path d="${body({ y: first.y, b: last.b })}" fill="#fff" opacity=".14" filter="url(#aura)"/>`,
    `<ellipse cx="${cx}" cy="${last.b + ry + 26}" rx="${rx + 10}" ry="44" fill="#fff" opacity=".07" filter="url(#blur14)"/>`,
  ];
  for (const slab of [...slabs].reverse()) {
    const { i, y, b, tone } = slab;
    const id = `slab${i}`;
    const sideStops = [[0, .46], [.035, .72], [.13, .84], [.28, .91], [.46, .85], [.64, .75], [.82, .66], [.93, .63], [.975, .74], [1, .5]];
    defs.push(
      `<clipPath id="${id}Body"><path d="${body(slab)}"/></clipPath>`,
      `<clipPath id="${id}Top"><ellipse cx="${cx}" cy="${y}" rx="${rx}" ry="${ry}"/></clipPath>`,
      `<linearGradient id="${id}Side" x1="${left}" x2="${right}" y1="0" y2="0" gradientUnits="userSpaceOnUse">${sideStops.map(([offset, value]) => `<stop offset="${offset}" stop-color="${gray(value * tone)}"/>`).join("")}</linearGradient>`,
      `<linearGradient id="${id}Shade" x1="0" x2="0" y1="${y}" y2="${b + ry}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".2" stop-color="#fff" stop-opacity="0"/><stop offset=".55" stop-color="#000" stop-opacity=".13"/><stop offset=".84" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity=".24"/></linearGradient>`,
      `<linearGradient id="${id}Face" x1="${left}" y1="${y - ry}" x2="${right}" y2="${y + ry}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${gray(tone + .02)}"/><stop offset=".55" stop-color="${gray(.93 * tone)}"/><stop offset="1" stop-color="${gray(.84 * tone)}"/></linearGradient>`,
      ellipseGradient(`${id}Depth`, cx, y + 6, rx, ry / rx, `<stop offset="0" stop-color="#000" stop-opacity=".07"/><stop offset=".72" stop-color="#000" stop-opacity="0"/><stop offset=".93" stop-color="#fff" stop-opacity=".14"/><stop offset="1" stop-color="#fff" stop-opacity=".3"/>`),
      ellipseGradient(`${id}Specular`, cx - 70, y - 28, 230, .26, `<stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>`),
      `<linearGradient id="${id}Bevel" x1="0" x2="0" y1="${y - ry}" y2="${y + ry}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".5" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity=".9"/></linearGradient>`,
    );
    if (i < slabs.length - 1) {
      art.push(`<g clip-path="url(#slab${i + 1}Top)"><ellipse cx="${cx}" cy="${b + 4}" rx="${rx - 2}" ry="${ry}" fill="#000" opacity=".82" filter="url(#blur6)"/></g>`);
    }
    art.push(
      `<path d="${side(slab)}" fill="url(#${id}Side)"/>`,
      `<path d="${side(slab)}" fill="url(#${id}Shade)"/>`,
      `<g clip-path="url(#${id}Body)">`,
      `<path d="${bottomArc(slab, 12)}" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="20" filter="url(#blur6)" mask="url(#fadeMask)"/>`,
      `<path d="${bottomArc(slab, 2)}" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="4" filter="url(#blur2)" mask="url(#fadeMask)"/>`,
      `<path d="M${left + 3} ${y}V${b}" stroke="#fff" stroke-opacity=".35" stroke-width="4" filter="url(#blur2)"/>`,
      `<path d="M${right - 3} ${y}V${b}" stroke="#fff" stroke-opacity=".22" stroke-width="4" filter="url(#blur2)"/>`,
      `</g>`,
      `<ellipse cx="${cx}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#${id}Face)"/>`,
      `<ellipse cx="${cx}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#${id}Depth)"/>`,
      `<ellipse cx="${cx}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#${id}Specular)"/>`,
      `<g clip-path="url(#${id}Top)"><ellipse cx="${cx}" cy="${y + 3}" rx="${rx - 14}" ry="${ry - 8}" fill="none" stroke="#000" stroke-opacity=".1" stroke-width="10" filter="url(#blur6)"/></g>`,
      `<ellipse cx="${cx}" cy="${y}" rx="${rx - 3}" ry="${ry - 2}" fill="none" stroke="url(#${id}Bevel)" stroke-width="5" filter="url(#blur2)"/>`,
    );
  }
  art.push(`</g>`, `<path d="${squircle(1.5)}" fill="none" stroke="url(#tileRim)" stroke-width="3"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs>${defs.join("")}</defs>${art.join("")}</svg>\n`;
}

export function markSvg(viewBox = `0 0 ${size} ${size}`) {
  const seams = slabs.slice(0, -1).map(slab =>
    `<path d="${bottomArc(slab)}" fill="none" stroke="black" stroke-width="28"/>`).join("");
  const bodies = slabs.map(slab => `<path d="${body(slab)}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="${viewBox}"><defs><mask id="seams" maskUnits="userSpaceOnUse" x="0" y="0" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="white"/>${seams}</mask></defs><g fill="currentColor" mask="url(#seams)">${bodies}</g></svg>\n`;
}

export const markBounds = { x: left, y: top - ry, width: rx * 2, height: slabs[slabs.length - 1].b + ry - (top - ry) };
