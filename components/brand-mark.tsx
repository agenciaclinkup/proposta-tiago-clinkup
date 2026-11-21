import { Sparkles } from "lucide-react";
import { tenantBrand } from "@/config/tenant-brand";

export function BrandMark({
  brand,
}: {
  brand?: { name: string; logoUrl: string | null };
} = {}) {
  const active = brand ?? tenantBrand;
  return (
    <span className="flex items-center gap-2 font-heading text-lg font-semibold">
      {active.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- logo White-Label vem de domínio arbitrário
        <img src={active.logoUrl} alt="" className="size-8 rounded-lg object-contain" />
      ) : (
        <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-brand-secondary text-primary-foreground">
          <Sparkles className="size-4" aria-hidden />
        </span>
      )}
      {active.name}
    </span>
  );
}
