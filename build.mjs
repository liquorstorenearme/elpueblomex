#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const outDir = path.join(root, "public");

const site = JSON.parse(fs.readFileSync(path.join(root, "content/site.json"), "utf8"));
const menu = JSON.parse(fs.readFileSync(path.join(root, "content/menu.json"), "utf8"));
const { locations } = JSON.parse(fs.readFileSync(path.join(root, "content/locations.json"), "utf8"));
const { posts } = JSON.parse(fs.readFileSync(path.join(root, "content/posts.json"), "utf8"));
const { jobs } = JSON.parse(fs.readFileSync(path.join(root, "content/jobs.json"), "utf8"));

const BASE_URL = site.seo?.siteUrl || "https://elpueblomex.com";
const h = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slugify = (s) => String(s).toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
const locBySlug = Object.fromEntries(locations.map(l => [l.slug, l]));

function fileExists(webPath) {
  if (!webPath || !webPath.startsWith("/")) return false;
  return fs.existsSync(path.join(outDir, webPath.slice(1)));
}

// ---------- JSON-LD / Schema ----------
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

const ORG_ID = `${BASE_URL}/#organization`;
const WEBSITE_ID = `${BASE_URL}/#website`;

function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: site.brand.name,
    alternateName: site.brand.short,
    url: BASE_URL,
    logo: `${BASE_URL}/images/brand/logo-lockup-light.png`,
    email: site.brand.email,
    foundingDate: site.brand.founded,
    sameAs: [site.social.instagram, site.social.facebook, site.social.yelp].filter(Boolean)
  };
}

function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: BASE_URL,
    name: site.brand.name,
    publisher: { "@id": ORG_ID },
    inLanguage: "en-US",
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${BASE_URL}/menu/?q={search_term_string}` },
      "query-input": "required name=search_term_string"
    }
  };
}

function breadcrumbSchema(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url ? `${BASE_URL}${it.url}` : undefined
    }))
  };
}

const DAY_MAP = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday",
  thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday"
};

function parseHoursToSpec(hours) {
  const days = ["mon","tue","wed","thu","fri","sat","sun"];
  const parsed = [];
  for (const d of days) {
    const raw = hours[d];
    if (!raw) continue;
    if (/24 hours/i.test(raw)) {
      parsed.push({ day: DAY_MAP[d], opens: "00:00", closes: "23:59" });
      continue;
    }
    const m = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[–-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM|Midnight)?/i);
    if (!m) continue;
    const to24 = (hr, mn, mer) => {
      let H = parseInt(hr, 10);
      const M = mn ? parseInt(mn, 10) : 0;
      if (mer && /Midnight/i.test(mer)) H = 24;
      else if (mer && /PM/i.test(mer) && H !== 12) H += 12;
      else if (mer && /AM/i.test(mer) && H === 12) H = 0;
      return `${String(H).padStart(2,"0")}:${String(M).padStart(2,"0")}`;
    };
    parsed.push({
      day: DAY_MAP[d],
      opens: to24(m[1], m[2], m[3]),
      closes: to24(m[4], m[5], m[6])
    });
  }
  // Collapse identical runs
  const groups = [];
  for (const p of parsed) {
    const last = groups[groups.length - 1];
    if (last && last.opens === p.opens && last.closes === p.closes) last.days.push(p.day);
    else groups.push({ days: [p.day], opens: p.opens, closes: p.closes });
  }
  return groups.map(g => ({
    "@type": "OpeningHoursSpecification",
    dayOfWeek: g.days,
    opens: g.opens,
    closes: g.closes
  }));
}

function restaurantSchema(loc) {
  const hoursSpec = loc.comingSoon ? [] : parseHoursToSpec(loc.hours);
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": `${BASE_URL}/locations/${loc.slug}/#restaurant`,
    name: `${site.brand.name} — ${loc.name}`,
    url: `${BASE_URL}/locations/${loc.slug}/`,
    telephone: loc.phone || undefined,
    image: [`${BASE_URL}${loc.hero}`, `${BASE_URL}/images/home/fish-taco.jpg`],
    logo: `${BASE_URL}/images/brand/logo-lockup-light.png`,
    priceRange: "$$",
    servesCuisine: ["Mexican", "Tex-Mex", "Seafood"],
    acceptsReservations: false,
    paymentAccepted: "Cash, Credit Card, Debit Card, Apple Pay, Google Pay",
    currenciesAccepted: "USD",
    hasMenu: `${BASE_URL}/menu/`,
    address: {
      "@type": "PostalAddress",
      streetAddress: loc.address.street,
      addressLocality: loc.address.city,
      addressRegion: loc.address.region,
      postalCode: loc.address.zip,
      addressCountry: "US"
    },
    geo: loc.geo ? { "@type": "GeoCoordinates", latitude: loc.geo.lat, longitude: loc.geo.lon } : undefined,
    hasMap: loc.mapsUrl,
    areaServed: [
      { "@type": "City", name: loc.address.city, containedInPlace: { "@type": "AdministrativeArea", name: "San Diego County" } }
    ],
    openingHoursSpecification: hoursSpec.length ? hoursSpec : undefined,
    openingDate: loc.openingDate || undefined,
    parentOrganization: { "@id": ORG_ID },
    sameAs: [site.social.instagram, site.social.facebook, site.social.yelp].filter(Boolean),
    amenityFeature: (loc.features || []).map(f => ({ "@type": "LocationFeatureSpecification", name: f, value: true }))
  };
}

function fullMenuSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Menu",
    "@id": `${BASE_URL}/menu/#menu`,
    name: `${site.brand.name} Menu`,
    inLanguage: "en-US",
    hasMenuSection: menu.categories.map(cat => ({
      "@type": "MenuSection",
      name: cat.name,
      hasMenuItem: cat.items.map(it => ({
        "@type": "MenuItem",
        name: it.name,
        description: it.description || undefined,
        ...(it.price ? { offers: { "@type": "Offer", price: String(it.price).replace(/[^\d.]/g, ""), priceCurrency: "USD" } } : {})
      }))
    }))
  };
}

function faqSchema(faqs) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(f => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a }
    }))
  };
}

function jobPostingSchema(job) {
  const unit = job.payUnit || "HOUR";
  const locs = (job.locations || []).map(s => locBySlug[s]).filter(Boolean);
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description +
      (job.responsibilities?.length ? "\n\nResponsibilities:\n- " + job.responsibilities.join("\n- ") : "") +
      (job.requirements?.length ? "\n\nRequirements:\n- " + job.requirements.join("\n- ") : "") +
      (job.benefits?.length ? "\n\nBenefits:\n- " + job.benefits.join("\n- ") : ""),
    datePosted: new Date().toISOString().slice(0, 10),
    validThrough: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
    employmentType: job.employmentType || "FULL_TIME",
    hiringOrganization: {
      "@type": "Organization",
      name: site.brand.name,
      sameAs: BASE_URL,
      logo: `${BASE_URL}/images/brand/logo-lockup-light.png`
    },
    jobLocation: locs.map(l => ({
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        streetAddress: l.address.street,
        addressLocality: l.address.city,
        addressRegion: l.address.region,
        postalCode: l.address.zip,
        addressCountry: "US"
      }
    })),
    ...(job.payMin ? {
      baseSalary: {
        "@type": "MonetaryAmount",
        currency: "USD",
        value: {
          "@type": "QuantitativeValue",
          minValue: job.payMin,
          maxValue: job.payMax || job.payMin,
          unitText: unit
        }
      }
    } : {}),
    directApply: true
  };
}

function articleSchema(post) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${BASE_URL}/news/${post.slug}/#article`,
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    dateModified: post.date,
    image: post.image ? [`${BASE_URL}${post.image}`] : undefined,
    url: `${BASE_URL}/news/${post.slug}/`,
    mainEntityOfPage: { "@type": "WebPage", "@id": `${BASE_URL}/news/${post.slug}/` },
    author: { "@type": "Organization", name: site.brand.name, url: BASE_URL },
    publisher: { "@id": ORG_ID },
    inLanguage: "en-US"
  };
}

function webPageSchema({ name, description, canonical, breadcrumbId }) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name, description,
    url: `${BASE_URL}${canonical}`,
    isPartOf: { "@id": WEBSITE_ID },
    ...(breadcrumbId ? { breadcrumb: { "@id": breadcrumbId } } : {}),
    inLanguage: "en-US"
  };
}

