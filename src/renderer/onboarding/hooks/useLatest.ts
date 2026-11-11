import { useEffect, useRef, type MutableRefObject } from 'react';

/** A ref that always holds the latest value, for listeners that must not re-subscribe. */
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
