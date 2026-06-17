import { cn } from "@opal/utils";
import { PRODUCT_NAME } from "@/lib/branding";

export function KnotLogoMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[7px] bg-[#111827] font-semibold leading-none text-white",
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(12, Math.round(size * 0.54)),
      }}
    >
      K
    </span>
  );
}

export function KnotLogo({
  folded,
  size = 28,
  className,
}: {
  folded?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-[7px]", className)}>
      <KnotLogoMark size={size} />
      {!folded && (
        <span className="text-[25px] leading-none font-semibold tracking-normal text-[#171717]">
          {PRODUCT_NAME}
        </span>
      )}
    </div>
  );
}
