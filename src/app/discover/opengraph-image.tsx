import { ImageResponse } from "next/og";
import { catalog } from "@/discover/lib/catalog";

export const alt = "Discover, on Song Nexus: the people behind the music";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const DOTS = [
  [820, 150, 46, "#e55165"],
  [1010, 110, 30, "#a893e6"],
  [1080, 300, 40, "#5fc2b0"],
  [900, 380, 34, "#e8ba66"],
  [1030, 490, 28, "#ff9caa"],
] as const;

/** The picture a shared link shows. */
export default function OpenGraphImage() {
  const { artists, songs } = catalog();
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 84,
        background: "linear-gradient(135deg, #3a2029, #111113 62%)",
        color: "#fff",
      }}
    >
      {DOTS.map(([left, top, radius, background]) => (
        <div
          key={background}
          style={{
            position: "absolute",
            left,
            top,
            width: radius * 2,
            height: radius * 2,
            borderRadius: radius,
            background,
          }}
        />
      ))}
      <div style={{ fontSize: 30, color: "#ff9caa", letterSpacing: 4 }}>SONG NEXUS</div>
      <div
        style={{ marginTop: 22, fontSize: 84, lineHeight: 1.05, letterSpacing: -3, maxWidth: 700 }}
      >
        The people behind the music
      </div>
      <div style={{ marginTop: 30, fontSize: 30, color: "#c9c4cf" }}>
        {`${artists.length.toLocaleString("en")} artists and ${songs.length.toLocaleString("en")} songs, linked by real credits`}
      </div>
    </div>,
    size,
  );
}