// ---------- Head / shared HTML ----------
const head = ({ title, description, canonicalPath, ogImage = "/images/home/fish-taco.jpg", ogType = "website", lcpImage = null }) => `
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(title)}</title>
<meta name="description" content="${h(description)}">
<meta name="theme-color" content="#faf3e4">
<meta name="author" content="${h(site.brand.name)}">
<meta name="geo.region" content="US-CA">
<meta name="geo.placename" content="San Diego County">
<meta name="geo.position" content="32.97;-117.25">
<meta name="ICBM" content="32.97, -117.25">
<link rel="canonical" href="${BASE_URL}${canonicalPath}">
<link rel="alternate" hreflang="en-US" href="${BASE_URL}${canonicalPath}">
<link rel="alternate" hreflang="x-default" href="${BASE_URL}${canonicalPath}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
${site.verifications?.google ? `<meta name="google-site-verification" content="${h(site.verifications.google)}">` : ""}
${site.verifications?.bing ? `<meta name="msvalidate.01" content="${h(site.verifications.bing)}">` : ""}
<meta property="og:title" content="${h(title)}">
<meta property="og:description" content="${h(description)}">
<meta property="og:type" content="${ogType}">
<meta property="og:url" content="${BASE_URL}${canonicalPath}">
<meta property="og:image" content="${BASE_URL}${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="${h(site.brand.name)}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${h(title)}">
<meta name="twitter:description" content="${h(description)}">
<meta name="twitter:image" content="${BASE_URL}${ogImage}">
${lcpImage ? `<link rel="preload" as="image" href="${lcpImage}" fetchpriority="high">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Fraunces:ital,opsz,wght@0,9..144,500;1,9..144,400;1,9..144,500;1,9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
${site.seo?.ga4 ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${h(site.seo.ga4)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${h(site.seo.ga4)}',{anonymize_ip:true});</script>` : ""}
`;

const ticker = (variant = "") => `
<div class="ticker ${variant}" aria-hidden="true">
  <div class="ticker__track">
    ${Array(3).fill(0).map(() => site.ticker.map(w => `<span>${h(w)}</span><span class="ticker__dot">✦</span>`).join("")).join("")}
  </div>
</div>`;

const sunSvg = (cls = "") => `
<svg class="sun ${cls}" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="100" cy="100" r="36" fill="currentColor"/>
  <g stroke="currentColor" stroke-width="10" stroke-linecap="round">
    <line x1="100" y1="14" x2="100" y2="38"/>
    <line x1="100" y1="162" x2="100" y2="186"/>
    <line x1="14" y1="100" x2="38" y2="100"/>
    <line x1="162" y1="100" x2="186" y2="100"/>
    <line x1="39" y1="39" x2="57" y2="57"/>
    <line x1="143" y1="143" x2="161" y2="161"/>
    <line x1="39" y1="161" x2="57" y2="143"/>
    <line x1="143" y1="57" x2="161" y2="39"/>
  </g>
</svg>`;

const starBadge = (cls = "") => `
<svg class="${cls}" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M100 0 l20 40 44 -6 -14 42 32 28 -34 22 10 44 -42 -14 -24 38 -24 -38 -42 14 10 -44 -34 -22 32 -28 -14 -42 44 6z" fill="currentColor"/>
</svg>`;

const stickerBadge = () => `
<svg class="hero__sticker" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <path id="stickerCirc" d="M100,100 m-72,0 a72,72 0 1,1 144,0 a72,72 0 1,1 -144,0"/>
  </defs>
  <circle cx="100" cy="100" r="92" fill="#f5b72b" stroke="#1b1008" stroke-width="4"/>
  <circle cx="100" cy="100" r="80" fill="none" stroke="#1b1008" stroke-width="1.5" stroke-dasharray="3 5"/>
  <text font-family="Archivo Black, sans-serif" font-size="16" fill="#1b1008" letter-spacing="4">
    <textPath href="#stickerCirc" startOffset="0">FRESH · HECHO CON CARIÑO · FRESH · HECHO CON CARIÑO · </textPath>
  </text>
  <text x="100" y="95" text-anchor="middle" font-family="Fraunces, serif" font-style="italic" font-size="32" fill="#1b1008" font-weight="500">voted</text>
  <text x="100" y="125" text-anchor="middle" font-family="Archivo Black, sans-serif" font-size="42" fill="#d84a1e" letter-spacing="-2">#1</text>
</svg>`;

const iconFlame = () => `<svg class="pillar__icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M32 56c11 0 18-7 18-17 0-9-8-12-10-20-1-4 0-8 0-8s-12 6-16 16c-2 5 0 9 0 9s-6-3-6-9c0 0-6 7-6 15 0 9 6 14 14 14"/></svg>`;
const iconFish = () => `<svg class="pillar__icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 32c8-10 20-14 32-14 10 0 18 4 20 8-2 4-10 8-20 8-12 0-24-4-32-2zM38 26v12M46 32h4"/><circle cx="42" cy="30" r="1.5" fill="currentColor"/><path d="M54 20l6-6M54 44l6 6"/></svg>`;
const iconGlass = () => `<svg class="pillar__icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M16 14h32l-4 22c-1 5-5 8-12 8s-11-3-12-8L16 14zM32 44v14M22 58h20"/><circle cx="26" cy="20" r="2" fill="currentColor"/><circle cx="36" cy="24" r="1.5" fill="currentColor"/></svg>`;

const header = () => `
<header class="site-header">
  <div class="site-header__bar">
    <a class="logo" href="/" aria-label="${h(site.brand.name)} home">
      <img src="/images/brand/logo-badge.png" alt="${h(site.brand.name)}" width="56" height="56">
    </a>
    <nav class="nav" aria-label="Primary">
      ${site.nav.map(n => `<a href="${h(n.href)}">${h(n.label)}</a>`).join("")}
    </nav>
    <a class="btn btn--order" href="/menu/">Order</a>
    <button class="nav-toggle" aria-label="Menu" aria-controls="mobile-nav" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
  </div>
  <div class="mobile-nav" id="mobile-nav" hidden>
    <div class="mobile-nav__bar">
      <a class="mobile-nav__logo" href="/" aria-label="${h(site.brand.name)} home">
        <img src="/images/brand/logo-badge.png" alt="" width="48" height="48">
      </a>
      <button class="mobile-nav__close" aria-label="Close menu" data-nav-close>
        <span></span><span></span>
      </button>
    </div>
    <nav aria-label="Mobile">
      ${site.nav.map(n => `<a href="${h(n.href)}">${h(n.label)}</a>`).join("")}
      <a class="btn btn--order" href="/menu/">Order online</a>
    </nav>
  </div>
</header>`;

const footer = () => `
<footer class="site-footer">
  ${sunSvg("")}
  <div class="site-footer__top">
    <div class="site-footer__brand">
      <img class="footer-logo" src="/images/brand/logo-lockup.png" alt="${h(site.brand.name)}">
      <p class="footer-tagline">Home of the <strong>$1.29</strong> Fish Taco.</p>
    </div>
    <div class="site-footer__cols">
      <div>
        <h4>Visit</h4>
        <ul>
          ${locations.filter(l=>!l.comingSoon).map(l => `<li><a href="/locations/${h(l.slug)}/">${h(l.name)}</a></li>`).join("")}
          <li><a href="/locations/la-jolla/">La Jolla <span class="tag">soon</span></a></li>
        </ul>
      </div>
      <div>
        <h4>Menu</h4>
        <ul>
          <li><a href="/menu/">Food &amp; drink</a></li>
          <li><a href="/catering/">Catering</a></li>
          <li><a href="/event-space/">Private events</a></li>
        </ul>
      </div>
      <div>
        <h4>About</h4>
        <ul>
          <li><a href="/gives-back/">Gives back</a></li>
          <li><a href="/news/">News</a></li>
          <li><a href="/careers/">Careers</a></li>
          <li><a href="/gallery/">Gallery</a></li>
          <li><a href="/contact/">Contact</a></li>
        </ul>
      </div>
      <div>
        <h4>Follow</h4>
        <ul>
          <li><a href="${h(site.social.instagram)}" rel="noopener">Instagram</a></li>
          <li><a href="${h(site.social.facebook)}" rel="noopener">Facebook</a></li>
          <li><a href="${h(site.social.yelp)}" rel="noopener">Yelp</a></li>
        </ul>
      </div>
    </div>
  </div>
  <div class="site-footer__legal">
    <small>© ${new Date().getFullYear()} ${h(site.brand.name)} · All rights reserved</small>
    <nav aria-label="Legal">
      <a href="/privacy-policy/">Privacy</a>
      <a href="/terms/">Terms</a>
      <a href="/accessibility-statement/">Accessibility</a>
      <a href="/cookie-policy/">Cookies</a>
      <a href="/californiaconsumerprivacy/">CCPA</a>
    </nav>
  </div>
</footer>
<script src="/scripts/app.js" defer></script>`;

const layout = ({ title, description, canonicalPath, body, ogImage, lcpImage, bodyClass = "", schema = [] }) => `<!doctype html>
<html lang="en-US">
<head>${head({ title, description, canonicalPath, ogImage, lcpImage })}
${schema.map(s => jsonLd(s)).join("\n")}
</head>
<body class="${h(bodyClass)}">
${ticker()}
${header()}
<main>${body}</main>
${footer()}
</body>
</html>`;

// ---------- Home ----------
function renderHome() {
  const hero = site.home.hero;
  const pillars = site.home.pillars;
  const pillarIcons = [iconFlame(), iconFish(), iconGlass()];
  const body = `
<section class="hero">
  ${sunSvg("sun--hero")}
  <div class="hero__inner">
    <div class="hero__copy">
      <p class="eyebrow">${h(hero.eyebrow)}</p>
      <h1 class="hero__headline">${h(hero.headline)}<br><em>${h(hero.headlineAccent)}</em></h1>
      <p class="hero__sub">${h(hero.sub)}</p>
      <div class="cta-row">
        <a class="btn btn--primary" href="${h(hero.primaryCta.href)}">${h(hero.primaryCta.label)}</a>
        <a class="btn btn--ghost" href="${h(hero.secondaryCta.href)}">${h(hero.secondaryCta.label)}</a>
      </div>
    </div>
    <div class="hero__media">
      <img src="${h(hero.image)}" alt="Fresh Mexican food at El Pueblo — fish tacos from Cardiff, Carlsbad, Carmel Valley, and Del Mar" loading="eager">
    </div>
  </div>
</section>

${ticker("ticker--marigold")}

<section class="award-band">
  <div class="award-band__inner">
    ${starBadge("award-band__star")}
    <p class="award-band__text"><em>Voted</em> #1 on Yelp's Top Ten — North San Diego County</p>
    ${starBadge("award-band__star")}
  </div>
</section>

<section class="section section--cream">
  <div class="section__inner">
    <header class="section__head section__head--center">
      <p class="eyebrow">Why locals keep coming back</p>
      <h2 class="display-sm">Three reasons <span class="serif" style="color:var(--terracotta)">we're #1</span></h2>
    </header>
    <div class="pillars">
      ${pillars.map((p, i) => `
      <article class="pillar">
        ${pillarIcons[i % pillarIcons.length]}
        <h3>${h(p.title)}</h3>
        <p>${h(p.body)}</p>
      </article>`).join("")}
    </div>
  </div>
</section>

<section class="feature-fish">
  <div class="feature-fish__inner">
    <div>
      <p class="eyebrow" style="color:var(--marigold)">The signature</p>
      <h2>The famous <em>$1.29</em> Fish Taco.</h2>
      <p>Crispy fried-to-order fillet, chipotle sauce, fresh pico, crisp cabbage on a warm corn tortilla. Order one. Order ten. There is no limit — and there never has been.</p>
      <div class="cta-row">
        <a class="btn btn--marigold" href="/menu/">See the full menu</a>
        <a class="btn btn--ghost" href="/locations/">Find a location</a>
      </div>
    </div>
    <div class="feature-fish__media" style="background-image:url('/images/home/fish-taco.jpg')">
      <div class="feature-fish__price">
        <small>Fish Taco</small>
        <strong>$1.29</strong>
        <em>unlimited</em>
      </div>
    </div>
  </div>
</section>

${ticker("ticker--agave")}

<section class="section section--cream-2">
  <div class="section__inner">
    <header class="section__head">
      <p class="eyebrow">Five locations</p>
      <h2 class="display-sm">Find us across the <span class="serif" style="color:var(--terracotta)">north coast</span></h2>
    </header>
    <div class="locations-grid">
      <div class="grid">
        ${locations.map(l => `
        <a class="loc-card ${l.comingSoon ? "loc-card--soon" : ""}" href="/locations/${h(l.slug)}/">
          <div class="loc-card__media" style="background-image:url('${h(l.hero)}')">
            <span class="tag">${h(l.tag)}</span>
          </div>
          <div class="loc-card__body">
            <h3>${h(l.name)}</h3>
            <p class="loc-card__addr">${h(l.address.street)}<br>${h(l.address.city)}, ${h(l.address.region)}</p>
            <p class="loc-card__hours">${h(l.hours.summary)}</p>
          </div>
        </a>`).join("")}
      </div>
    </div>
  </div>
</section>

<section class="home-scroller">
  <header class="home-scroller__head">
    <p class="eyebrow">On the menu</p>
    <h2 class="display-sm">A look at the <span class="serif" style="color:var(--terracotta)">kitchen</span></h2>
    <a class="home-scroller__link" href="/gallery/">See the full gallery →</a>
  </header>
  <div class="home-scroller__track">
    ${galleryPhotos().slice(0, 14).map(p => `
    <figure class="home-scroller__item">
      <img src="${h(p.src)}" alt="${h(p.alt)}" loading="lazy">
    </figure>`).join("")}
    <a class="home-scroller__end" href="/gallery/">
      <span>See<br>all<br>photos →</span>
    </a>
  </div>
</section>

<section class="section section--wall">
  <div class="cta-band">
    <h2>Planning a <em>big</em> party?</h2>
    <p>Taco bars, party packs, and full-service catering at all four current locations — plus heated patios for private events.</p>
    <div class="cta-row">
      <a class="btn btn--primary" href="/catering/">Order catering</a>
      <a class="btn btn--ghost" href="/event-space/">Book our patio</a>
    </div>
  </div>
</section>

${ticker("ticker--terracotta")}
`;
  const faqs = [
    { q: "Where is the $1.29 Fish Taco sold?", a: "At every El Pueblo location — Cardiff, Carlsbad, Carmel Valley, and Del Mar. La Jolla opens Spring 2026." },
    { q: "Is there a limit on how many fish tacos I can order?", a: "No. The $1.29 Fish Taco is unlimited. Order one. Order ten. Same price." },
    { q: "What time do you open?", a: "Cardiff is open 24 hours. Carmel Valley and Del Mar are open 6am to midnight daily. Carlsbad is 6am to 10pm (Sun-Thu) and 6am to midnight (Fri-Sat)." },
    { q: "Do you have a full bar?", a: "Yes — full bars at Del Mar and Carmel Valley, with beers on tap at Del Mar, premium tequila and mezcal, and house margaritas." },
    { q: "Do you cater?", a: "Yes. Same-day Party Packs (rolled tacos, enchiladas, quesadilla trays, make-your-own taco packs) and full-service catering with taco bars at all four open locations." }
  ];
  return layout({
    title: `Mexican Food in North County San Diego | ${site.brand.name} — 5 Locations`,
    description: "Fresh Mexican food in North San Diego County. Cardiff, Carlsbad, Carmel Valley, Del Mar — and La Jolla opening soon. Voted #1 on Yelp. Fish tacos, full bars, open late.",
    canonicalPath: "/",
    body,
    ogImage: "/og/home.jpg",
    lcpImage: hero.image,
    bodyClass: "page-home",
    schema: [
      organizationSchema(),
      websiteSchema(),
      ...locations.map(restaurantSchema),
      faqSchema(faqs)
    ]
  });
}

// ---------- Locations ----------
function renderLocationsIndex() {
  const body = `
<section class="page-head">
  <p class="eyebrow">Five locations</p>
  <h1 class="display">Find<br>El Pueblo<br><span class="serif" style="color:var(--terracotta)">near you.</span></h1>
  <p class="lede">Fresh Mexican food across North County San Diego — from early morning breakfast burritos in Cardiff to late-night tacos in Del Mar.</p>
</section>

${ticker("ticker--terracotta")}

<section class="section section--cream">
  <div class="section__inner">
    <div class="locations-grid">
      <div class="grid">
        ${locations.map(l => `
        <a class="loc-card ${l.comingSoon ? "loc-card--soon" : ""}" href="/locations/${h(l.slug)}/">
          <div class="loc-card__media" style="background-image:url('${h(l.hero)}')">
            <span class="tag">${h(l.tag)}</span>
          </div>
          <div class="loc-card__body">
            <h2>${h(l.name)}</h2>
            <p class="loc-card__addr">${h(l.address.street)}<br>${h(l.address.city)}, ${h(l.address.region)} ${h(l.address.zip)}</p>
            ${l.phone ? `<p class="loc-card__phone">${h(l.phone)}</p>` : ""}
            <p class="loc-card__hours">${h(l.hours.summary)}</p>
          </div>
        </a>`).join("")}
      </div>
    </div>
  </div>
</section>
`;
  const crumbs = breadcrumbSchema([{ name: "Home", url: "/" }, { name: "Locations", url: "/locations/" }]);
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: locations.map((l, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@id": `${BASE_URL}/locations/${l.slug}/#restaurant`,
        name: `${site.brand.name} — ${l.name}`,
        url: `${BASE_URL}/locations/${l.slug}/`
      }
    }))
  };
  return layout({
    title: `Locations — ${site.brand.name} | 5 in North County San Diego`,
    description: "All five El Pueblo Mexican Food locations: Cardiff-by-the-Sea (24 hours), Carlsbad (La Costa Town Square), Carmel Valley (full bar), Del Mar (beers on tap), and La Jolla (Spring 2026).",
    canonicalPath: "/locations/",
    body,
    ogImage: "/og/locations.jpg",
    bodyClass: "page-locations",
    schema: [crumbs, itemList]
  });
}

