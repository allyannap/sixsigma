// OnScene siren mark. Still at rest; hovering the brand (icon or name) rings it, see .brand:hover rules in styles.css.
export default function SirenLogo() {
  return (
    <span className="logo" aria-hidden="true">
      <svg viewBox="36 40 228 172" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <clipPath id="os-dome-clip"><path d="M88 172 C88 112 116 92 150 92 C184 92 212 112 212 172 Z" /></clipPath>
          <linearGradient id="os-dome-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FF6B6F" />
            <stop offset="1" stopColor="#E5323A" />
          </linearGradient>
          <radialGradient id="os-glow-fill">
            <stop offset="0" stopColor="#FF5A5F" stopOpacity="1" />
            <stop offset="1" stopColor="#FF5A5F" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="os-beam-fill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#FFF3C4" stopOpacity="0" />
            <stop offset="0.5" stopColor="#FFF3C4" stopOpacity="0.9" />
            <stop offset="1" stopColor="#FFF3C4" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="icon-siren">
          <circle className="glow" cx="150" cy="140" r="122" fill="url(#os-glow-fill)" />
          {/* ding lines: three each side, lit in turn */}
          <g strokeWidth="11" strokeLinecap="round" fill="none">
            <line className="ray r1" x1="74" y1="138" x2="44" y2="132" />
            <line className="ray r2" x1="86" y1="102" x2="62" y2="82" />
            <line className="ray r3" x1="114" y1="76" x2="102" y2="48" />
            <line className="ray r1" x1="226" y1="138" x2="256" y2="132" />
            <line className="ray r2" x1="214" y1="102" x2="238" y2="82" />
            <line className="ray r3" x1="186" y1="76" x2="198" y2="48" />
          </g>
          {/* dome */}
          <path d="M88 172 C88 112 116 92 150 92 C184 92 212 112 212 172 Z" fill="url(#os-dome-fill)" />
          <g clipPath="url(#os-dome-clip)">
            <rect className="beam" x="122" y="80" width="56" height="100" fill="url(#os-beam-fill)" />
          </g>
          <path d="M104 138 C106 118 118 106 134 102" stroke="#FFFFFF" strokeWidth="8" strokeLinecap="round" fill="none" opacity="0.85" />
          {/* face */}
          <ellipse cx="130" cy="144" rx="7" ry="9" fill="#1B2A3F" />
          <ellipse cx="170" cy="144" rx="7" ry="9" fill="#1B2A3F" />
          <circle cx="132.5" cy="140.5" r="2.4" fill="#FFFFFF" />
          <circle cx="172.5" cy="140.5" r="2.4" fill="#FFFFFF" />
          <ellipse cx="114" cy="158" rx="8" ry="5" fill="#FFB3B6" opacity="0.9" />
          <ellipse cx="186" cy="158" rx="8" ry="5" fill="#FFB3B6" opacity="0.9" />
          <path d="M141 156 Q150 165 159 156" stroke="#1B2A3F" strokeWidth="4.5" strokeLinecap="round" fill="none" />
          {/* base */}
          <rect x="74" y="168" width="152" height="36" rx="14" fill="#1F3A5F" />
          <rect x="92" y="178" width="116" height="7" rx="3.5" fill="#FFFFFF" opacity="0.25" />
        </g>
      </svg>
    </span>
  )
}
