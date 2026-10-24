import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
// Helen's stylesheets, in her order: base styles, then product overrides, then integration states.
import "@/frontend/styles.css";
import "@/frontend/product.css";
import "@/frontend/integration.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Song Nexus",
  description: "Compare songs and artists and explore their documented connections using MusicBrainz.",
};

export const viewport: Viewport = { themeColor: "#09090d" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