function renderLocation(loc) {
  const body = `
<section class="location-hero">
  <div class="location-hero__inner">
    <div class="location-hero__copy">
      <p class="eyebrow">${h(loc.tag)}</p>
      <h1 class="display">El Pueblo<br><em>${h(loc.name)}</em></h1>
      <p class="lede">${h(loc.description)}</p>
      <div class="cta-row">
        ${loc.orderOnlineUrl ? `<a class="btn btn--primary" href="${h(loc.orderOnlineUrl)}" target="_blank" rel="noopener">Order online</a>` : ""}
        <a class="btn btn--ghost" href="${h(loc.mapsUrl)}" target="_blank" rel="noopener">Directions</a>
        ${loc.phone ? `<a class="btn btn--ghost" href="tel:${h(loc.phoneE164)}">${h(loc.phone)}</a>` : ""}
      </div>
    </div>
    <div class="location-hero__media">
      <img src="${h(loc.hero)}" alt="El Pueblo ${h(loc.name)}" loading="eager">
    </div>
  </div>
</section>

${ticker("ticker--agave")}

<section class="location-info">
  <div class="info-block">
    <h2>Address</h2>
    <address>
      ${h(loc.address.street)}<br>
      ${h(loc.address.city)}, ${h(loc.address.region)} ${h(loc.address.zip)}
    </address>
  </div>
  <div class="info-block">
    <h2>Hours</h2>
    <p>${h(loc.hours.summary)}</p>
  </div>
  ${loc.features?.length ? `<div class="info-block">
    <h2>What to expect</h2>
    <ul class="features">${loc.features.map(f => `<li>${h(f)}</li>`).join("")}</ul>
  </div>` : ""}
</section>

${loc.body?.sections?.length ? `
<section class="location-longform">
  <div class="location-longform__inner">
    ${loc.body.sections.map(s => `
    <article class="location-longform__section">
      <h2>${h(s.h2)}</h2>
      ${s.paragraphs.map(p => `<p>${h(p)}</p>`).join("")}
    </article>`).join("")}
  </div>
</section>` : ""}

${loc.body?.faq?.length ? `
<section class="location-faq">
  <div class="location-faq__inner">
    <header class="location-faq__head">
      <p class="eyebrow">Frequently asked</p>
      <h2 class="display-sm">${h(loc.name)} — <span class="serif" style="color:var(--terracotta)">questions</span></h2>
    </header>
    <div class="faq-list">
      ${loc.body.faq.map(f => `
      <details class="faq-item">
        <summary>${h(f.q)}</summary>
        <div class="faq-item__a"><p>${h(f.a)}</p></div>
      </details>`).join("")}
    </div>
  </div>
</section>` : ""}

<section class="section section--cream">
  <div class="cta-band">
    <h2>Hungry, <em>${h(loc.short)}</em>?</h2>
    <p>Order pickup, browse the menu, or drop in — we're ready.</p>
    <div class="cta-row">
      ${loc.orderOnlineUrl ? `<a class="btn btn--primary" href="${h(loc.orderOnlineUrl)}" target="_blank" rel="noopener">Order from ${h(loc.short)}</a>` : `<a class="btn btn--primary" href="/menu/">See the menu</a>`}
      <a class="btn btn--ghost" href="/locations/">Other locations</a>
    </div>
  </div>
</section>

${ticker("ticker--terracotta")}
`;
  const crumbs = breadcrumbSchema([
    { name: "Home", url: "/" },
    { name: "Locations", url: "/locations/" },
    { name: loc.name, url: `/locations/${loc.slug}/` }
  ]);
  const schemas = [restaurantSchema(loc), crumbs];
  if (loc.body?.faq?.length) schemas.push(faqSchema(loc.body.faq));
  return layout({
    title: loc.seoTitle || `${site.brand.name} ${loc.name} — ${loc.address.city}, CA`,
    description: loc.seoDescription || `${site.brand.name} in ${loc.name}: ${loc.address.street}, ${loc.address.city}. ${loc.hours.summary}. ${loc.phone || ""}`.trim(),
    canonicalPath: `/locations/${loc.slug}/`,
    body,
    ogImage: `/og/location-${loc.slug}.jpg`,
    lcpImage: loc.hero,
    bodyClass: `page-location page-location--${loc.slug}`,
    schema: schemas
  });
}

