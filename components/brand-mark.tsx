import { Sparkles } from "lucide-react";
import { tenantBrand } from "@/config/tenant-brand";

export function BrandMark() {
  return (
    <span className="flex items-center gap-2 font-heading text-lg font-semibold">
      {tenantBrand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- logo White-Label vem de domínio arbitrário
        <img src={tenantBrand.logoUrl} alt="" className="size-8 rounded-lg object-contain" />
      ) : (
        <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-brand-secondary text-primary-foreground">
          <Sparkles className="size-4" aria-hidden />
        </span>
      )}
      {tenantBrand.name}
    </span>
  );
}
