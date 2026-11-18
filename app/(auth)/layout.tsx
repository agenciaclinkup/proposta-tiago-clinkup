import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-grid flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8">
        <BrandMark />
      </Link>
      <div className="glass w-full max-w-md rounded-2xl p-8 shadow-2xl shadow-primary/5">{children}</div>
    </main>
  );
}