// ---------- Menu ----------
function renderMenu() {
  const orderLinks = locations.filter(l => l.orderOnlineUrl).map(l => ({ name: l.short, href: l.orderOnlineUrl }));
  const totalItems = menu.categories.reduce((a, c) => a + c.items.length, 0);
  const body = `
<section class="page-head page-head--menu">
  <p class="eyebrow">The menu</p>
  <h1 class="display">Fresh&nbsp;food,<br><span class="serif" style="color:var(--terracotta)">every&nbsp;day.</span></h1>
  <p class="lede">Breakfast burritos from 6am. Our famous $1.29 fish tacos all day. Full bar with beers on tap in Del Mar. Order pickup from your nearest location.</p>
  <p class="menu-stats"><strong>${totalItems}</strong> items · <strong>${menu.categories.length}</strong> categories · <strong>4</strong> kitchens open now</p>
</section>

<section class="menu-featured">
  <div class="menu-featured__inner">
    <div class="menu-featured__media" style="background-image:url('/images/home/fish-taco.jpg')"></div>
    <div class="menu-featured__copy">
      <p class="eyebrow" style="color:var(--marigold)">Home of the</p>
      <h2>$1.29 <em>Fish Taco</em></h2>
      <p>Crispy fried-to-order fillet, chipotle sauce, fresh pico, crisp cabbage on a warm corn tortilla. Our signature, unlimited, every day of the year.</p>
      <div class="cta-row">
        ${orderLinks.map(o => `<a class="btn btn--marigold btn--sm" href="${h(o.href)}" target="_blank" rel="noopener">Order ${h(o.name)}</a>`).join("")}
      </div>
    </div>
  </div>
</section>

${ticker("ticker--agave")}

<nav class="menu-toc" aria-label="Menu sections">
  <div class="menu-toc__inner">
    ${menu.categories.map(c => `<a href="#${slugify(c.name)}">${h(c.name)}</a>`).join("")}
  </div>
</nav>

<section class="section section--cream menu-sections">
  <div class="section__inner">
    ${menu.categories.map((c, i) => `
    <section class="menu-cat" id="${slugify(c.name)}">
      <header class="menu-cat__head">
        <p class="menu-cat__num">${String(i+1).padStart(2,"0")}</p>
        <h2>${h(c.name)}</h2>
        <span class="menu-cat__count">${c.items.length} items</span>
      </header>
      <ul class="menu-items">
        ${c.items.map(it => `
        <li class="menu-item ${it.featured ? 'menu-item--featured' : ''}">
          ${it.featured ? `<span class="menu-item__badge">Signature · $1.29</span>` : ''}
          <h3>${h(it.name)}</h3>
          ${it.description ? `<p>${h(it.description)}</p>` : ""}
        </li>`).join("")}
      </ul>
    </section>`).join("")}
  </div>
</section>

<section class="section section--cream-2 menu-bar">
  <div class="section__inner">
    <header class="section__head section__head--center">
      <p class="eyebrow">At the bar</p>
      <h2 class="display-sm">Full bars at <span class="serif" style="color:var(--terracotta)">Del Mar</span> &amp; <span class="serif" style="color:var(--terracotta)">Carmel Valley</span></h2>
      <p class="lede">beers on tap at Del Mar. Premium tequila and mezcal flights. House margaritas. Ask your server for the current list — seasonal rotations are on the board.</p>
      <div class="cta-row" style="justify-content:center;margin-top:24px;">
        <a class="btn btn--primary" href="/locations/del-mar/">Visit Del Mar</a>
        <a class="btn btn--ghost" href="/locations/carmel-valley/">Visit Carmel Valley</a>
      </div>
    </header>
  </div>
</section>

<section class="section section--wall">
  <div class="cta-band">
    <h2>Ready to <em>order</em>?</h2>
    <p>Pickup from the El Pueblo closest to you. Orders placed directly with our kitchens — no third-party fees.</p>
    <div class="cta-row">
      ${orderLinks.map(o => `<a class="btn btn--primary" href="${h(o.href)}" target="_blank" rel="noopener">${h(o.name)}</a>`).join("")}
    </div>
  </div>
</section>

${ticker("ticker--marigold")}
`;
  const crumbs = breadcrumbSchema([{ name: "Home", url: "/" }, { name: "Menu", url: "/menu/" }]);
  return layout({
    title: `Menu — ${site.brand.name} | Fish Tacos, Burritos, Plates`,
    description: "The full El Pueblo menu — breakfast burritos, $1.29 fish tacos, bowls, enchiladas, quesadillas, plates, and drinks. Order pickup from Cardiff, Carlsbad, Carmel Valley, or Del Mar.",
    canonicalPath: "/menu/",
    body,
    ogImage: "/og/menu.jpg",
    bodyClass: "page-menu",
    schema: [fullMenuSchema(), crumbs]
  });
}

