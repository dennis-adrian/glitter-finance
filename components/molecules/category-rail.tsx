type CategoryRailProps = {
  categories: string[];
  active: string;
  setActive: (category: string) => void;
};

export function CategoryRail({ categories, active, setActive }: CategoryRailProps) {
  return (
    <div className="category-rail">
      {categories.map((item) => (
        <button key={item} className={active === item ? "active" : ""} onClick={() => setActive(item)}>
          {item}
        </button>
      ))}
    </div>
  );
}
