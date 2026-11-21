import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { tenantBrand } from "@/config/tenant-brand";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: tenantBrand.name, template: `%s · ${tenantBrand.name}` },
  description: tenantBrand.description,
  ...(tenantBrand.faviconUrl ? { icons: { icon: tenantBrand.faviconUrl } } : {}),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className="dark"
      style={
        {
          "--primary": tenantBrand.colors.primary,
          "--ring": tenantBrand.colors.primary,
          "--brand-secondary": tenantBrand.colors.secondary,
        } as React.CSSProperties
      }
    >
      <body className={`${inter.variable} ${jakarta.variable} antialiased`}>
        {children}
        <Toaster theme="dark" richColors />
      </body>
    </html>
  );
}
