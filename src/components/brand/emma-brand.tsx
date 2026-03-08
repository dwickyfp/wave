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
        "relative flex size-7 shrink-0 items-center justify-center text-foreground dark:text-white",
        className,
      )}
    >
      <svg
        viewBox="0 0 100 100"
        className="relative z-10 size-full"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g
          stroke="currentColor"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          {/* Outer lamp bulb arc */}
          <path d="M 23 83 A 42 42 0 1 1 77 83" />

          {/* Lamp bulb base rings */}
          <line x1="38" y1="89" x2="62" y2="89" />
          <line x1="43" y1="96" x2="57" y2="96" />

          {/* Left Brain Lobe (Top) */}
          <path d="M 45 89 L 45 32 A 8 8 0 0 0 37 24 L 34 24 A 10 10 0 0 0 24 34 L 24 40 A 10 10 0 0 0 34 50 L 37 50" />

          {/* Left Brain Lobe (Bottom) */}
          <path d="M 45 56 L 35 56 A 8 8 0 0 0 27 64 A 8 8 0 0 0 35 72 L 38 72" />

          {/* Right Brain Lobe (Top) */}
          <path d="M 55 89 L 55 32 A 8 8 0 0 1 63 24 L 66 24 A 10 10 0 0 1 76 34 L 76 40 A 10 10 0 0 1 66 50 L 63 50" />

          {/* Right Brain Lobe (Bottom) */}
          <path d="M 55 56 L 65 56 A 8 8 0 0 1 73 64 A 8 8 0 0 1 65 72 L 62 72" />
        </g>
        <g fill="currentColor">
          <circle cx="37" cy="50" r="3.2" />
          <circle cx="38" cy="72" r="3.2" />
          <circle cx="63" cy="50" r="3.2" />
          <circle cx="62" cy="72" r="3.2" />
        </g>
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
