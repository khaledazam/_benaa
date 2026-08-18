import { prisma } from "@/prisma/client";

export async function getOrCreateBrand(name: string, description?: string) {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const existing = await prisma.brand.findUnique({ where: { name: trimmed } });
  if (existing) return existing;

  const code = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return prisma.brand.create({
    data: {
      name: trimmed,
      code,
      description,
      active: true,
    },
  });
}

export async function getAllBrands() {
  return prisma.brand.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
}
