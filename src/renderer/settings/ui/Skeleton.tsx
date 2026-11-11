import { motion } from 'framer-motion';
import { easing } from '@renderer/motion/tokens';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';

/** Placeholder bar with a soft highlight sweeping across it (transform only, off for reduced motion). */
function SkeletonBar({ className = '' }: { className?: string }) {
  const reduce = useReduceMotion();
  return (
    <span
      aria-hidden
      className={`relative block overflow-hidden rounded-md bg-sunken ${className}`}
    >
      {reduce ? null : (
        <motion.span
          className="absolute inset-0 block"
          style={{
            backgroundImage:
              'linear-gradient(90deg, transparent, var(--bk-highlight), transparent)',
          }}
          initial={{ x: '-100%' }}
          animate={{ x: '100%' }}
          transition={{ duration: 1.5, ease: easing.standard, repeat: Infinity, repeatDelay: 0.25 }}
        />
      )}
    </span>
  );
}

function SkeletonGroup({ rows }: { rows: number }) {
  return (
    <div>
      <SkeletonBar className="mb-2 ml-1 h-3 w-24" />
      <div className="bk-glass-card divide-y divide-line rounded-card">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex min-h-14 items-center gap-4 px-4 py-2.5">
            <div className="flex-1 space-y-2">
              <SkeletonBar className="h-3.5 w-40" />
              <SkeletonBar className="h-3 w-3/4" />
            </div>
            <SkeletonBar className="h-8 w-28 rounded-control" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Shown while `settings:get` is pending: the page keeps its shape instead of a lone spinner. */
export function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-5" role="status" aria-label="Loading settings">
      <div className="px-1">
        <SkeletonBar className="h-6 w-40" />
        <SkeletonBar className="mt-2 h-3.5 w-72" />
      </div>
      <SkeletonGroup rows={3} />
      <SkeletonGroup rows={2} />
      <span className="sr-only">Loading settings...</span>
    </div>
  );
}