// ---------- Catering ----------
function renderCatering() {
  const c = site.catering;
  const body = `
<section class="page-head">
  <p class="eyebrow">${h(c.heroEyebrow)}</p>
  <h1 class="display">${h(c.heroHeadline)}<span class="serif" style="color:var(--terracotta)"></span></h1>
  <p class="lede">${h(c.heroSub)}</p>
  <div class="cta-row">
    <a class="btn btn--primary" href="#catering-request">Request catering</a>
    <a class="btn btn--ghost" href="#party-packs">See party packs</a>
  </div>
</section>

${ticker("ticker--marigold")}

<section class="section section--cream" id="party-packs">
  <div class="section__inner">
    <header class="section__head section__head--center">
      <p class="eyebrow">Same-day options</p>
      <h2 class="display-sm">Party <span class="serif" style="color:var(--terracotta)">packs.</span></h2>
    </header>
    <div class="party-grid">
      ${c.partyPacks.map(p => `
      <article class="party-card">
        <h3>${h(p.name)}</h3>
        <p class="party-card__serves"><strong>${h(p.serves)}</strong></p>
        <p>${h(p.description)}</p>
      </article>`).join("")}
    </div>
    <p class="party-note">${h(c.closingNote)}</p>
  </div>
</section>

<section class="section section--cream-2" id="catering-request">
  <div class="section__inner">
    <header class="section__head section__head--center">
      <p class="eyebrow">Full-service catering</p>
      <h2 class="display-sm">Request a <span class="serif" style="color:var(--terracotta)">catering order.</span></h2>
      <p class="lede">Tell us what you need. We'll confirm availability and pricing at your closest El Pueblo.</p>
    </header>
    <form class="stack-form" action="/api/catering" method="post">
      <div class="stack-form__row">
        <label>Name<input name="name" required></label>
        <label>Email<input type="email" name="email" required></label>
      </div>
      <div class="stack-form__row">
        <label>Phone<input type="tel" name="phone"></label>
        <label>Business / Organization<input name="organization"></label>
      </div>
      <label>Nearest location
        <select name="location" required>
          <option value="">Choose a location</option>
          ${locations.filter(l => !l.comingSoon).map(l => `<option value="${h(l.slug)}">${h(l.name)}</option>`).join("")}
        </select>
      </label>
      <label>Date needed<input type="date" name="date"></label>
      <label>How can we help?<textarea name="message" rows="5" placeholder="Party size, menu preferences, timing..."></textarea></label>
      <button class="btn btn--primary" type="submit">Send catering request</button>
      <p class="stack-form__hint">We'll reply within one business day.</p>
    </form>
  </div>
</section>

${ticker("ticker--terracotta")}
`;
  const crumbs = breadcrumbSchema([{ name: "Home", url: "/" }, { name: "Catering", url: "/catering/" }]);
  const catererSchema = {
    "@context": "https://schema.org",
    "@type": ["FoodEstablishment", "FoodService"],
    name: `${site.brand.name} Catering`,
    url: `${BASE_URL}/catering/`,
    parentOrganization: { "@id": ORG_ID },
    areaServed: [
      { "@type": "City", name: "Cardiff-by-the-Sea" },
      { "@type": "City", name: "Carlsbad" },
      { "@type": "City", name: "Del Mar" },
      { "@type": "City", name: "San Diego" },
      { "@type": "City", name: "Encinitas" },
      { "@type": "City", name: "Solana Beach" },
      { "@type": "City", name: "La Jolla" },
      { "@type": "City", name: "Rancho Santa Fe" }
    ],
    servesCuisine: ["Mexican", "Tex-Mex"],
    offers: c.partyPacks.map(p => ({
      "@type": "Offer",
      name: p.name,
      description: p.description
    }))
  };
  return layout({
    title: `Catering — ${site.brand.name} | Taco Bars & Party Packs`,
    description: "El Pueblo catering across San Diego County — taco bars, party packs (rolled tacos, enchiladas, quesadilla trays, make-your-own), full-service events. Request a quote from Cardiff, Carlsbad, Carmel Valley, or Del Mar.",
    canonicalPath: "/catering/",
    body,
    ogImage: "/og/catering.jpg",
    bodyClass: "page-catering",
    schema: [catererSchema, crumbs]
  });
}

// ---------- Event Space ----------
function renderEventSpace() {
  const e = site.events;
  const body = `
<section class="page-head">
  <p class="eyebrow">${h(e.heroEyebrow)}</p>
  <h1 class="display">${h(e.heroHeadline)}</h1>
  <p class="lede">${h(e.heroSub)}</p>
</section>

${ticker("ticker--agave")}

<section class="section section--cream">
  <div class="section__inner split">
    <div>
      <h2 class="display-sm">What's <span class="serif" style="color:var(--terracotta)">included.</span></h2>
      <ul class="features features--large">
        ${e.bullets.map(b => `<li>${h(b)}</li>`).join("")}
      </ul>
      <p class="note">${h(e.note)}</p>
    </div>
    <div class="event-card">
      <h3>Venue options</h3>
      <ul class="venue-list">
        <li>
          <strong>Del Mar</strong>
          <p>2673 Via De La Valle, Suite C<br>Heated patio · beers on tap · Full bar</p>
          <a class="btn btn--sm btn--ghost" href="/locations/del-mar/">View details</a>
        </li>
        <li>
          <strong>Carmel Valley</strong>
          <p>5965 Village Way, Suite E107<br>Heated patio · Full bar · Mezcal &amp; craft margaritas</p>
          <a class="btn btn--sm btn--ghost" href="/locations/carmel-valley/">View details</a>
        </li>
      </ul>
    </div>
  </div>
</section>

<section class="section section--cream-2" id="event-request">
  <div class="section__inner">
    <header class="section__head section__head--center">
      <p class="eyebrow">Reserve the patio</p>
      <h2 class="display-sm">Book your <span class="serif" style="color:var(--terracotta)">event.</span></h2>
      <p class="lede">Tell us a little about your event — we'll reach out with availability and a menu proposal.</p>
    </header>
    <form class="stack-form" action="/api/event" method="post">
      <div class="stack-form__row">
        <label>Name<input name="name" required></label>
        <label>Email<input type="email" name="email" required></label>
      </div>
      <div class="stack-form__row">
        <label>Phone<input type="tel" name="phone"></label>
        <label>Organization<input name="organization"></label>
      </div>
      <div class="stack-form__row">
        <label>Preferred location
          <select name="location">
            <option value="del-mar">Del Mar</option>
            <option value="carmel-valley">Carmel Valley</option>
          </select>
        </label>
        <label>Party size<input type="number" name="party_size" min="8" placeholder="Minimum 8"></label>
      </div>
      <div class="stack-form__row">
        <label>Date<input type="date" name="date"></label>
        <label>Time<input type="time" name="time"></label>
      </div>
      <label>Comments<textarea name="message" rows="5" placeholder="Event type, menu preferences, dietary needs..."></textarea></label>
      <button class="btn btn--primary" type="submit">Send event request</button>
      <p class="stack-form__hint">We'll confirm within one business day.</p>
    </form>
  </div>
</section>

${ticker("ticker--terracotta")}
`;
  const crumbs = breadcrumbSchema([{ name: "Home", url: "/" }, { name: "Event Space", url: "/event-space/" }]);
  return layout({
    title: `Private Events — ${site.brand.name} | Heated Patios in San Diego`,
    description: "Host your next event at El Pueblo — heated patios at Del Mar and Carmel Valley, full bar, craft margaritas, custom menus. Minimum party of 8. Request availability today.",
    canonicalPath: "/event-space/",
    body,
    ogImage: "/og/event-space.jpg",
    bodyClass: "page-events",
    schema: [webPageSchema({ name: "Private Events", description: "Heated patios and private events at El Pueblo Mexican Food.", canonical: "/event-space/" }), crumbs]
  });
}

// ---------- Gives Back ----------
function renderGivesBack() {
  const g = site.givesBack;
  const body = `
<section class="page-head">
  <p class="eyebrow">${h(g.heroEyebrow)}</p>
  <h1 class="display">${h(g.heroHeadline)}</h1>
  <p class="lede">${h(g.heroSub)}</p>
  <p class="note"><strong>${h(g.applyNote)}</strong></p>
</section>

${ticker("ticker--marigold")}

<section class="section section--cream">
  <div class="section__inner split">
    <div>
      <h2 class="display-sm">Who we <span class="serif" style="color:var(--agave)">support.</span></h2>
      <ul class="features features--check">
        ${g.eligible.map(x => `<li>${h(x)}</li>`).join("")}
      </ul>
    </div>
    <div>
      <h2 class="display-sm">Who we <span class="serif" style="color:var(--terracotta)">can't.</span></h2>
      <ul class="features features--x">
        ${g.ineligible.map(x => `<li>${h(x)}</li>`).join("")}
      </ul>
    </div>
  </div>
  <p class="note note--small">${h(g.disclaimer)}</p>
</section>

<section class="section section--cream-2" id="fundraiser-request">
  <div class="section__inner">
    <header class="section__head section__head--center">
      <p class="eyebrow">Apply to partner</p>
      <h2 class="display-sm">Submit a <span class="serif" style="color:var(--terracotta)">fundraiser application.</span></h2>
    </header>
    <form class="stack-form" action="/api/fundraiser" method="post">
      <div class="stack-form__row">
        <label>Contact name<input name="name" required></label>
        <label>Email<input type="email" name="email" required></label>
      </div>
      <div class="stack-form__row">
        <label>Phone<input type="tel" name="phone"></label>
        <label>Organization<input name="organization" required></label>
      </div>
      <div class="stack-form__row">
        <label>501(c)(3) / Tax ID<input name="tax_id"></label>
        <label>Requested date<input type="date" name="date"></label>
      </div>
      <label>Preferred location
        <select name="location">
          <option value="">Any location</option>
          ${locations.filter(l => !l.comingSoon).map(l => `<option value="${h(l.slug)}">${h(l.name)}</option>`).join("")}
        </select>
      </label>
      <label>Tell us about your cause<textarea name="message" rows="5"></textarea></label>
      <button class="btn btn--primary" type="submit">Submit application</button>
      <p class="stack-form__hint">We review applications in the order they're received. Please allow at least 30 days notice.</p>
    </form>
  </div>
</section>

${ticker("ticker--terracotta")}
`;
  const crumbs = breadcrumbSchema([{ name: "Home", url: "/" }, { name: "Gives Back", url: "/gives-back/" }]);
  return layout({
    title: `Gives Back — ${site.brand.name} | Community Fundraisers`,
    description: "El Pueblo gives back to the community. We donate 20% of net proceeds to schools, youth programs, and 501(c)(3) organizations. Apply for a fundraiser partnership.",
    canonicalPath: "/gives-back/",
    body,
    ogImage: "/og/gives-back.jpg",
    bodyClass: "page-gives-back",
    schema: [webPageSchema({ name: "El Pueblo Gives Back", description: "Community fundraiser partnerships with El Pueblo Mexican Food.", canonical: "/gives-back/" }), crumbs]
  });
}

