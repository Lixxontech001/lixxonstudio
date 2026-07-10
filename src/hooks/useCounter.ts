import { useEffect, useState } from 'react';

export function useCounter(
  target: number,
  duration: number = 2000,
  isVisible: boolean = false
): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isVisible) return;

    let startTime: number | null = null;
    const startValue = 0;

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(startValue + (target - startValue) * eased));
      if (progress < 1) requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  }, [isVisible, target, duration]);

  return count;
}
