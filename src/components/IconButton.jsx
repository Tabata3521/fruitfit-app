export default function IconButton({ children, className = "", label = "button", onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`grid h-11 w-11 place-items-center rounded-full border border-appBorder bg-white/70 text-appDark shadow-card backdrop-blur ${className}`}
    >
      {children}
    </button>
  );
}
