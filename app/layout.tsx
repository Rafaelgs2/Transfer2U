import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Martian_Mono } from "next/font/google";
import { PaperFx } from "@/components/PaperFx";
import "./globals.css";

const display = Martian_Mono({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-display" });
const body = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-body" });

const description = "Envie textos e arquivos entre celular e computador, ou para quem quiser. Sem cadastro, e tudo some quando a sala acaba.";

export const metadata: Metadata = {
  metadataBase: new URL("https://transfer2u.vercel.app"),
  title: { default: "Transfer2U: imprime aqui, recebe lá", template: "%s · Transfer2U" },
  description,
  applicationName: "Transfer2U",
  appleWebApp: { capable: true, title: "Transfer2U" },
  openGraph: {
    type: "website",
    siteName: "Transfer2U",
    locale: "pt_BR",
    title: "Transfer2U: imprime aqui, recebe lá",
    description,
  },
  twitter: { card: "summary_large_image" },
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
