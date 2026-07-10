import { useEffect, useRef, useState } from 'react';

interface MagneticButtonProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  href?: string;
  target?: string;
  rel?: string;
  strength?: number;
}

export default function MagneticButton({
  children,
  className = '',
  onClick,
  href,
  target,
  rel,
  strength = 0.3,
}: MagneticButtonProps) {
  const ref = useRef<HTMLElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onMove = (e: globalThis.MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      setOffset({ x: x * strength, y: y * strength });
    };

    const onLeave = () => setOffset({ x: 0, y: 0 });

    el.addEventListener('mousemove', onMove as EventListener);
    el.addEventListener('mouseleave', onLeave as EventListener);
    return () => {
      el.removeEventListener('mousemove', onMove as EventListener);
      el.removeEventListener('mouseleave', onLeave as EventListener);
    };
  }, [strength]);

  const style: React.CSSProperties = {
    transform: `translate(${offset.x}px, ${offset.y}px)`,
    transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
  };

  if (href) {
    return (
      <a
        ref={ref as React.RefObject<HTMLAnchorElement>}
        href={href}
        target={target}
        rel={rel}
        className={className}
        style={style}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      ref={ref as React.RefObject<HTMLButtonElement>}
      onClick={onClick}
      className={className}
      style={style}
    >
      {children}
    </button>
  );
}
