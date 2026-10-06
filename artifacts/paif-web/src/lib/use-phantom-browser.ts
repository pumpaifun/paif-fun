import { useEffect, useState } from "react";

export function isInPhantomBrowser(): boolean {
  try {
    const phantom = (window as any).phantom;
    return !!(phantom?.solana?.isPhantom) && /Phantom/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

export function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function getPhantomDeepLink(url?: string): string {
  const target = encodeURIComponent(url ?? window.location.href);
  const ref = encodeURIComponent(window.location.origin);
  return `https://phantom.app/ul/v1/browse/${target}?ref=${ref}`;
}

export function usePhantomBrowser() {
  const [inPhantomBrowser, setInPhantomBrowser] = useState(false);
  const [onMobile, setOnMobile] = useState(false);

  useEffect(() => {
    setInPhantomBrowser(isInPhantomBrowser());
    setOnMobile(isMobileDevice());
  }, []);

  return {
    inPhantomBrowser,
    onMobile,
    showOpenInPhantom: onMobile && !inPhantomBrowser,
    deepLink: getPhantomDeepLink(),
  };
}