// ---------- Contact ----------
function renderContact() {
  const c = site.contact;
  const body = `
<section class="page-head">
  <p class="eyebrow">${h(c.heroEyebrow)}</p>
  <h1 class="display">${h(c.heroHeadline)}</h1>
  <p class="lede">${h(c.heroSub)}</p>
</section>

${ticker("ticker--agave")}

<section class="section section--cream">
  <div class="section__inner">
    <div class="contact-grid">
      ${locations.map(l => `
      <article class="contact-card ${l.comingSoon ? 'contact-card--soon' : ''}">
        <header>
          <h2>${h(l.name)}</h2>
          <span class="tag">${h(l.tag)}</span>
        </header>
        <address>${h(l.address.street)}<br>${h(l.address.city)}, ${h(l.address.region)} ${h(l.address.zip)}</address>
        ${l.phone ? `<p><a href="tel:${h(l.phoneE164)}">${h(l.phone)}</a></p>` : ""}
        <p class="contact-card__hours">${h(l.hours.summary)}</p>
        <div class="cta-row cta-row--sm">
          ${!l.comingSoon ? `<a class="btn btn--sm btn--primary" href="/locations/${h(l.slug)}/">Details</a>` : ""}
          <a class="btn btn--sm btn--ghost" href="${h(l.mapsUrl)}" target="_blank" rel="noopener">Directions</a>
        </div>
      </article>`).join("")}
    </div>
  </div>
</section>

<section class="section section--cream-2">
  <div class="section__inner">
    <header class="section__head section__head--center">
      <p class="eyebrow">Send a message</p>
      <h2 class="display-sm">We'd love to <span class="serif" style="color:var(--terracotta)">hear from you.</span></h2>
    </header>
    <form class="stack-form" action="/api/contact" method="post">
      <div class="stack-form__row">
        <label>Name<input name="name" required></label>
        <label>Email<input type="email" name="email" required></label>
      </div>
      <label>About which location?
        <select name="location">
          <option value="">Any / general</option>
          ${locations.map(l => `<option value="${h(l.slug)}">${h(l.name)}</option>`).join("")}
        </select>
      </label>
      <label>Message<textarea name="message" rows="5" required></textarea></label>
      <button class="btn btn--primary" type="submit">Send message</button>
      <p class="stack-form__hint">Or email us directly: <a href="mailto:${h(site.brand.email)}">${h(site.brand.email)}</a></p>
    </form>
  </div>
</section>

${ticker("ticker--terracotta")}
`;
  const crumbs = breadcrumbSchema([{ name: "Home", url: "/" }, { name: "Contact", url: "/contact/" }]);
  return layout({
    title: `Contact — ${site.brand.name} | All 5 Locations + Hours`,
    description: "Contact El Pueblo Mexican Food — addresses, phone, and hours for Cardiff (24hr), Carlsbad, Carmel Valley, Del Mar, and La Jolla (Spring 2026). Send us a message or stop by.",
    canonicalPath: "/contact/",
    body,
    ogImage: "/og/contact.jpg",
    bodyClass: "page-contact",
    schema: [webPageSchema({ name: "Contact El Pueblo", description: "Contact details and hours for all five El Pueblo Mexican Food locations.", canonical: "/contact/" }), crumbs]
  });
}

