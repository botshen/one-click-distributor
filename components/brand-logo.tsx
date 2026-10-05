import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-grid size-8 shrink-0 place-items-center rounded-lg bg-blue-600 text-white",
        className,
      )}
      aria-hidden="true"
    >
      <Send className="size-1/2" strokeWidth={2.25} />
    </span>
  );
}
