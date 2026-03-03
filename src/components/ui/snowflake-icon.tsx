/**
 * Snowflake Inc. brand logo — approximated as 6 arms at 60° intervals,
 * each arm consisting of a narrow elongated diamond + a perpendicular
 * crossbar diamond, matching the Snowflake corporate icon style.
 * Brand color: #29B5E8
 */
export function SnowflakeIcon({ className }: { className?: string }) {
  const angles = [0, 60, 120, 180, 240, 300];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
      aria-label="Snowflake"
    >
      {angles.map((angle) => (
        <g key={angle} transform={`rotate(${angle}, 50, 50)`} fill="#29B5E8">
          {/* Narrow elongated arm diamond — center (50,50) to tip (50,5) */}
          <path d="M50,50 L54,30 L50,5 L46,30 Z" />
          {/* Perpendicular crossbar diamond at ~60% of arm length */}
          <path d="M50,18 L63,28 L50,38 L37,28 Z" />
        </g>
      ))}
    </svg>
  );
}