// ---------- Gallery ----------
function galleryPhotos() {
  const seenUrl = new Set();
  const seenHash = new Set();
  const out = [];
  const push = (src, alt) => {
    if (seenUrl.has(src)) return;
    seenUrl.add(src);
    const fp = path.join(outDir, src.replace(/^\//, ""));
    if (!fs.existsSync(fp)) return;
    const hash = crypto.createHash("md5").update(fs.readFileSync(fp)).digest("hex");
    if (seenHash.has(hash)) return;
    seenHash.add(hash);
    out.push({ src, alt });
  };
  push("/images/home/fish-taco.jpg", "The $1.29 fish taco at El Pueblo Mexican Food");
  for (const cat of menu.categories) {
    for (const it of cat.items) {
      if (it.image) push(it.image, `${it.name} at El Pueblo Mexican Food`);
    }
  }
  return out;
}

function renderGallery() {
  const g = site.gallery;
  const photos = galleryPhotos();
  const body = `
<section class="page-head">
  <p class="eyebrow">${h(g.heroEyebrow)}</p>
  <h1 class="display">${h(g.heroHeadline)}</h1>
  <p class="lede">${h(g.heroSub)}</p>
</section>

${ticker("ticker--marigold")}

<section class="section section--cream">
  <div class="section__inner">
    <div class="gallery-grid">
      ${photos.map(p => `
      <figure class="gallery-item">
        <img src="${h(p.src)}" alt="${h(p.alt)}" loading="lazy">
      </figure>`).join("")}
    </div>
  </div>
</section>

<section class="section section--cream-2">
  <div class="cta-band">
    <h2>See the <em>$1.29</em> fish taco?</h2>
    <p>Come taste it. Four locations open now, La Jolla opening Spring 2026.</p>
    <div class="cta-row">
      <a class="btn btn--primary" href="/locations/">Find a location</a>
      <a class="btn btn--ghost" href="/menu/">See the menu</a>
    </div>
  </div>
</section>

${ticker("ticker--terracotta")}
`;
  const crumbs = breadcrumbSchema([{ name: "Home", url: "/" }, { name: "Gallery", url: "/gallery/" }]);
  const imageGallery = {
    "@context": "https://schema.org",
    "@type": "ImageGallery",
    name: "El Pueblo Mexican Food Gallery",
    url: `${BASE_URL}/gallery/`,
    image: photos.map(p => `${BASE_URL}${p.src}`)
  };
  return layout({
    title: `Gallery — ${site.brand.name} | The Best Mex of the West`,
    description: "A virtual tour of El Pueblo Mexican Food — kitchens, patios, plates. Fresh fish tacos, carne asada, burritos, and more across our five San Diego locations.",
    canonicalPath: "/gallery/",
    body,
    ogImage: "/og/gallery.jpg",
    bodyClass: "page-gallery",
    schema: [imageGallery, crumbs]
  });
}

// ---------- Careers + Jobs ----------
function renderCareers() {
  const c = site.careers;
  const body = `
<section class="page-head">
  <p class="eyebrow">${h(c.heroEyebrow)}</p>
  <h1 class="display">${h(c.heroHeadline)}</h1>
  <p class="lede">${h(c.heroSub)}</p>
</section>

${ticker("ticker--marigold")}

<section class="section section--cream">
  <div class="section__inner">
    <header class="section__head">
      <p class="eyebrow">Open positions</p>
      <h2 class="display-sm">Current <span class="serif" style="color:var(--terracotta)">openings.</span></h2>
    </header>
    <div class="jobs-grid">
      ${jobs.map(j => `
      <a class="job-card" href="/jobs/${h(j.slug)}/">
        <div class="job-card__top">
          <h3>${h(j.title)}</h3>
          <span class="job-card__type">${h(j.type)}</span>
        </div>
        <p class="job-card__pay">${h(j.pay)}</p>
        <p class="job-card__locs">${j.locations.map(s => h(locBySlug[s]?.short || s)).join(" · ")}</p>
        <span class="job-card__cta">View job →</span>
      </a>`).join("")}
    </div>
  </div>
</section>

<section class="section section--cream-2">
  <div class="section__inner">
    <header class="section__head section__head--center">
      <p class="eyebrow">${h(c.benefitsIntro)}</p>
      <h2 class="display-sm">What you <span class="serif" style="color:var(--agave)">get.</span></h2>
    </header>
    <ul class="benefits">
      ${c.benefits.map(b => `<li>${h(b)}</li>`).join("")}
    </ul>
  </div>
</section>

${ticker("ticker--terracotta")}
`;
  const crumbs = breadcrumbSchema([{ name: "Home", url: "/" }, { name: "Careers", url: "/careers/" }]);
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "El Pueblo Open Positions",
    itemListElement: jobs.map((j, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${BASE_URL}/jobs/${j.slug}/`,
      name: j.title
    }))
  };
  return layout({
    title: `Careers — ${site.brand.name} | We're Hiring`,
    description: "Join the El Pueblo team — cooks, cashiers, bartenders, shift leaders, managers. Health insurance, free meal every shift, 401(K), raises based on performance. Apply today.",
    canonicalPath: "/careers/",
    body,
    ogImage: "/og/careers.jpg",
    bodyClass: "page-careers",
    schema: [itemList, crumbs]
  });
}

function renderJob(job) {
  const locs = (job.locations || []).map(s => locBySlug[s]).filter(Boolean);
  const body = `
<section class="page-head">
  <p class="eyebrow"><a href="/careers/">Careers</a> / ${h(job.type)}</p>
  <h1 class="display">${h(job.title)}</h1>
  <p class="lede">${h(job.description)}</p>
  <dl class="job-meta">
    <div><dt>Pay</dt><dd>${h(job.pay)}</dd></div>
    <div><dt>Type</dt><dd>${h(job.type)}</dd></div>
    <div><dt>Locations</dt><dd>${locs.map(l => h(l.short)).join(", ")}</dd></div>
  </dl>
  <div class="cta-row">
    <a class="btn btn--primary" href="#apply">Apply now</a>
    <a class="btn btn--ghost" href="/careers/">All openings</a>
  </div>
</section>

${ticker("ticker--agave")}

<section class="section section--cream">
  <div class="section__inner split">
    ${job.responsibilities?.length ? `<div>
      <h2 class="display-xs">Responsibilities</h2>
      <ul class="features">
        ${job.responsibilities.map(r => `<li>${h(r)}</li>`).join("")}
      </ul>
    </div>` : ""}
    ${job.requirements?.length ? `<div>
      <h2 class="display-xs">Requirements</h2>
      <ul class="features">
        ${job.requirements.map(r => `<li>${h(r)}</li>`).join("")}
      </ul>
    </div>` : ""}
  </div>
  ${job.benefits?.length ? `<div class="section__inner" style="margin-top:48px;">
    <h2 class="display-xs">Benefits</h2>
    <ul class="benefits">
      ${job.benefits.map(b => `<li>${h(b)}</li>`).join("")}
    </ul>
  </div>` : ""}
</section>

<section class="section section--cream-2" id="apply">
  <div class="section__inner">
    <header class="section__head section__head--center">
      <p class="eyebrow">Application</p>
      <h2 class="display-sm">Apply for <span class="serif" style="color:var(--terracotta)">${h(job.title)}.</span></h2>
      <p class="lede">El Pueblo is an Equal Opportunity Employer. Applications considered without regard to race, color, religion, sex, age, national origin, or any factor prohibited by law.</p>
    </header>
    <form class="stack-form" action="/api/employment" method="post" enctype="multipart/form-data">
      <input type="hidden" name="job_slug" value="${h(job.slug)}">
      <input type="hidden" name="job_title" value="${h(job.title)}">
      <div class="stack-form__row">
        <label>Full name<input name="name" required></label>
        <label>Email<input type="email" name="email" required></label>
      </div>
      <div class="stack-form__row">
        <label>Phone<input type="tel" name="phone" required></label>
        <label>City, State<input name="city" placeholder="e.g. Cardiff, CA"></label>
      </div>
      <label>Locations you can work
        <select name="preferred_locations" multiple size="5">
          ${locs.map(l => `<option value="${h(l.slug)}" selected>${h(l.name)}</option>`).join("")}
        </select>
      </label>
      <label>Previous employment history<textarea name="history" rows="4" placeholder="Recent roles, dates, responsibilities..."></textarea></label>
      <div class="stack-form__row">
        <label>Authorized to work in the U.S.?
          <select name="work_auth" required>
            <option value="">Choose</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>Background check consent?
          <select name="background_check">
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>
      <label>Resume (optional)<input type="file" name="resume" accept=".pdf,.doc,.docx"></label>
      <label>Why El Pueblo?<textarea name="message" rows="4"></textarea></label>
      <button class="btn btn--primary" type="submit">Submit application</button>
    </form>
  </div>
</section>

${ticker("ticker--terracotta")}
`;
  const crumbs = breadcrumbSchema([
    { name: "Home", url: "/" },
    { name: "Careers", url: "/careers/" },
    { name: job.title, url: `/jobs/${job.slug}/` }
  ]);
  return layout({
    title: `${job.title} — ${site.brand.name} | ${job.type}, ${job.pay}`,
    description: `${site.brand.name} is hiring a ${job.title}. ${job.pay}. ${locs.map(l => l.name).join(", ")}. Benefits include health insurance, free meal every shift, 401(K).`,
    canonicalPath: `/jobs/${job.slug}/`,
    body,
    ogImage: "/og/careers.jpg",
    bodyClass: `page-job page-job--${job.slug}`,
    schema: [jobPostingSchema(job), crumbs]
  });
}

// ---------- News (index + posts) ----------
function renderNewsIndex() {
  const body = `
<section class="page-head">
  <p class="eyebrow">From the kitchen</p>
  <h1 class="display">News &amp; <span class="serif" style="color:var(--terracotta)">stories.</span></h1>
  <p class="lede">Updates, openings, and stories from El Pueblo Mexican Food.</p>
</section>

${ticker("ticker--agave")}

<section class="section section--cream">
  <div class="section__inner">
    <div class="post-grid">
      ${posts.map(p => `
      <a class="post-card" href="/news/${h(p.slug)}/">
        ${fileExists(p.image) ? `<div class="post-card__media" style="background-image:url('${h(p.image)}')"></div>` : ""}
        <div class="post-card__body">
          <time>${h(p.date)}</time>
          <h2>${h(p.title)}</h2>
          <p>${h(p.excerpt)}</p>
          <span class="post-card__cta">Read more →</span>
        </div>
      </a>`).join("")}
    </div>
  </div>
</section>

${ticker("ticker--terracotta")}
`;
  const crumbs = breadcrumbSchema([{ name: "Home", url: "/" }, { name: "News", url: "/news/" }]);
  const blogSchema = {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${BASE_URL}/news/#blog`,
    name: `${site.brand.name} News`,
    url: `${BASE_URL}/news/`,
    publisher: { "@id": ORG_ID },
    blogPost: posts.map(p => ({
      "@type": "BlogPosting",
      headline: p.title,
      url: `${BASE_URL}/news/${p.slug}/`,
      datePublished: p.date
    }))
  };
  return layout({
    title: `News — ${site.brand.name} | Stories, Updates, Openings`,
    description: "Fresh from El Pueblo's kitchens — stories, recipes, openings, and updates across our five locations in North County San Diego.",
    canonicalPath: "/news/",
    body,
    ogImage: "/og/news.jpg",
    bodyClass: "page-news-index",
    schema: [blogSchema, crumbs]
  });
}

function renderPost(post) {
  const bodyBlocks = post.body.map(b => {
    if (b.type === "h2") return `<h2>${h(b.text)}</h2>`;
    if (b.type === "h3") return `<h3>${h(b.text)}</h3>`;
    if (b.type === "p") return `<p>${h(b.text)}</p>`;
    if (b.type === "ul") return `<ul>${b.items.map(it => `<li>${h(it)}</li>`).join("")}</ul>`;
    return "";
  }).join("\n");
  const heroImg = fileExists(post.image) ? post.image : null;
  const body = `
<article class="post">
  <header class="post__head">
    <p class="eyebrow"><a href="/news/">News</a> · ${h(post.date)}</p>
    <h1 class="display">${h(post.title)}</h1>
    <p class="lede">${h(post.excerpt)}</p>
  </header>
  ${heroImg ? `<figure class="post__hero">
    <img src="${h(heroImg)}" alt="${h(post.imageAlt || post.title)}" loading="eager">
  </figure>` : ""}
  <div class="post__body">
    ${bodyBlocks}
  </div>
  <footer class="post__foot">
    <a class="btn btn--ghost" href="/news/">← All news</a>
    <a class="btn btn--primary" href="/menu/">See the menu</a>
  </footer>
</article>
`;
  const crumbs = breadcrumbSchema([
    { name: "Home", url: "/" },
    { name: "News", url: "/news/" },
    { name: post.title, url: `/news/${post.slug}/` }
  ]);
  return layout({
    title: `${post.title} — ${site.brand.name}`,
    description: post.excerpt,
    canonicalPath: `/news/${post.slug}/`,
    body,
    ogImage: heroImg || "/og/news.jpg",
    ogType: "article",
    lcpImage: heroImg,
    bodyClass: "page-post",
    schema: [articleSchema(post), crumbs]
  });
}

// ---------- Legal ----------
function legalPage({ slug, title, description, sections }) {
  const body = `
<section class="page-head page-head--legal">
  <p class="eyebrow">Legal</p>
  <h1 class="display-sm">${h(title)}</h1>
  <p class="legal-updated">Last updated: ${new Date().toISOString().slice(0, 10)}</p>
</section>

<section class="section section--cream">
  <div class="section__inner legal-body">
    ${sections.map(s => `
    <section class="legal-section">
      ${s.h ? `<h2>${h(s.h)}</h2>` : ""}
      ${(s.p || []).map(p => `<p>${h(p)}</p>`).join("")}
      ${s.ul ? `<ul>${s.ul.map(x => `<li>${h(x)}</li>`).join("")}</ul>` : ""}
    </section>`).join("")}
  </div>
</section>
`;
  const crumbs = breadcrumbSchema([{ name: "Home", url: "/" }, { name: title, url: `/${slug}/` }]);
  return layout({
    title: `${title} — ${site.brand.name}`,
    description,
    canonicalPath: `/${slug}/`,
    body,
    ogImage: "/og/default.jpg",
    bodyClass: `page-legal page-legal--${slug}`,
    schema: [webPageSchema({ name: title, description, canonical: `/${slug}/` }), crumbs]
  });
}

const legalPages = [
  {
    slug: "privacy-policy",
    title: "Privacy Policy",
    description: "How El Pueblo Mexican Food collects, uses, and protects your personal information.",
    sections: [
      { p: [`This Privacy Policy explains how ${site.brand.name} ("we", "us", "our") collects, uses, and shares information about you when you use our website at elpueblomex.com or interact with us at our locations.`] },
      { h: "Information we collect", p: [
        "Contact details you provide through our forms: name, email, phone, organization, location preference, message content.",
        "Order information processed through our ordering partners (order.online) — handled under their respective privacy policies.",
        "Employment application information submitted through our careers forms.",
        "Website analytics data: pages visited, referring URL, general device and browser info, approximate location from IP address."
      ]},
      { h: "How we use information", p: [
        "To respond to your inquiries, catering requests, event bookings, and fundraiser applications.",
        "To process job applications and communicate with candidates.",
        "To improve our website, menu, and customer service.",
        "To comply with legal obligations and resolve disputes."
      ]},
      { h: "Sharing", p: [
        "We do not sell your personal information. We share information only with service providers (form processing, email delivery) bound by confidentiality, with our ordering partners when you place an order, and when required by law."
      ]},
      { h: "Your rights", p: [
        "California residents: see our California Consumer Privacy Act notice for your specific rights.",
        `You may request access, correction, or deletion of your information by emailing ${site.brand.email}.`
      ]},
      { h: "Contact", p: [`Questions about this policy? Email ${site.brand.email}.`] }
    ]
  },
  {
    slug: "terms",
    title: "Terms of Service",
    description: "Terms governing your use of the El Pueblo Mexican Food website and services.",
    sections: [
      { p: [`By accessing elpueblomex.com or using any service offered by ${site.brand.name}, you agree to these Terms of Service.`] },
      { h: "Use of the site", p: [
        "You agree to use this site lawfully and not to attempt to disrupt its operation or access restricted areas.",
        "Content on this site is provided for information about our menu, locations, and services. Menu items, pricing, and hours are subject to change."
      ]},
      { h: "Orders and payments", p: [
        "Online orders are processed through third-party partners (order.online). Their terms and conditions apply to the transaction.",
        "Pricing at the restaurant may differ from online promotions."
      ]},
      { h: "Intellectual property", p: [
        `All content on this site — text, images, logos, trademarks — is owned by ${site.brand.name} or used with permission. You may not reproduce, distribute, or create derivative works without written consent.`
      ]},
      { h: "Disclaimers", p: [
        "This site and its content are provided \"as is\" without warranty of any kind. We make reasonable efforts to keep information accurate but do not guarantee completeness.",
        "We are not liable for indirect, incidental, or consequential damages arising from your use of the site."
      ]},
      { h: "Governing law", p: ["These terms are governed by the laws of the State of California."] },
      { h: "Contact", p: [`Questions? Email ${site.brand.email}.`] }
    ]
  },
  {
    slug: "accessibility-statement",
    title: "Accessibility Statement",
    description: "El Pueblo Mexican Food's commitment to web accessibility and WCAG 2.1 AA standards.",
    sections: [
      { p: [`${site.brand.name} is committed to ensuring digital accessibility for people with disabilities. We are continually improving the user experience for everyone and applying the relevant accessibility standards.`] },
      { h: "Conformance status", p: [
        "This website aims to conform to Web Content Accessibility Guidelines (WCAG) 2.1 level AA. Conformance means the content fully meets the accessibility standard."
      ]},
      { h: "Features", p: [
        "Semantic HTML markup for assistive technology compatibility.",
        "Descriptive alt text on informational images.",
        "Keyboard-accessible navigation throughout the site.",
        "Sufficient color contrast on text and interactive elements.",
        "Text resizing up to 200% without loss of content or functionality."
      ]},
      { h: "Feedback", p: [
        `We welcome feedback on the accessibility of this site. If you encounter barriers, please contact us at ${site.brand.email} and we will work to address them promptly.`
      ]}
    ]
  },
  {
    slug: "cookie-policy",
    title: "Cookie Policy",
    description: "How El Pueblo Mexican Food uses cookies and similar tracking technologies.",
    sections: [
      { p: ["This Cookie Policy explains what cookies are, how we use them, and your choices for managing them."] },
      { h: "What are cookies?", p: [
        "Cookies are small text files placed on your device when you visit a website. They help the site recognize your device and remember certain information about your visit."
      ]},
      { h: "How we use cookies", p: [
        "Essential cookies: required for site functionality like form submissions.",
        "Analytics cookies: help us understand how visitors use the site so we can improve it. We use Google Analytics for this purpose when enabled.",
        "We do not use advertising cookies or sell cookie data to third parties."
      ]},
      { h: "Your choices", p: [
        "Most browsers let you block or delete cookies through their settings. Blocking essential cookies may prevent forms or some features from working."
      ]},
      { h: "Contact", p: [`Questions? Email ${site.brand.email}.`] }
    ]
  },
  {
    slug: "californiaconsumerprivacy",
    title: "California Consumer Privacy",
    description: "Your rights under the California Consumer Privacy Act (CCPA/CPRA).",
    sections: [
      { p: [`If you are a California resident, the California Consumer Privacy Act (CCPA), as amended by the California Privacy Rights Act (CPRA), gives you specific rights regarding your personal information collected by ${site.brand.name}.`] },
      { h: "Information we collect", p: [
        "Identifiers (name, email, phone) you submit through our forms.",
        "Employment-related information submitted through our careers forms.",
        "Commercial information related to orders placed through our ordering partners.",
        "Internet or electronic network activity: pages you visit, referring URLs, approximate location from IP, device/browser info."
      ]},
      { h: "Your rights", ul: [
        "Right to know what personal information we collect, use, and share.",
        "Right to request deletion of personal information we've collected from you.",
        "Right to correct inaccurate personal information.",
        "Right to opt-out of the sale or sharing of personal information (we do not sell).",
        "Right to limit use of sensitive personal information.",
        "Right to non-discrimination for exercising your CCPA rights."
      ]},
      { h: "How to exercise your rights", p: [
        `Email ${site.brand.email} with the subject line "CCPA Request" and tell us which right you are exercising. We may need to verify your identity before we can respond.`,
        "We will respond within 45 days."
      ]},
      { h: "Do Not Sell or Share", p: [
        "We do not sell your personal information and do not share it for cross-context behavioral advertising."
      ]}
    ]
  }
];

// ---------- 404 ----------
function render404() {
  const body = `
<section class="page-head page-head--center">
  <p class="eyebrow">404</p>
  <h1 class="display">Page not <span class="serif" style="color:var(--terracotta)">found.</span></h1>
  <p class="lede">That page doesn't exist — or maybe it moved when we rebuilt the site.</p>
  <div class="cta-row">
    <a class="btn btn--primary" href="/">Go home</a>
    <a class="btn btn--ghost" href="/menu/">See the menu</a>
    <a class="btn btn--ghost" href="/locations/">Find a location</a>
  </div>
</section>
${ticker("ticker--terracotta")}
`;
  return layout({
    title: `Page not found — ${site.brand.name}`,
    description: "The page you're looking for doesn't exist.",
    canonicalPath: "/404/",
    body,
    bodyClass: "page-404"
  });
}

// ---------- Sitemap + Robots ----------
function renderSitemap() {
  const urls = [
    { loc: "/", priority: 1.0, changefreq: "weekly" },
    { loc: "/menu/", priority: 0.9, changefreq: "weekly" },
    { loc: "/locations/", priority: 0.9, changefreq: "monthly" },
    ...locations.map(l => ({ loc: `/locations/${l.slug}/`, priority: 0.9, changefreq: "monthly" })),
    { loc: "/catering/", priority: 0.8, changefreq: "monthly" },
    { loc: "/event-space/", priority: 0.7, changefreq: "monthly" },
    { loc: "/gives-back/", priority: 0.6, changefreq: "monthly" },
    { loc: "/gallery/", priority: 0.5, changefreq: "monthly" },
    { loc: "/contact/", priority: 0.7, changefreq: "monthly" },
    { loc: "/news/", priority: 0.7, changefreq: "weekly" },
    ...posts.map(p => ({ loc: `/news/${p.slug}/`, priority: 0.5, changefreq: "yearly", lastmod: p.date })),
    { loc: "/careers/", priority: 0.7, changefreq: "weekly" },
    ...jobs.map(j => ({ loc: `/jobs/${j.slug}/`, priority: 0.6, changefreq: "weekly" })),
    { loc: "/privacy-policy/", priority: 0.3, changefreq: "yearly" },
    { loc: "/terms/", priority: 0.3, changefreq: "yearly" },
    { loc: "/accessibility-statement/", priority: 0.3, changefreq: "yearly" },
    { loc: "/cookie-policy/", priority: 0.3, changefreq: "yearly" },
    { loc: "/californiaconsumerprivacy/", priority: 0.3, changefreq: "yearly" }
  ];
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `<url><loc>${BASE_URL}${u.loc}</loc><lastmod>${u.lastmod || today}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join("\n")}
</urlset>`;
}

function renderRobots() {
  return `User-agent: *
Allow: /
Disallow: /edit/
Disallow: /api/
Disallow: /404/

Sitemap: ${BASE_URL}/sitemap.xml
`;
}

// ---------- Write ----------
function write(relPath, contents) {
  const full = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

function build() {
  fs.mkdirSync(outDir, { recursive: true });

  // Home
  write("index.html", renderHome());

  // Locations
  write("locations/index.html", renderLocationsIndex());
  for (const loc of locations) {
    write(`locations/${loc.slug}/index.html`, renderLocation(loc));
  }

  // Menu
  write("menu/index.html", renderMenu());

  // Info pages
  write("catering/index.html", renderCatering());
  write("event-space/index.html", renderEventSpace());
  write("gives-back/index.html", renderGivesBack());
  write("contact/index.html", renderContact());
  write("gallery/index.html", renderGallery());

  // Careers + Jobs
  write("careers/index.html", renderCareers());
  for (const job of jobs) {
    write(`jobs/${job.slug}/index.html`, renderJob(job));
  }

  // News + Posts
  write("news/index.html", renderNewsIndex());
  for (const post of posts) {
    write(`news/${post.slug}/index.html`, renderPost(post));
  }

  // Legal
  for (const lp of legalPages) {
    write(`${lp.slug}/index.html`, legalPage(lp));
  }

  // 404
  write("404.html", render404());

  // Sitemap + robots
  write("sitemap.xml", renderSitemap());
  write("robots.txt", renderRobots());

  console.log("✓ built:", fs.readdirSync(outDir));
}

build();
