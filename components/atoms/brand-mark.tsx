type BrandMarkProps = {
  size?: "default" | "small";
  /**
   * Next to a visible "Billetera Ferial" title the logo adds nothing for a
   * screen reader, which would otherwise read the name twice.
   */
  decorative?: boolean;
};

export function BrandMark({
  size = "default",
  decorative = false,
}: BrandMarkProps) {
  return (
    <img
      className={size === "small" ? "brand-mark small" : "brand-mark"}
      src="/icons/billetera-ferial-logo.svg"
      alt={decorative ? "" : "Billetera Ferial"}
    />
  );
}
