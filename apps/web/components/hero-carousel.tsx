'use client';

import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AUTOPLAY_MS, type HeroSlide, shouldAutoplay, wrapIndex } from '@/lib/hero-slides';
import { ArrowIcon } from './icons';
import { HeroCta } from './hero-cta';
import { HeroPicture } from './hero-picture';

/**
 * Editorial hero carousel (client island). The first image is eagerly fetched; the others are only added to the page
 * once a slide is active or next in line, so a visitor never downloads all of them up front. The mobile image is
 * chosen by the browser through <picture>, so only one of the two is downloaded.
 */
export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const count = slides.length;
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const [nonce, setNonce] = useState(0); // bumped by every manual change so the timer restarts
  const [seen, setSeen] = useState<number[]>([0]);
  const [ready, setReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [offscreen, setOffscreen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMq = () => setReducedMotion(mq.matches);
    const onVis = () => setHidden(document.visibilityState === 'hidden');
    onMq();
    onVis();
    setReady(true);
    mq.addEventListener('change', onMq);
    document.addEventListener('visibilitychange', onVis);
    const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([e]) => setOffscreen(!e!.isIntersecting), { threshold: 0.25 });
    if (io && root.current) io.observe(root.current);
    return () => {
      mq.removeEventListener('change', onMq);
      document.removeEventListener('visibilitychange', onVis);
      io?.disconnect();
    };
  }, []);

  // Load the active slide's image and the next one's.
  useEffect(() => {
    setSeen((s) => [...new Set([...s, active, wrapIndex(active + 1, count)])]);
  }, [active, count]);

  const playing = ready && shouldAutoplay({ count, reducedMotion, hovered, focused, hidden, offscreen, userPaused });

  // One timer at a time: it is recreated whenever the slide, a manual change or the playing state changes.
  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(() => setActive((a) => wrapIndex(a + 1, count)), AUTOPLAY_MS);
    return () => window.clearTimeout(t);
  }, [playing, active, nonce, count]);

  const go = useCallback(
    (i: number) => {
      setActive(wrapIndex(i, count));
      setNonce((n) => n + 1);
    },
    [count],
  );

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') go(active - 1);
    else if (e.key === 'ArrowRight') go(active + 1);
  };

  return (
    <section
      ref={root}
      aria-roledescription="carousel"
      aria-label="Featured from TAZEEN"
      data-hero-bleed
      className="relative ed:max-md:px-4 ed:max-md:pt-3"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocused(false)}
      onKeyDown={onKeyDown}
    >
      <div className="relative aspect-[4/5] max-h-[78svh] min-h-[420px] w-full overflow-hidden bg-surface md:aspect-[16/9] ed:max-md:min-h-0 ed:max-md:rounded-[var(--radius-hero)] ed:md:aspect-auto ed:md:h-[calc(100svh-5.5rem)] ed:md:max-h-[var(--hero-max-h)] ed:md:min-h-[560px]" aria-live={playing ? 'off' : 'polite'}>
        {slides.map((slide, i) => (
          <Slide key={slide.key} slide={slide} index={i} total={count} active={i === active} loadImage={seen.includes(i)} instant={reducedMotion} />
        ))}
      </div>

      <div className="container-x flex items-center justify-between py-1">
        <div className="-ml-2 flex items-center">
          {slides.map((s, i) => (
            <button key={s.key} type="button" onClick={() => go(i)} aria-label={`Show slide ${i + 1} of ${count}`} aria-current={i === active ? 'true' : undefined} className="group flex h-11 w-9 items-center justify-center">
              <span className={`block h-0.5 rounded-full transition-all duration-500 ${i === active ? 'w-7 bg-accent' : 'w-4 bg-fg/25 group-hover:bg-fg/50'}`} />
            </button>
          ))}
        </div>
        <div className="-mr-2 flex items-center">
          {!reducedMotion && (
            <button type="button" className="btn-ghost h-11 w-11 rounded-full px-0!" onClick={() => setUserPaused((p) => !p)} aria-label={userPaused ? 'Start automatic slide changes' : 'Pause automatic slide changes'}>
              {userPaused ? <PlayGlyph /> : <PauseGlyph />}
            </button>
          )}
          <button type="button" className="btn-ghost h-11 w-11 rounded-full px-0!" onClick={() => go(active - 1)} aria-label="Previous slide">
            <ArrowIcon className="rotate-180" />
          </button>
          <button type="button" className="btn-ghost h-11 w-11 rounded-full px-0!" onClick={() => go(active + 1)} aria-label="Next slide">
            <ArrowIcon />
          </button>
        </div>
      </div>
    </section>
  );
}

function Slide({ slide, index, total, active, loadImage, instant }: { slide: HeroSlide; index: number; total: number; active: boolean; loadImage: boolean; instant: boolean }) {
  const Heading = index === 0 ? 'h1' : 'h2';
  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${total}`}
      aria-hidden={!active}
      inert={!active}
      // Crossfade without a dip: the incoming slide fades in on top while the outgoing one stays opaque beneath, then drops out.
      className={`absolute inset-0 transition-opacity ease-out ${active ? `z-10 opacity-100 ${instant ? 'duration-0' : 'duration-[600ms]'}` : `pointer-events-none opacity-0 duration-0 ${instant ? '' : 'delay-[600ms]'}`}`}
    >
      {loadImage && <SlideImage slide={slide} first={index === 0} />}
      <div className="absolute inset-0 bg-gradient-to-t from-[#1f1626]/65 via-[#1f1626]/10 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-40 bg-gradient-to-b from-[#1f1626]/50 to-transparent ed:md:block" />
      <div className={`container-x absolute inset-x-0 bottom-0 pb-8 text-white transition-opacity ed:max-md:px-6 sm:pb-14 ${active ? `opacity-100 ${instant ? 'duration-0' : 'delay-200 duration-500'}` : 'opacity-0 duration-150'}`}>
        <div className="max-w-xl">
          {slide.heading && <Heading className="display-title text-3xl leading-[1.05] sm:text-5xl lg:text-6xl">{slide.heading}</Heading>}
          {slide.body && <p className="mt-3 max-w-md text-sm text-white/90 sm:text-lg">{slide.body}</p>}
          {slide.link && (
            <HeroCta href={slide.link.href} label={slide.link.label} className="mt-5 bg-bg text-accent hover:bg-white sm:mt-7" />
          )}
        </div>
      </div>
    </div>
  );
}

function SlideImage({ slide, first }: { slide: HeroSlide; first: boolean }) {
  return <HeroPicture image={slide.image} mobileImage={slide.mobileImage} focus={slide.focus} eager={first} />;
}

const PauseGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" /></svg>
);
const PlayGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" /></svg>
);
