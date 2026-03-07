import { cn } from "lib/utils";

interface EmmaBrandIconProps {
  className?: string;
}

interface EmmaBrandProps extends EmmaBrandIconProps {
  aiClassName?: string;
  labelClassName?: string;
}

export function EmmaBrandIcon({ className }: EmmaBrandIconProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(145deg,_rgba(9,14,24,0.94),_rgba(16,23,37,0.9))] shadow-[0_18px_30px_-18px_rgba(56,189,248,0.36)] ring-1 ring-white/6",
        className,
      )}
    >
      <span className="absolute inset-[1px] rounded-[calc(theme(borderRadius.2xl)-2px)] bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.16),_transparent_52%),linear-gradient(180deg,_rgba(255,255,255,0.08),_rgba(255,255,255,0.01))]" />
      <svg
        viewBox="0 0 64 64"
        className="relative z-10 size-12"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M29.5 18.5C24.117 18.5 19.75 22.867 19.75 28.25C19.75 30.611 20.591 32.776 22.001 34.46C21.808 39.128 25.129 43.5 29.978 43.5C31.744 43.5 33.397 42.92 34.75 41.928"
          stroke="rgba(224, 242, 254, 0.92)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M34.5 18.5C39.883 18.5 44.25 22.867 44.25 28.25C44.25 30.611 43.409 32.776 41.999 34.46C42.192 39.128 38.871 43.5 34.022 43.5C32.256 43.5 30.603 42.92 29.25 41.928"
          stroke="rgba(125, 211, 252, 0.92)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M32 18V26"
          stroke="rgba(186, 230, 253, 0.86)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M32 29V45"
          stroke="rgba(186, 230, 253, 0.86)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M25 26.5H29.5"
          stroke="rgba(224, 242, 254, 0.85)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M34.5 31.5H39"
          stroke="rgba(125, 211, 252, 0.85)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M28.5 36H35.5"
          stroke="rgba(163, 230, 253, 0.95)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M22.75 34.5H27"
          stroke="rgba(224, 242, 254, 0.78)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M37 39H41.25"
          stroke="rgba(125, 211, 252, 0.78)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle
          cx="24"
          cy="34.5"
          r="2.25"
          stroke="rgba(224, 242, 254, 0.9)"
          strokeWidth="2"
        />
        <circle
          cx="40"
          cy="39"
          r="2.25"
          stroke="rgba(103, 232, 249, 0.92)"
          strokeWidth="2"
        />
        <circle
          cx="32"
          cy="27.5"
          r="2.25"
          stroke="rgba(186, 230, 253, 0.94)"
          strokeWidth="2"
        />
        <path
          d="M32 27.5V32"
          stroke="rgba(186, 230, 253, 0.92)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function EmmaBrand({
  className,
  aiClassName,
  labelClassName,
}: EmmaBrandProps) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <EmmaBrandIcon />
      <div className="min-w-0">
        <div
          className={cn(
            "truncate text-[1.05rem] font-semibold tracking-[-0.04em] text-sidebar-foreground",
            labelClassName,
          )}
        >
          <span className="text-sidebar-foreground">Emma </span>
          <span
            className={cn(
              "bg-linear-to-r from-sky-300 via-cyan-200 to-emerald-200 bg-clip-text font-bold text-transparent",
              aiClassName,
            )}
          >
            AI
          </span>
        </div>
      </div>
    </div>
  );
}
