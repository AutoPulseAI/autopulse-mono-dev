"use client";
import { useEffect, useState } from "react";

// True below Bootstrap's md width. False until mounted, so the server and the first render match.
export default function useIsMobile(width = 768) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${width - 0.02}px)`);
    const set = () => setMobile(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, [width]);
  return mobile;
}
