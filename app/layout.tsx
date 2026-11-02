import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Martian_Mono } from "next/font/google";
import { PaperFx } from "@/components/PaperFx";
import "./globals.css";

const display = Martian_Mono({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-display" });
const body = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Transfer2U",
  description: "Envie arquivos e mensagens entre celular e computador, sem cadastro.",
  appleWebApp: { capable: true, title: "Transfer2U" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1f4bff",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${body.variable}`}>
      <body>
        <PaperFx />
        {children}
      </body>
    </html>
  );
}
