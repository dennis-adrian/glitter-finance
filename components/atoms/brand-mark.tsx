type BrandMarkProps = {
  size?: "default" | "small";
};

export function BrandMark({ size = "default" }: BrandMarkProps) {
  return (
    <img
      className={size === "small" ? "brand-mark small" : "brand-mark"}
      src="/icons/icon-192.svg"
      alt="Billetera Ferial"
    />
  );
}
