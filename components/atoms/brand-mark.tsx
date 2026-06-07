type BrandMarkProps = {
  size?: "default" | "small";
};

export function BrandMark({ size = "default" }: BrandMarkProps) {
  return (
    <span className={size === "small" ? "brand-mark small" : "brand-mark"}>
      G
    </span>
  );
}
