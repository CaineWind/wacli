export type MobileKeyboardPlatform = {
  maxTouchPoints: number;
  platform: string;
  userAgent: string;
};

export function isIosLikePlatform(platform: MobileKeyboardPlatform): boolean {
  return (
    /iPad|iPhone|iPod/.test(platform.userAgent)
    || (platform.platform === 'MacIntel' && platform.maxTouchPoints > 1)
  );
}

export function calculateMobileKeyboardInset(
  layoutHeight: number,
  visualHeight: number,
  platform: MobileKeyboardPlatform,
): number {
  if (!isIosLikePlatform(platform)) {
    return 0;
  }
  return Math.max(0, layoutHeight - visualHeight);
}
