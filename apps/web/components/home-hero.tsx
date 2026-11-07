import { HeroCta } from '@/components/hero-cta';
import { HeroPicture } from '@/components/hero-picture';
import { Reveal } from '@/components/reveal';
import type { HomepageSection } from '@/lib/types';

/** The classic (single) homepage hero. With an image it is full-bleed in the editorial look and a rounded card on phones. */
export function Hero({ section }: { section: HomepageSection }) {
  return (
    <section className="relative isolate overflow-hidden ed:max-md:px-4 ed:max-md:pt-3" data-hero-bleed={section.image ? '' : undefined}>
      {section.image ? (
        <div className="relative h-[78svh] max-h-[860px] min-h-[480px] ed:max-md:h-auto ed:max-md:min-h-0 ed:max-md:aspect-[4/5] ed:max-md:overflow-hidden ed:max-md:rounded-[var(--radius-hero)] ed:md:h-svh ed:md:max-h-[var(--hero-max-h)] ed:md:min-h-[560px]">
          <HeroPicture image={section.image} mobileImage={section.mobileImage?.url ? section.mobileImage : undefined} focus={{ x: focusOf(section.imageFocus?.x, 50), y: focusOf(section.imageFocus?.y, 0) }} eager className="hero-zoom" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#1f1626]/70 via-[#1f1626]/10 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-40 bg-gradient-to-b from-[#1f1626]/50 to-transparent ed:md:block" />
          <div className="container-x absolute inset-x-0 bottom-0 pb-12 text-white ed:max-md:px-6 ed:max-md:pb-8 sm:pb-20">
            <HeroCopy section={section} light />
          </div>
        </div>
      ) : (
        <div className="container-x py-14 text-center sm:py-20">
          <HeroCopy section={section} />
        </div>
      )}
    </section>
  );
}

const focusOf = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : fallback);

function HeroCopy({ section, light }: { section: HomepageSection; light?: boolean }) {
  return (
    <Reveal className={`max-w-2xl ${light ? '' : 'mx-auto'}`}>
      {section.heading && <h1 className="display-title text-4xl leading-[1.02] sm:text-6xl lg:text-7xl">{section.heading}</h1>}
      {section.body && <p className={`mt-5 max-w-md text-base sm:text-lg ${light ? 'text-white/90' : 'mx-auto text-muted'}`}>{section.body}</p>}
      {section.link && <HeroCta href={section.link.href} label={section.link.label} onAccent={!light} className={`mt-8 ${light ? 'bg-bg text-fg hover:bg-white' : 'bg-accent text-accent-fg'}`} />}
    </Reveal>
  );
}

