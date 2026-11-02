import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Transfer2U: imprime aqui, recebe lá. Textos e arquivos entre aparelhos, sem cadastro.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const FIELD = "#1f4bff";
const PAPER = "#fffdf7";
const INK = "#111111";

// The picture shown when a link is shared: same printer bar, tape and logotype as the site.
export default async function OpengraphImage() {
  const font = await readFile(join(process.cwd(), "assets/fonts/MartianMono-ExtraBold.ttf"));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: FIELD,
          color: "#fff",
          fontFamily: "Martian Mono",
          padding: "70px 56px 48px",
        }}
      >
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 22, background: INK, display: "flex" }} />

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1 }}>
          <div style={{ display: "flex", fontSize: 104, letterSpacing: -6 }}>
            Transfer<span style={{ color: INK }}>2U</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 58, lineHeight: 1.08, letterSpacing: -3 }}>
            <span>Imprime aqui.</span>
            <span>Recebe lá.</span>
          </div>
        </div>

        {/* A strip of the receipt, torn off below the edge. */}
        <div
          style={{
            position: "absolute",
            top: 22,
            right: 56,
            width: 250,
            height: 608,
            display: "flex",
            flexDirection: "column",
            background: PAPER,
            color: INK,
            padding: "40px 26px",
            fontSize: 25,
          }}
        >
          <svg width="198" height="198" viewBox="0 0 16 16" style={{ marginBottom: 44 }}>
            <path fill={INK} d="M3 5H7V9H4V11H7V12H3V8H6V6H3Z" />
            <path fill={INK} d="M9 5H10V11H12V5H13V12H9Z" />
          </svg>
          {["textos", "arquivos", "sem cadastro"].map((label) => (
            <div key={label} style={{ display: "flex", borderTop: `3px dashed ${INK}`, padding: "16px 0", letterSpacing: -1 }}>
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Martian Mono", data: font, weight: 800, style: "normal" }] },
  );
}
