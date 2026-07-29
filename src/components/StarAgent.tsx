import { useEffect, useState } from "react";

export type StarMood = "happy" | "sad" | "thinking" | "scanning" | "excited" | "waving" | "superhero";

interface StarAgentProps {
  mood?: StarMood;
  size?: number;
  className?: string;
  message?: string;
  animate?: boolean;
  hue?: number; // base HSL hue for body tint (default 217 = electric blue)
}

export function StarAgent({ mood = "happy", size = 120, className = "", message, animate = true, hue = 217 }: StarAgentProps) {
  const [bounce, setBounce] = useState(false);

  useEffect(() => {
    if (!animate) return;
    const interval = setInterval(() => {
      setBounce(true);
      setTimeout(() => setBounce(false), 600);
    }, 3000);
    return () => clearInterval(interval);
  }, [animate]);

  // Face expressions based on mood
  const faces: Record<StarMood, { leftEye: React.ReactNode; rightEye: React.ReactNode; mouth: React.ReactNode }> = {
    happy: {
      leftEye: <circle cx="42" cy="48" r="2.5" fill="hsl(222, 47%, 11%)" />,
      rightEye: <circle cx="58" cy="48" r="2.5" fill="hsl(222, 47%, 11%)" />,
      mouth: <path d="M44 55 Q50 60 56 55" stroke="hsl(222, 47%, 11%)" strokeWidth="1.8" fill="none" strokeLinecap="round" />,
    },
    sad: {
      leftEye: (
        <>
          <circle cx="42" cy="48" r="2.5" fill="hsl(222, 47%, 11%)" />
          {/* Tear */}
          <ellipse cx="42" cy="54" rx="1.2" ry="2" fill="hsl(207, 90%, 77%)" opacity="0.8">
            <animate attributeName="cy" values="54;58;54" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.8;0.3;0.8" dur="2s" repeatCount="indefinite" />
          </ellipse>
        </>
      ),
      rightEye: <circle cx="58" cy="48" r="2.5" fill="hsl(222, 47%, 11%)" />,
      mouth: <path d="M44 58 Q50 54 56 58" stroke="hsl(222, 47%, 11%)" strokeWidth="1.8" fill="none" strokeLinecap="round" />,
    },
    thinking: {
      leftEye: <circle cx="42" cy="48" r="2.5" fill="hsl(222, 47%, 11%)" />,
      rightEye: (
        <>
          <line x1="55" y1="48" x2="61" y2="48" stroke="hsl(222, 47%, 11%)" strokeWidth="2" strokeLinecap="round" />
        </>
      ),
      mouth: <path d="M46 56 L54 56" stroke="hsl(222, 47%, 11%)" strokeWidth="1.8" fill="none" strokeLinecap="round" />,
    },
    scanning: {
      leftEye: (
        <g>
          <circle cx="42" cy="48" r="3.5" fill="none" stroke="hsl(217, 91%, 60%)" strokeWidth="1.5">
            <animate attributeName="r" values="2.5;4;2.5" dur="1.5s" repeatCount="indefinite" />
          </circle>
          <circle cx="42" cy="48" r="1.5" fill="hsl(217, 91%, 60%)" />
        </g>
      ),
      rightEye: (
        <g>
          <circle cx="58" cy="48" r="3.5" fill="none" stroke="hsl(217, 91%, 60%)" strokeWidth="1.5">
            <animate attributeName="r" values="2.5;4;2.5" dur="1.5s" repeatCount="indefinite" begin="0.3s" />
          </circle>
          <circle cx="58" cy="48" r="1.5" fill="hsl(217, 91%, 60%)" />
        </g>
      ),
      mouth: (
        <g>
          <rect x="44" y="55" width="12" height="2" rx="1" fill="hsl(222, 47%, 11%)" opacity="0.6">
            <animate attributeName="width" values="12;8;12" dur="1s" repeatCount="indefinite" />
          </rect>
        </g>
      ),
    },
    excited: {
      leftEye: (
        <>
          <circle cx="42" cy="48" r="3" fill="hsl(222, 47%, 11%)" />
          {/* Sparkle */}
          <circle cx="43.5" cy="46.5" r="0.8" fill="white" />
        </>
      ),
      rightEye: (
        <>
          <circle cx="58" cy="48" r="3" fill="hsl(222, 47%, 11%)" />
          <circle cx="59.5" cy="46.5" r="0.8" fill="white" />
        </>
      ),
      mouth: <path d="M43 55 Q50 63 57 55" stroke="hsl(222, 47%, 11%)" strokeWidth="1.8" fill="hsl(222, 47%, 11%)" strokeLinecap="round" />,
    },
    waving: {
      leftEye: <circle cx="42" cy="48" r="2.5" fill="hsl(222, 47%, 11%)" />,
      rightEye: (
        <>
          {/* Wink */}
          <path d="M55 48 Q58 46 61 48" stroke="hsl(222, 47%, 11%)" strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      ),
      mouth: <path d="M44 55 Q50 60 56 55" stroke="hsl(222, 47%, 11%)" strokeWidth="1.8" fill="none" strokeLinecap="round" />,
    },
    superhero: {
      leftEye: (
        <>
          <circle cx="42" cy="48" r="3" fill="hsl(222, 47%, 11%)" />
          <circle cx="43" cy="47" r="1" fill="white" />
        </>
      ),
      rightEye: (
        <>
          <circle cx="58" cy="48" r="3" fill="hsl(222, 47%, 11%)" />
          <circle cx="59" cy="47" r="1" fill="white" />
        </>
      ),
      mouth: <path d="M44 55 Q50 61 56 55" stroke="hsl(222, 47%, 11%)" strokeWidth="2" fill="none" strokeLinecap="round" />,
    },
  };

  const face = faces[mood];

  // Body color based on mood
  const bodyGradientId = `star-body-${mood}`;
  const glowId = `star-glow-${mood}`;

  const moodColors: Record<StarMood, { main: string; light: string; glow: string }> = {
    happy:     { main: `hsl(${hue}, 80%, 60%)`, light: `hsl(${hue}, 85%, 75%)`, glow: `hsl(${hue}, 91%, 60%)` },
    sad:       { main: `hsl(${hue}, 60%, 65%)`, light: `hsl(${hue}, 70%, 80%)`, glow: `hsl(${hue}, 60%, 70%)` },
    thinking:  { main: `hsl(${hue}, 75%, 62%)`, light: `hsl(${hue}, 80%, 78%)`, glow: `hsl(${hue}, 80%, 65%)` },
    scanning:  { main: `hsl(${hue}, 85%, 58%)`, light: `hsl(${(hue + 30) % 360}, 85%, 70%)`, glow: `hsl(${(hue + 30) % 360}, 85%, 53%)` },
    excited:   { main: `hsl(${hue}, 90%, 55%)`, light: `hsl(${hue}, 90%, 72%)`, glow: `hsl(${hue}, 91%, 60%)` },
    waving:    { main: `hsl(${hue}, 80%, 60%)`, light: `hsl(${hue}, 85%, 75%)`, glow: `hsl(${hue}, 91%, 60%)` },
    superhero: { main: `hsl(${hue}, 90%, 55%)`, light: `hsl(${hue}, 90%, 70%)`, glow: `hsl(${hue}, 91%, 55%)` },
  };

  const colors = moodColors[mood];

  return (
    <div className={`inline-flex flex-col items-center gap-2 ${className}`}>
      <div
        className={`relative transition-transform duration-300 ${bounce ? "scale-110" : "scale-100"}`}
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 100 100" width={size} height={size} className="overflow-visible">
          <defs>
            <radialGradient id={bodyGradientId} cx="45%" cy="40%" r="55%">
              <stop offset="0%" stopColor={colors.light} />
              <stop offset="100%" stopColor={colors.main} />
            </radialGradient>
            <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feFlood floodColor={colors.glow} floodOpacity="0.25" />
              <feComposite in2="blur" operator="in" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Ambient sparkles */}
          {(mood === "excited" || mood === "superhero" || mood === "scanning") && (
            <>
              <circle cx="18" cy="22" r="1.5" fill={colors.glow} opacity="0.6">
                <animate attributeName="opacity" values="0.6;0.1;0.6" dur="2s" repeatCount="indefinite" />
              </circle>
              <circle cx="82" cy="30" r="1" fill={colors.glow} opacity="0.5">
                <animate attributeName="opacity" values="0.5;0.1;0.5" dur="1.5s" repeatCount="indefinite" begin="0.5s" />
              </circle>
              <circle cx="75" cy="75" r="1.2" fill={colors.glow} opacity="0.4">
                <animate attributeName="opacity" values="0.4;0;0.4" dur="2.5s" repeatCount="indefinite" begin="1s" />
              </circle>
            </>
          )}

          {/* Star body — 4 pointed star shape */}
          <g filter={`url(#${glowId})`}>
            <path
              d={`
                M50 10
                C53 30, 65 35, 85 38
                C65 42, 58 55, 55 78
                Q52 90, 50 90
                Q48 90, 45 78
                C42 55, 35 42, 15 38
                C35 35, 47 30, 50 10
                Z
              `}
              fill={`url(#${bodyGradientId})`}
              stroke={colors.main}
              strokeWidth="0.5"
            >
              {mood === "scanning" && (
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  values="0 50 50;3 50 50;-3 50 50;0 50 50"
                  dur="2s"
                  repeatCount="indefinite"
                />
              )}
            </path>

            {/* Highlight */}
            <ellipse cx="40" cy="32" rx="6" ry="4" fill="white" opacity="0.25" transform="rotate(-15 40 32)" />
          </g>

          {/* Cape for superhero mood */}
          {mood === "superhero" && (
            <g>
              <path
                d="M35 65 Q25 80, 20 90 Q30 85, 38 72 Z"
                fill="hsl(0, 72%, 51%)"
                opacity="0.9"
              >
                <animate attributeName="d" values="M35 65 Q25 80, 20 90 Q30 85, 38 72 Z;M35 65 Q22 82, 18 92 Q28 86, 38 72 Z;M35 65 Q25 80, 20 90 Q30 85, 38 72 Z" dur="2s" repeatCount="indefinite" />
              </path>
              <path
                d="M65 65 Q75 80, 80 90 Q70 85, 62 72 Z"
                fill="hsl(0, 72%, 51%)"
                opacity="0.9"
              >
                <animate attributeName="d" values="M65 65 Q75 80, 80 90 Q70 85, 62 72 Z;M65 65 Q78 82, 82 92 Q72 86, 62 72 Z;M65 65 Q75 80, 80 90 Q70 85, 62 72 Z" dur="2s" repeatCount="indefinite" begin="0.3s" />
              </path>
            </g>
          )}

          {/* Face */}
          {face.leftEye}
          {face.rightEye}
          {face.mouth}

          {/* Blush for happy/excited */}
          {(mood === "happy" || mood === "excited" || mood === "waving") && (
            <>
              <ellipse cx="37" cy="54" rx="3" ry="1.8" fill="hsl(0, 70%, 80%)" opacity="0.35" />
              <ellipse cx="63" cy="54" rx="3" ry="1.8" fill="hsl(0, 70%, 80%)" opacity="0.35" />
            </>
          )}
        </svg>
      </div>

      {/* Speech bubble */}
      {message && (
        <div className="relative max-w-[200px] animate-fade-in">
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-card border-l border-t border-border/60" />
          <div className="bg-card border border-border/60 rounded-xl px-3 py-2 shadow-sm">
            <p className="text-[11px] text-muted-foreground text-center leading-relaxed">{message}</p>
          </div>
        </div>
      )}
    </div>
  );
}
