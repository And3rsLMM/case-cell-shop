const brlFormatter = new Intl.NumberFormat("pt-BR", {
  currency: "BRL",
  style: "currency"
});

export function formatPrice(priceInCents: number): string {
  return brlFormatter.format(priceInCents / 100);
}
