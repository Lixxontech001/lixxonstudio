export default function Logo({ className = '', showText = true }: { className?: string; showText?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <img
        src="/assets/images/Lixxon_Studio..png"
        alt="Lixxon Studio"
        className="h-9 md:h-10 w-auto object-contain"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
          const sibling = (e.currentTarget as HTMLImageElement).nextElementSibling;
          if (sibling) (sibling as HTMLElement).style.display = 'block';
        }}
      />
      {showText && (
        <span className="font-sans font-light tracking-editorial uppercase text-charcoal text-sm hidden sm:inline">
          Lixxon Studio
        </span>
      )}
    </div>
  );
}
