import { getImageProps } from 'next/image';
import type { Image } from '@/lib/types';

/**
 * Art-directed hero image: the desktop image in the <img>, the optional mobile image as a <source> for narrow screens, so only
 * one of them is downloaded. No `priority`: that would preload the desktop image on phones too. The focal point decides the crop.
 */
export function HeroPicture({ image, mobileImage, focus, eager, className }: { image: Image; mobileImage?: Image; focus: { x: number; y: number }; eager: boolean; className?: string }) {
  const common = { alt: image.alt ?? '', fill: true, sizes: '100vw', loading: eager ? ('eager' as const) : ('lazy' as const), fetchPriority: eager ? ('high' as const) : ('auto' as const) };
  const desktop = getImageProps({ ...common, src: image.url });
  const { srcSet: desktopSet, style, ...img } = desktop.props;
  const mobileSet = mobileImage ? getImageProps({ ...common, alt: mobileImage.alt ?? common.alt, src: mobileImage.url }).props.srcSet : undefined;
  return (
    <picture>
      {mobileSet && <source media="(max-width: 767px)" srcSet={mobileSet} sizes="100vw" />}
      {/* eslint-disable-next-line @next/next/no-img-element -- art direction through <picture>; srcSet comes from next/image */}
      <img {...img} srcSet={desktopSet} className={className} style={{ ...style, objectFit: 'cover', objectPosition: `${focus.x}% ${focus.y}%` }} />
    </picture>
  );
}
