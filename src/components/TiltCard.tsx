import { useRef, useState } from 'react';

interface TiltCardProps {
  children: React.ReactNode;
  className?: string;
  maxTilt?: number;
  scale?: number;
}

export default function TiltCard({ children, className = '', maxTilt = 8, scale = 1.02 }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState('');
  const [glarePos, setGlarePos] = useState({ x: 50, y: 50 });

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -maxTilt;
    const rotateY = ((x - centerX) / centerX) * maxTilt;
    setTransform(`perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`);
    setGlarePos({ x: (x / rect.width) * 100, y: (y / rect.height) * 100 });
  };

  const onLeave = () => {
    setTransform('perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)');
    setGlarePos({ x: 50, y: 50 });
  };

  return (
    <div
      ref={ref}
      className={`${className} relative`}
      style={{ transform, transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)', transformStyle: 'preserve-3d' }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {children}
      <div
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 hover:opacity-100 transition-opacity duration-300"
        style={{
          background: `radial-gradient(circle at ${glarePos.x}% ${glarePos.y}%, rgba(255,255,255,0.15), transparent 50%)`,
        }}
      />
    </div>
  );
}
