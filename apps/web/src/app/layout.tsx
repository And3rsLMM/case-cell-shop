import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./storefront.css";

export const metadata: Metadata = {
  title: "CaseCellShop | Capinhas com personalidade",
  description:
    "Escolha sua capinha, consulte o estoque e acompanhe seu pedido com segurança."
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
