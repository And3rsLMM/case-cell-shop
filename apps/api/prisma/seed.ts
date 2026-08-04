import "../src/config/environment";

import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const products = [
  {
    id: "case-clear-iphone-15",
    name: "Capinha Transparente Air para iPhone 15",
    description: "Capinha transparente leve com proteção reforçada nas bordas.",
    priceInCents: 2_990,
    stock: 24,
    active: true
  },
  {
    id: "case-armor-galaxy-s24",
    name: "Capinha Armor Preta para Galaxy S24",
    description: "Capinha preta de alta resistência com acabamento antiderrapante.",
    priceInCents: 4_990,
    stock: 15,
    active: true
  },
  {
    id: "case-silicone-moto-g84",
    name: "Capinha de Silicone Lilás para Moto G84",
    description: "Capinha de silicone macio com interior aveludado.",
    priceInCents: 3_490,
    stock: 1,
    active: true
  },
  {
    id: "case-wallet-redmi-note-13",
    name: "Capinha Carteira Marrom para Redmi Note 13",
    description: "Capinha carteira com fechamento magnético e espaço para cartões.",
    priceInCents: 5_490,
    stock: 8,
    active: true
  },
  {
    id: "case-magsafe-iphone-14",
    name: "Capinha MagSafe Azul para iPhone 14",
    description: "Capinha azul compatível com carregamento e acessórios MagSafe.",
    priceInCents: 6_990,
    stock: 0,
    active: true
  }
] satisfies Prisma.ProductCreateInput[];

async function main(): Promise<void> {
  const deletedOrders = await prisma.$transaction(async (transaction) => {
    const deleted = await transaction.order.deleteMany();

    for (const product of products) {
      await transaction.product.upsert({
        where: { id: product.id },
        create: product,
        update: {
          name: product.name,
          description: product.description,
          priceInCents: product.priceInCents,
          stock: product.stock,
          active: product.active
        }
      });
    }

    return deleted.count;
  });

  console.info(
    `${products.length} produtos restaurados e ${deletedOrders} pedidos removidos.`
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
