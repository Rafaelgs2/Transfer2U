// Generates every logo asset from one drawing. Run after changing the mark:
//   node scripts/generate-icons.mjs
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const FIELD = "#1f4bff";
const PAPER = "#fffdf7";
const INK = "#111111";

// Drawn on a 16x16 grid: every stroke lands on a whole pixel, so it stays sharp in a browser tab.
const mark = `
  <path fill="${INK}" d="M1 1H15V3H1Z"/>
  <path fill="${PAPER}" d="M2 3H14V14L13 15L12 14L11 15L10 14L9 15L8 14L7 15L6 14L5 15L4 14L3 15L2 14Z"/>
  <path fill="${INK}" d="M3 5H7V9H4V11H7V12H3V8H6V6H3Z"/>
  <path fill="${INK}" d="M9 5H10V11H12V5H13V12H9Z"/>`;

// At tab size a diagonal tear blurs into a gray line, so the teeth become single pixels.
const tinyMark = mark.replace(
  /d="M2 3H14V14[^"]*"/,
  'd="M2 3H14V14H13V15H12V14H11V15H10V14H9V15H8V14H7V15H6V14H5V15H4V14H3V15H2Z"',
);

/** `scale` below 1 leaves room around the mark, for platforms that crop the icon. */
function svg(scale = 1, drawing = mark) {
  const offset = (16 - 16 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <rect width="16" height="16" fill="${FIELD}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">${drawing}
  </g>
</svg>
`;
}

const png = (source, size) =>
  sharp(Buffer.from(source), { density: 72 * Math.ceil(size / 16) })
    .resize(size, size, { kernel: size <= 64 ? "nearest" : "lanczos3" })
    .flatten({ background: FIELD })
    .ensureAlpha() // PNGs inside an .ico must be RGBA, or Next refuses the file
    .png()
    .toBuffer();

/** An .ico file is a small header plus the PNGs it holds. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

await mkdir("public/icons", { recursive: true });

await writeFile("public/logo.svg", svg());
await writeFile("app/icon.svg", svg(1, tinyMark)); // browsers use this one for the tab
await writeFile(
  "app/favicon.ico",
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(svg(1, size < 48 ? tinyMark : mark), size) })))),
);
await writeFile("app/apple-icon.png", await png(svg(0.86), 180));
await writeFile("public/icons/icon-192.png", await png(svg(), 192));
await writeFile("public/icons/icon-512.png", await png(svg(), 512));
// Android crops adaptive icons to a circle or a squircle: the mark must fit its middle 80%.
await writeFile("public/icons/icon-maskable-512.png", await png(svg(0.68), 512));

console.log("Ícones gerados.");
