const SYMBOLS = [
  { src: "/assets/stars/1Sym.svg", label: "Mellox symbol one" },
  { src: "/assets/stars/2Sym.svg", label: "Mellox symbol two" },
  { src: "/assets/stars/3Sym.svg", label: "Mellox symbol three" },
  { src: "/assets/stars/4Sym.svg", label: "Mellox symbol four" },
] as const;

type SecondaryBrandSymbolsProps = {
  className?: string;
  size?: "sm" | "md" | "lg";
};

export function SecondaryBrandSymbols({ className = "", size = "sm" }: SecondaryBrandSymbolsProps) {
  const dimension =
    size === "lg" ? "h-16 w-16 sm:h-20 sm:w-20" : size === "md" ? "h-7 w-7" : "h-5 w-5";

  return (
    <div
      className={`inline-flex items-center gap-1.5 ${size === "lg" ? "rounded-[1.75rem] border border-border/60 bg-card/55 px-4 py-3 shadow-[0_18px_50px_-30px_hsl(var(--foreground)/0.45)] backdrop-blur-sm sm:px-5" : ""} ${className}`}
      aria-label="Mellox secondary symbols"
      role="img"
    >
      {SYMBOLS.map((symbol, index) => (
        <img
          key={symbol.src}
          src={symbol.src}
          alt=""
          aria-label={symbol.label}
          draggable={false}
          className={`${dimension} shrink-0 object-contain transition-transform duration-200 ${size === "lg" && index % 2 ? "-translate-y-1" : ""} hover:-translate-y-0.5 ${index % 2 ? "hover:rotate-3" : "hover:-rotate-3"}`}
        />
      ))}
    </div>
  );
}
