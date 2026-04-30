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
const pressPath = path.join(root, "content/press.json");
const { press = [] } = fs.existsSync(pressPath)
  ? JSON.parse(fs.readFileSync(pressPath, "utf8"))
  : { press: [] };
const instagramPath = path.join(root, "content/instagram.json");
const instagram = fs.existsSync(instagramPath)
  ? JSON.parse(fs.readFileSync(instagramPath, "utf8"))
  : { handle: "", profileUrl: "", posts: [] };
const reviewsPath = path.join(root, "content/reviews.json");
const reviewsData = fs.existsSync(reviewsPath)
  ? JSON.parse(fs.readFileSync(reviewsPath, "utf8"))
  : { locations: {} };

const BASE_URL = site.seo?.siteUrl || "https://elpueblomex.com";
const h = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slugify = (s) => String(s).toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
const locBySlug = Object.fromEntries(locations.map(l => [l.slug, l]));

function reviewStars(rating) {
  if (!rating) return "";
  const full = Math.round(rating);
  return "★".repeat(full) + "☆".repeat(5 - full);
}

function formatCount(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function reviewChip(slug) {
  const r = reviewsData.locations?.[slug];
  if (!r || !r.rating) return "";
  return `<span class="review-chip" aria-label="Google rating ${r.rating} out of 5, ${r.total} reviews"><span class="review-chip__stars" aria-hidden="true">${reviewStars(r.rating)}</span><strong>${r.rating.toFixed(1)}</strong><span class="review-chip__count">${formatCount(r.total)} reviews</span></span>`;
}

function reviewsSection(slug) {
  const r = reviewsData.locations?.[slug];
  const fiveStars = (r?.reviews || []).filter(rv => rv.rating === 5);
  if (!r || !fiveStars.length) return "";
  const cards = fiveStars.slice(0, 5).map(rv => `
    <figure class="review-card">
      <div class="review-card__head">
        ${rv.profilePhoto ? `<img class="review-card__avatar" src="${h(rv.profilePhoto)}" alt="" loading="lazy" width="40" height="40" referrerpolicy="no-referrer">` : `<span class="review-card__avatar review-card__avatar--fallback" aria-hidden="true">${h((rv.author||"?")[0].toUpperCase())}</span>`}
        <div>
          <p class="review-card__author">${h(rv.author)}</p>
          <p class="review-card__meta"><span class="review-card__stars" aria-label="${rv.rating} out of 5">${reviewStars(rv.rating)}</span> <span>${h(rv.relativeTime || "")}</span></p>
        </div>
      </div>
      <blockquote class="review-card__text">${h(rv.text).replace(/\n+/g, "<br>")}</blockquote>
    </figure>`).join("");
  return `
<section class="section section--cream reviews-section" aria-labelledby="reviews-${h(slug)}">
  <div class="section__inner">
    <header class="reviews-head">
      <div>
        <p class="eyebrow">From Google</p>
        <h2 id="reviews-${h(slug)}" class="display-sm">What people are <span class="serif" style="color:var(--terracotta)">saying.</span></h2>
      </div>
      <div class="reviews-head__aggregate">
        <span class="reviews-head__rating">${r.rating ? r.rating.toFixed(1) : "—"}</span>
        <span class="reviews-head__stars" aria-hidden="true">${reviewStars(r.rating)}</span>
        <span class="reviews-head__count">${formatCount(r.total)} reviews</span>
        ${r.googleUrl ? `<a class="reviews-head__link" href="${h(r.googleUrl)}" target="_blank" rel="noopener">See all on Google →</a>` : ""}
      </div>
    </header>
    <div class="reviews-grid">${cards}</div>
  </div>
</section>`;
}

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
  const reviews = reviewsData.locations?.[loc.slug];
  const aggregateRating = reviews?.rating && reviews?.total
    ? {
        "@type": "AggregateRating",
        ratingValue: reviews.rating,
        reviewCount: reviews.total,
        bestRating: 5,
        worstRating: 1,
      }
    : undefined;
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
    aggregateRating,
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
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
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
${lcpImage === "/images/home/combo-plate-hero.jpg" ? `<link rel="preload" as="image" type="image/webp" href="/images/home/combo-plate-hero.webp" imagesrcset="/images/home/combo-plate-hero-m.webp 900w, /images/home/combo-plate-hero.webp 1600w" imagesizes="(max-width: 700px) 100vw, 50vw" fetchpriority="high">` : lcpImage ? `<link rel="preload" as="image" href="${lcpImage}" fetchpriority="high">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Fraunces:ital,opsz,wght@1,9..144,500&family=Inter:wght@400;500;600&display=swap">
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
    </nav>
  </div>
</header>`;

const footer = () => `
<footer class="site-footer">
  ${sunSvg("")}
  <div class="site-footer__top">
    <div class="site-footer__brand">
      <img class="footer-logo" src="/images/brand/logo-lockup.png" alt="${h(site.brand.name)}">
      <p class="footer-tagline">Home of the <strong>$1.39</strong> Fish Taco.</p>
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
<div id="cookie-banner" class="cookie-banner" role="region" aria-label="Cookie notice" hidden>
  <div class="cookie-banner__inner">
    <p class="cookie-banner__text">This site uses cookies to run properly and to help us understand how visitors use it. See our <a href="/cookie-policy/">Cookie Policy</a> and <a href="/privacy-policy/">Privacy Policy</a>. You can accept all cookies, decline non-essential, or adjust in your browser.</p>
    <div class="cookie-banner__actions">
      <button type="button" class="cookie-banner__btn cookie-banner__btn--ghost" data-cookie-decline><span class="cookie-banner__btn-long">Decline non-essential</span><span class="cookie-banner__btn-short">Decline</span></button>
      <button type="button" class="cookie-banner__btn cookie-banner__btn--primary" data-cookie-accept><span class="cookie-banner__btn-long">Accept all</span><span class="cookie-banner__btn-short">Accept</span></button>
    </div>
  </div>
</div>
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
      <picture>
        <source media="(max-width: 700px)" type="image/webp" srcset="/images/home/combo-plate-hero-m.webp">
        <source media="(max-width: 700px)" srcset="/images/home/combo-plate-hero-m.jpg">
        <source type="image/webp" srcset="/images/home/combo-plate-hero.webp">
        <img src="${h(hero.image)}" width="1600" height="1230" alt="Fresh Mexican food at El Pueblo — fish tacos from Cardiff, Carlsbad, Carmel Valley, and Del Mar" loading="eager" fetchpriority="high" decoding="async">
      </picture>
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
      <h2>The famous <em>$1.39</em> Fish Taco.</h2>
      <p>Crispy fried-to-order fillet, chipotle sauce, fresh pico, crisp cabbage on a warm corn tortilla. Order one. Order ten. There is no limit — and there never has been.</p>
      <div class="cta-row">
        <a class="btn btn--marigold" href="/menu/">See the full menu</a>
        <a class="btn btn--ghost" href="/locations/">Find a location</a>
      </div>
    </div>
    <div class="feature-fish__media" style="background-image:url('/images/home/fish-taco.jpg')">
      <div class="feature-fish__price">
        <small>Fish Taco</small>
        <strong>$1.39</strong>
        <em>unlimited</em>
      </div>
    </div>
  </div>
</section>

${ticker("ticker--agave")}

<section class="section section--cream-2" id="find-near-you">
  <div class="section__inner">
    <header class="section__head">
      <p class="eyebrow">Find a location near you</p>
      <h2 class="display-sm">Five locations across <span class="serif" style="color:var(--terracotta)">San Diego</span></h2>
      <p class="section__lede">Five El Pueblo locations across North County San Diego — Cardiff, Carlsbad, Carmel Valley, Del Mar, and La Jolla (opening Spring 2026). Pick the one nearest you below.</p>
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
            ${reviewChip(l.slug)}
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

${press.length ? `
<section class="press">
  <div class="press__inner">
    <header class="section__head section__head--center">
      <p class="eyebrow">In the press</p>
      <h2 class="display-sm">What <span class="serif" style="color:var(--terracotta)">they're</span> saying</h2>
    </header>
    <div class="press-grid">
      ${press.slice(0, 4).map(p => `
      <a class="press-card" href="${h(p.url)}" target="_blank" rel="noopener">
        <p class="press-card__outlet">${h(p.outlet)}</p>
        <p class="press-card__quote">&ldquo;${h(p.quote)}&rdquo;</p>
        <p class="press-card__meta">${p.author ? `${h(p.author)} · ` : ""}${h(new Date(p.date).toLocaleDateString("en-US", { month: "short", year: "numeric" }))}</p>
      </a>`).join("")}
    </div>
  </div>
</section>
` : ""}

${posts.length ? `
<section class="kitchen-news">
  <div class="kitchen-news__inner">
    <header class="section__head section__head--center">
      <p class="eyebrow">From the kitchen</p>
      <h2 class="display-sm">Latest <span class="serif" style="color:var(--terracotta)">stories</span></h2>
    </header>
    <div class="kitchen-news__grid">
      ${[...posts].sort((a,b) => (b.date||"").localeCompare(a.date||"")).slice(0, 3).map(p => `
      <a class="news-card" href="/news/${h(p.slug)}/">
        ${p.image ? `<div class="news-card__media" role="img" aria-label="${h(p.imageAlt||p.title)}" style="background-image:url('${h(p.image)}')"></div>` : ""}
        <div class="news-card__body">
          <p class="news-card__date">${h(new Date(p.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))}</p>
          <h3 class="news-card__title">${h(p.title)}</h3>
          <p class="news-card__excerpt">${h(p.excerpt || "")}</p>
        </div>
      </a>`).join("")}
    </div>
  </div>
</section>
` : ""}

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
    { q: "Where is the nearest El Pueblo Mexican restaurant near me?", a: "El Pueblo Mexican Food has five locations across North County San Diego: Cardiff-by-the-Sea (open 24 hours), Carlsbad at La Costa Town Square, Carmel Valley, Del Mar, and La Jolla opening Spring 2026. Visit our Locations page to find the one nearest you." },
    { q: "What time do you open?", a: "Cardiff is open 24 hours. Carmel Valley and Del Mar are open 6am to midnight daily. Carlsbad is 6am to 10pm (Sun-Thu) and 6am to midnight (Fri-Sat)." },
    { q: "Is there a limit on how many fish tacos I can order?", a: "No. The $1.39 Fish Taco is unlimited. Order one. Order ten. Same price." },
    { q: "Do you have a full bar?", a: "Yes — full bars at Del Mar and Carmel Valley, with beers on tap at Del Mar, premium tequila and mezcal, and house margaritas." },
    { q: "Do you cater?", a: "Yes. Same-day Party Packs (rolled tacos, enchiladas, quesadilla trays, make-your-own taco packs) and full-service catering with taco bars at all four open locations." }
  ];
  return layout({
    title: `Mexican Food Near Me in North County San Diego | ${site.brand.name} — 5 Locations`,
    description: "Looking for Mexican food near you? El Pueblo Mexican Food has five locations across North San Diego County — Cardiff, Carlsbad, Carmel Valley, Del Mar, and La Jolla (opening soon). Voted #1 on Yelp. Fish tacos, full bars, open late.",
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
            ${reviewChip(l.slug)}
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
      <a class="info-block__map-link" href="${h(loc.mapsUrl)}" target="_blank" rel="noopener" aria-label="Open ${h(loc.name)} address in Google Maps">
        ${h(loc.address.street)}<br>
        ${h(loc.address.city)}, ${h(loc.address.region)} ${h(loc.address.zip)}
        <span class="info-block__map-cta" aria-hidden="true">Open in Maps ↗</span>
      </a>
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

${loc.comingSoon ? `
<section class="section section--cream-2" id="opening-alerts">
  <div class="section__inner" style="max-width:720px;text-align:center">
    <header class="section__head section__head--center">
      <p class="eyebrow">Opening alerts</p>
      <h2 class="display-sm">Be the first to <span class="serif" style="color:var(--terracotta)">know.</span></h2>
      <p class="lede">Drop your email and we'll send a single note the moment ${h(loc.short)} opens — no spam, no marketing blasts.</p>
    </header>
    <form class="newsletter-form" action="/api/newsletter" method="post">
      <input class="stack-form__hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <input type="hidden" name="source" value="${h(loc.slug)}">
      <input type="email" name="email" required placeholder="you@example.com" aria-label="Your email">
      <button class="btn btn--primary" type="submit">Notify me</button>
    </form>
  </div>
</section>` : ""}

${reviewsSection(loc.slug)}

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
  <p class="lede">Breakfast burritos from 6am. Our famous $1.39 fish tacos all day. Full bar with beers on tap in Del Mar. Order pickup from your nearest location.</p>
  <p class="menu-stats"><strong>${totalItems}</strong> items · <strong>${menu.categories.length}</strong> categories · <strong>4</strong> kitchens open now</p>
</section>

<section class="menu-featured">
  <div class="menu-featured__inner">
    <div class="menu-featured__media"><picture><source type="image/webp" srcset="/images/home/fish-taco.webp"><img src="/images/home/fish-taco.jpg" alt="El Pueblo battered fish taco with cabbage, pico de gallo, and a wedge of lime" width="800" height="800" loading="lazy"></picture></div>
    <div class="menu-featured__copy">
      <p class="eyebrow" style="color:var(--marigold)">Home of the</p>
      <h2>$1.39 <em>Fish Taco</em></h2>
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
        ${c.note ? `<p class="menu-cat__note">${h(c.note)}</p>` : ""}
        <span class="menu-cat__count">${c.items.length} items</span>
      </header>
      <ul class="menu-items">
        ${c.items.map(it => `
        <li class="menu-item ${it.featured ? 'menu-item--featured' : ''}">
          ${it.featured ? `<span class="menu-item__badge">Signature · $1.39</span>` : ''}
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
      ${locations.some(l => l.comingSoon) ? `<span class="btn btn--coming-soon" aria-disabled="true">La Jolla — Coming Soon</span>` : ""}
    </div>
  </div>
</section>

${ticker("ticker--marigold")}
`;
  const crumbs = breadcrumbSchema([{ name: "Home", url: "/" }, { name: "Menu", url: "/menu/" }]);
  return layout({
    title: `Menu — ${site.brand.name} | Fish Tacos, Burritos, Plates`,
    description: "The full El Pueblo menu — breakfast burritos, $1.39 fish tacos, bowls, enchiladas, quesadillas, plates, and drinks. Order pickup from Cardiff, Carlsbad, Carmel Valley, or Del Mar.",
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
      <input class="stack-form__hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
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
      <input class="stack-form__hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
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

// ---------- Bars ----------
function renderBars() {
  const b = site.bars;
  const body = `
<section class="page-head">
  <p class="eyebrow">${h(b.heroEyebrow)}</p>
  <h1 class="display">${h(b.heroHeadline)}</h1>
  <p class="lede">${h(b.heroSub)}</p>
</section>

${ticker("ticker--agave")}

<section class="section section--cream">
  <div class="section__inner">
    <header class="section__head">
      <p class="eyebrow">Where to drink</p>
      <h2 class="display-sm">Two bars, <span class="serif" style="color:var(--terracotta)">one menu.</span></h2>
    </header>
    <div class="bars-grid">
      ${b.barLocations.map(loc => `
      <article class="bar-card">
        <div class="bar-card__media">
          <picture>
            ${fileExists(loc.image.replace(/\.(jpg|png)$/, '.webp')) ? `<source type="image/webp" srcset="${h(loc.image.replace(/\.(jpg|png)$/, '.webp'))}">` : ""}
            <img src="${h(loc.image)}" alt="${h(loc.imageAlt || `Bar at El Pueblo ${loc.name}`)}" loading="lazy" width="800" height="600">
          </picture>
        </div>
        <div class="bar-card__body">
          <h3>${h(loc.name)}</h3>
          <p class="bar-card__addr">${h(loc.address)}<br>${h(loc.city)}<br><a href="tel:${h(loc.phone.replace(/[^0-9+]/g,''))}">${h(loc.phone)}</a></p>
          <p class="bar-card__hours"><strong>Hours:</strong> ${h(loc.hours)}</p>
          <ul class="bar-card__highlights">
            ${loc.highlights.map(hl => `<li>${h(hl)}</li>`).join("")}
          </ul>
          <a class="btn btn--ghost btn--sm" href="/locations/${h(loc.slug)}/">View location details</a>
        </div>
      </article>`).join("")}
    </div>
  </div>
</section>

<section class="section section--cream-2">
  <div class="section__inner">
    <header class="section__head section__head--center">
      <p class="eyebrow">On the bar</p>
      <h2 class="display-sm">What's <span class="serif" style="color:var(--terracotta)">pouring.</span></h2>
    </header>
    <div class="pillars">
      ${b.pillars.map(p => `
      <article class="pillar">
        <h3>${h(p.title)}</h3>
        <p>${h(p.body)}</p>
      </article>`).join("")}
    </div>
  </div>
</section>

<section class="section section--wall" id="happy-hour">
  <div class="section__inner">
    <header class="section__head section__head--center">
      <p class="eyebrow">Happy hour</p>
      <h2 class="display-sm">Daily <span class="serif" style="color:var(--terracotta)">happy hour</span> at both bars.</h2>
    </header>
    ${b.happyHour && b.happyHour.length ? `
    <div class="happy-hour-grid">
      ${b.happyHour.map(hh => `
      <div class="happy-hour-item">
        <h3>${h(hh.name)}</h3>
        <p class="happy-hour-item__price">${h(hh.price)}</p>
        ${hh.description ? `<p class="happy-hour-item__desc">${h(hh.description)}</p>` : ""}
      </div>`).join("")}
    </div>` : `
    <div class="happy-hour-placeholder">
      <p>${h(b.happyHourPlaceholder)}</p>
      <div class="cta-row">
        <a class="btn btn--marigold" href="/locations/del-mar/">Del Mar location</a>
        <a class="btn btn--ghost" href="/locations/carmel-valley/">Carmel Valley location</a>
      </div>
    </div>
    `}
  </div>
</section>

${ticker("ticker--terracotta")}

<section class="section section--cream">
  <div class="cta-band">
    <h2>Find your <em>nearest</em> bar.</h2>
    <p>${h(b.ctaLine)} Cardiff and Carlsbad are kitchen-only — for the full bar, head to Del Mar or Carmel Valley.</p>
    <div class="cta-row">
      <a class="btn btn--primary" href="/locations/del-mar/">Del Mar bar</a>
      <a class="btn btn--ghost" href="/locations/carmel-valley/">Carmel Valley bar</a>
    </div>
  </div>
</section>
`;
  const crumbs = breadcrumbSchema([
    { name: "Home", url: "/" },
    { name: "Bars", url: "/bars/" }
  ]);
  return layout({
    title: `Bars — ${site.brand.name} | Full Bar in Del Mar & Carmel Valley`,
    description: "Two real full bars at El Pueblo Mexican Food — Del Mar and Carmel Valley. Whiskey, bourbon, cocktails, beers on tap, wine, fresh-pressed margaritas, premium tequila and mezcal. Daily happy hour, heated patios, open until midnight.",
    canonicalPath: "/bars/",
    body,
    ogImage: "/og/bars.jpg",
    bodyClass: "page-bars",
    schema: [
      webPageSchema({
        name: "Bars at El Pueblo Mexican Food",
        description: "Full bars at El Pueblo Mexican Food — Del Mar and Carmel Valley locations. Tequila, mezcal, margaritas, beers on tap, daily happy hour.",
        canonical: "/bars/"
      }),
      crumbs
    ]
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
      <input class="stack-form__hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
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
      <input class="stack-form__hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
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
  const galleryExclude = new Set([
    "/images/menu/shredded-chicken-quesadilla.jpg",
    "/images/menu/chicken-tortilla-soup.jpg",
    "/images/menu/kids-bean-and-cheese.jpg"
  ]);
  const push = (src, alt) => {
    if (galleryExclude.has(src)) return;
    if (seenUrl.has(src)) return;
    seenUrl.add(src);
    const fp = path.join(outDir, src.replace(/^\//, ""));
    if (!fs.existsSync(fp)) return;
    const hash = crypto.createHash("md5").update(fs.readFileSync(fp)).digest("hex");
    if (seenHash.has(hash)) return;
    seenHash.add(hash);
    out.push({ src, alt });
  };
  push("/images/home/fish-taco.jpg", "The $1.39 fish taco at El Pueblo Mexican Food");
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
    <h2>See the <em>$1.39</em> fish taco?</h2>
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
      <p class="lede">Browse current openings and apply directly below — every position, every location, in one place.</p>
    </header>
    <div class="careers-iframe-wrap">
      <iframe
        class="careers-iframe"
        src="https://careers.elpueblomex.com/"
        title="El Pueblo Mexican Food — current job openings"
        loading="lazy"
        referrerpolicy="strict-origin-when-cross-origin"
        allow="clipboard-write"
      ></iframe>
      <noscript>
        <p>To browse and apply to openings, please enable JavaScript or visit <a href="https://careers.elpueblomex.com/">careers.elpueblomex.com</a>.</p>
      </noscript>
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
      <input class="stack-form__hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
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
  const pressSection = press.length ? `
<section class="section" aria-labelledby="press-heading">
  <div class="section__inner">
    <header class="news-section__head">
      <p class="eyebrow">In the press</p>
      <h2 id="press-heading" class="display-sm">Covered by the <span class="serif" style="color:var(--terracotta)">press.</span></h2>
      <p class="lede">Independent journalism about El Pueblo Mexican Food.</p>
    </header>
    <div class="press-grid">
      ${press.map(a => `
      <a class="press-card" href="${h(a.url)}" target="_blank" rel="noopener">
        <div class="press-card__head">
          <span class="press-card__outlet">${h(a.outlet)}</span>
          ${a.outletNote ? `<span class="press-card__note">${h(a.outletNote)}</span>` : ""}
          <time class="press-card__date">${h(a.date)}</time>
        </div>
        <h3 class="press-card__title">${h(a.title)}</h3>
        ${a.quote ? `<blockquote class="press-card__quote">${h(a.quote)}</blockquote>` : ""}
        <span class="press-card__cta">Read the article <span aria-hidden="true">↗</span></span>
      </a>`).join("")}
    </div>
  </div>
</section>

` : "";

  const body = `
<section class="page-head">
  <p class="eyebrow">From the kitchen</p>
  <h1 class="display">News &amp; <span class="serif" style="color:var(--terracotta)">stories.</span></h1>
  <p class="lede">Updates, openings, and stories from El Pueblo Mexican Food.</p>
</section>

${ticker("ticker--agave")}
${pressSection}

<section class="section section--cream">
  <div class="section__inner">
    <header class="news-section__head">
      <p class="eyebrow">From El Pueblo</p>
      <h2 class="display-sm">Stories from the <span class="serif" style="color:var(--terracotta)">kitchen.</span></h2>
    </header>
    <div class="kitchen-news__grid">
      ${posts.map(p => `
      <a class="news-card" href="/news/${h(p.slug)}/">
        ${fileExists(p.image) ? `<div class="news-card__media" role="img" aria-label="${h(p.imageAlt || p.title)}" style="background-image:url('${h(p.image)}')"></div>` : ""}
        <div class="news-card__body">
          <p class="news-card__date">${h(new Date(p.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))}</p>
          <h3 class="news-card__title">${h(p.title)}</h3>
          <p class="news-card__excerpt">${h(p.excerpt || "")}</p>
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
    description: "Comprehensive privacy policy covering how El Pueblo Mexican Food collects, uses, shares, and protects your personal information.",
    sections: [
      { p: [
        `This Privacy Policy explains how ${site.brand.name} ("El Pueblo," "we," "us," or "our") collects, uses, shares, and protects information about you when you visit elpueblomex.com (the "Site"), interact with us at any of our locations, or communicate with us through email, phone, or our web forms.`,
        "By using the Site or submitting information to us, you acknowledge the practices described in this Policy. If you do not agree, please do not use the Site.",
        "This Policy applies to all visitors, customers, job applicants, event inquirers, catering clients, fundraiser applicants, and anyone else who interacts with El Pueblo. If you are a California resident, please also see our California Consumer Privacy Act notice for rights specific to you."
      ]},
      { h: "Information we collect", p: [
        "We collect the following categories of information, depending on how you interact with us:",
        "Information you provide directly: name, email address, phone number, organization or school (for catering and fundraisers), preferred location, event date and size, job history, resume content, message content, and any other information you choose to submit via our contact, catering, fundraiser, event, or careers forms.",
        "Order information: when you place an online order we direct you to order.online (or a similar ordering partner); payment data, cart contents, and delivery details are handled under their privacy policies, not ours. We may receive confirmation information (order number, location, timestamp) to service your order.",
        "In-restaurant interactions: when you dine in, order at a counter, or pay at one of our locations, point-of-sale systems may capture limited transaction information (order total, payment method type, timestamp). We do not store full payment card numbers.",
        "Automatically collected information: when you visit the Site, we and our service providers automatically collect technical information including IP address, approximate location derived from IP, browser type and version, operating system, device identifiers, referring URL, pages viewed, time spent, and actions taken (such as button clicks and form submissions).",
        "Cookies and similar technologies: we use first-party and third-party cookies, pixels, local storage, and related technologies as described in our Cookie Policy.",
        "Information from third parties: we may receive information about you from analytics providers (Google Analytics), form-handling providers, and social media platforms if you engage with our profiles or tagged posts.",
        "Sensitive information: we do not intentionally collect Social Security numbers, driver's license numbers, financial account credentials, genetic or biometric data, precise geolocation, or information about race, religion, or sexual orientation. If you choose to include such information in a resume or message, please redact it before submission."
      ]},
      { h: "Sources of information", p: [
        "Directly from you through web forms, email, phone calls, and in-person interactions.",
        "Automatically from your browser or device when you visit the Site.",
        "From service providers and analytics tools that help us operate the Site and understand audience behavior.",
        "From social media platforms if you publicly interact with our accounts."
      ]},
      { h: "How we use information", p: [
        "To respond to inquiries, catering requests, event bookings, fundraiser applications, and general messages.",
        "To review, process, and communicate about job applications; to schedule interviews; to verify information you supply.",
        "To coordinate with ordering and catering partners so your order is prepared and delivered.",
        "To operate, maintain, secure, and improve the Site — including debugging, preventing abuse, and analyzing which pages and features are useful.",
        "To understand aggregate audience behavior through analytics tools so we can improve our menu presentation, location pages, and customer service.",
        "To send transactional messages (responding to your inquiry, confirming receipt of an application) and, with your consent, occasional updates about openings, events, or promotions.",
        "To comply with legal obligations (tax, employment, health-code reporting) and to enforce our Terms of Service.",
        "To protect the rights, property, or safety of El Pueblo, our staff, customers, or the public — for example, by investigating suspected fraud or responding to a subpoena."
      ]},
      { h: "Legal bases for processing", p: [
        "Where required by law (for example, if you are in a jurisdiction with data-protection rules such as the EU GDPR), our lawful bases for processing are: your consent (which you can withdraw); performance of a contract with you (processing your order or application); our legitimate interests (running a safe, useful Site and communicating with customers) balanced against your rights; and compliance with legal obligations.",
        "Most of our users are based in the United States; we process information primarily in the United States."
      ]},
      { h: "How and with whom we share information", p: [
        "We do not sell your personal information for money, and we do not share your personal information for cross-context behavioral advertising.",
        "We share information only with the following categories of recipients, and only to the extent needed:",
        "Service providers and processors that help us operate the Site or business — for example: web hosting (Vercel), content delivery and security (Cloudflare), domain services, email delivery, analytics (Google), form-handling services, and ordering partners (order.online). These parties are bound by contract to use the information only for the purpose we engaged them and to protect it.",
        "Legal and regulatory recipients when we are required to disclose information by law, court order, subpoena, or other legal process, or to protect rights, safety, or property.",
        "Business transfer recipients in the event of a merger, acquisition, financing, reorganization, bankruptcy, or sale of assets — in which case we will continue to ensure the confidentiality of your personal information and will give affected users notice before personal information becomes subject to a different privacy policy.",
        "With your consent or at your direction, for any purpose you authorize."
      ]},
      { h: "Third-party services", p: [
        "Key third-party services that may process your data include: Google Analytics (site usage measurement; see Google's Privacy Policy), Vercel (hosting), Cloudflare (content delivery and DDoS protection), order.online (online ordering), and Gmail/Google Workspace (email for info@elpueblomex.com).",
        "We do not control the privacy practices of these services. Please review their policies for details about how they handle your information."
      ]},
      { h: "Cookies and tracking technologies", p: [
        "See our Cookie Policy for details on the specific cookies, local-storage items, and tracking technologies used on this Site, the categories they belong to, and how to manage them.",
        "We honor recognized opt-out signals, including the Global Privacy Control (GPC), as described in the Cookie Policy."
      ]},
      { h: "Data retention", p: [
        "We retain personal information only as long as necessary for the purpose it was collected, to comply with legal, accounting, or reporting obligations, or to resolve disputes and enforce agreements.",
        "General guidelines we follow: contact-form submissions and inquiries — up to 24 months after the last interaction; catering and event records — up to 4 years for tax and business-record purposes; job applications — up to 24 months (or longer if applicable law requires); analytics data — aggregated indefinitely, but individual-level data typically rotates out within 26 months (the default Google Analytics retention window).",
        "When retention is no longer required, we delete, anonymize, or securely dispose of the information."
      ]},
      { h: "Data security", p: [
        "We apply reasonable administrative, technical, and physical safeguards designed to protect personal information — including HTTPS on the Site, access controls on internal tools, encryption at rest where supported by our vendors, and staff training on handling customer information.",
        "No system is perfectly secure. If you believe the security of your interaction with us has been compromised, contact us immediately at " + site.brand.email + "."
      ]},
      { h: "Children's privacy", p: [
        "The Site is intended for a general audience and is not directed to children under 13. We do not knowingly collect personal information from children under 13.",
        "If you believe a child has provided us with personal information in violation of this Policy, please contact us and we will delete the information."
      ]},
      { h: "Your choices and rights", p: [
        "Regardless of where you live, you may: ask us what information we have about you; ask us to delete it; ask us to correct it; unsubscribe from any marketing messages; decline to provide information (though this may limit our ability to respond).",
        "Depending on where you live (including California, Colorado, Connecticut, Virginia, Utah, and many other states and countries), you may have additional rights such as the right to receive a portable copy of your information, to opt out of targeted advertising (we do not engage in this), or to appeal a decision we make. California residents should see the California Consumer Privacy notice for state-specific rights.",
        `To exercise these rights, email ${site.brand.email} with the subject "Privacy Request" and describe what you are asking for. We will verify your identity (typically by confirming information we already have on file) and respond within 45 days (extendable by another 45 days if reasonably necessary).`
      ]},
      { h: "Do Not Track and Global Privacy Control", p: [
        "Most browsers offer a Do Not Track (\"DNT\") setting. There is no uniform industry standard for interpreting DNT, so we do not currently respond to DNT signals.",
        "We do, however, recognize the Global Privacy Control (GPC). Visitors whose browser sends a GPC signal will be treated as having opted out of any \"sale\" or \"sharing\" of personal information (as those terms are defined under California law), to the extent applicable."
      ]},
      { h: "California Shine the Light", p: [
        `California Civil Code § 1798.83 entitles California residents to request information about disclosures of personal information to third parties for the third parties' direct marketing purposes. We do not disclose personal information to third parties for their direct marketing. To request confirmation, email ${site.brand.email} with "Shine the Light" in the subject line.`
      ]},
      { h: "International data transfers", p: [
        "El Pueblo is based in the United States, and our service providers are primarily located in the United States. If you access the Site from outside the United States, your information will be transferred to, stored, and processed in the United States, where data-protection laws may differ from those in your home jurisdiction. By using the Site you consent to this transfer."
      ]},
      { h: "Links to other sites", p: [
        "The Site may contain links to websites operated by third parties (such as our ordering partners, social networks, or news outlets). We are not responsible for the privacy practices of those sites. We encourage you to review the privacy policies of every site you visit."
      ]},
      { h: "Changes to this policy", p: [
        "We may update this Policy from time to time. When we do, we will revise the \"Last updated\" date at the top of this page. If the changes are material, we will provide additional notice (such as a banner on the Site or an email to subscribers).",
        "Continued use of the Site after changes take effect constitutes acceptance of the revised Policy."
      ]},
      { h: "How to contact us", p: [
        `El Pueblo Mexican Food — Privacy`,
        `Email: ${site.brand.email}`,
        `Postal: 820 Birmingham Drive, Cardiff, CA 92007 (Attn: Privacy)`,
        "We aim to respond to privacy inquiries within 10 business days."
      ]}
    ]
  },
  {
    slug: "cookie-policy",
    title: "Cookie Policy",
    description: "Comprehensive explanation of the cookies, local storage, and tracking technologies used on elpueblomex.com, and your choices for managing them.",
    sections: [
      { p: [
        `This Cookie Policy explains what cookies and similar technologies are, how ${site.brand.name} uses them on elpueblomex.com, and the choices available to you.`,
        "This Policy supplements our Privacy Policy. Please read both together."
      ]},
      { h: "What are cookies and similar technologies?", p: [
        "Cookies are small text files placed on your device (computer, phone, tablet) by a website you visit. They allow the site to recognize your device on return visits and to remember preferences or actions.",
        "Similar technologies include: local storage (browser-based storage for small pieces of data, such as your cookie-banner preference), session storage (cleared when you close the tab), pixels or tags (tiny image files that record page views), and server logs (records of requests to our servers).",
        "Cookies can be \"first-party\" (set by this Site) or \"third-party\" (set by another domain we load content from, such as Google Analytics)."
      ]},
      { h: "Categories of cookies we use", ul: [
        "Strictly necessary — required for the Site to work (for example, remembering that you've dismissed the cookie banner, keeping form state between pages, protecting against abuse). These cannot be switched off from within the Site.",
        "Analytics / performance — help us understand which pages people visit, where they come from, and how the Site performs. Data is aggregated and used to improve the Site.",
        "Functional — remember preferences like selected location or previously viewed menu section to improve your experience.",
        "Targeting / advertising — we do not currently use advertising cookies on this Site and do not share personal information with advertising networks for cross-context behavioral advertising."
      ]},
      { h: "Specific cookies and storage items", p: [
        "Below is a best-effort list of the cookies, local-storage items, and third-party trackers that may be set when you visit the Site. Third-party cookies may change without notice; consult the provider for an authoritative list.",
        "ep_cookie_consent (local storage; strictly necessary) — remembers whether you accepted or declined the cookie banner so it doesn't reappear. Stored on your device; no personal information is sent to us.",
        "_ga, _ga_* (first-party cookies from Google Analytics; analytics) — distinguish unique visitors and sessions. See Google's documentation. Typical retention: 2 years (rotated).",
        "__cf_bm, cf_clearance (set by Cloudflare; strictly necessary) — bot-mitigation and security cookies used to distinguish humans from automated traffic. Typical retention: 30 minutes to 30 days.",
        "vercel / _vercel_* (set by Vercel hosting infrastructure; strictly necessary) — routing and caching cookies used to serve the correct version of the Site."
      ]},
      { h: "Third parties that may set cookies", p: [
        "Google Analytics (analytics) — see Google's Privacy & Terms and the Google Analytics opt-out browser add-on at tools.google.com/dlpage/gaoptout.",
        "Cloudflare (security / performance) — see cloudflare.com/privacypolicy.",
        "Vercel (hosting) — see vercel.com/legal/privacy-policy.",
        "If you place an order, you may be redirected to order.online, which sets its own cookies under its own privacy policy."
      ]},
      { h: "Your cookie choices", p: [
        "When you first visit the Site, a cookie banner lets you Accept all cookies or Decline non-essential cookies. Declining instructs us not to load analytics cookies for your session (strictly necessary cookies are still required for the Site to function).",
        "You can change or withdraw your choice at any time by clearing your browser's site data for elpueblomex.com, which removes the ep_cookie_consent value and causes the banner to reappear on your next visit.",
        "Most browsers allow you to refuse or delete cookies. Check your browser's documentation: Chrome (support.google.com/chrome), Firefox (support.mozilla.org), Safari (support.apple.com), Edge (support.microsoft.com). Blocking strictly necessary cookies may break parts of the Site.",
        "You can opt out of Google Analytics specifically with the browser add-on linked above."
      ]},
      { h: "Do Not Track and Global Privacy Control", p: [
        "The Site does not currently respond to Do Not Track (DNT) signals because there is no agreed industry standard for interpreting them.",
        "We do recognize the Global Privacy Control (GPC) signal. If your browser transmits a GPC signal, we will treat it as a request to opt out of any \"sale\" or \"sharing\" of personal information under California law — even though we do not engage in sales or cross-context behavioral advertising."
      ]},
      { h: "Minors", p: [
        "We do not knowingly set non-essential cookies on devices we believe are used primarily by children under 13."
      ]},
      { h: "Changes to this Cookie Policy", p: [
        "We may update this Policy from time to time. When we do, we will revise the \"Last updated\" date at the top of this page. Material changes will be announced in the cookie banner or elsewhere on the Site."
      ]},
      { h: "Contact", p: [
        `Questions about cookies? Email ${site.brand.email} with "Cookie Policy" in the subject line.`
      ]}
    ]
  },
  {
    slug: "terms",
    title: "Terms of Service",
    description: "Terms and conditions governing your use of the El Pueblo Mexican Food website, services, and properties.",
    sections: [
      { p: [
        `These Terms of Service ("Terms") form a binding agreement between you and ${site.brand.name} ("El Pueblo," "we," "us," or "our") governing your access to and use of elpueblomex.com, our restaurants, and any related services (collectively, the "Services").`,
        "Please read these Terms carefully. By accessing or using the Services, you accept these Terms. If you do not agree, do not use the Services."
      ]},
      { h: "Eligibility", p: [
        "You must be at least 13 years old to use the Site. If you are between 13 and 17, you may use the Site only with the involvement of a parent or guardian. You must be 18 or older to submit a job application, sign a catering contract, or enter into any payment transaction.",
        "You are responsible for complying with all laws that apply to you in your location."
      ]},
      { h: "Account and use of the Site", p: [
        "We do not currently require an account to use the Site. If we introduce accounts in the future, you will be responsible for maintaining the confidentiality of your credentials and for all activity under your account.",
        "You agree to use the Site only for lawful purposes and in accordance with these Terms. You will not: (a) use the Site in a way that violates any applicable law; (b) use the Site to harass, abuse, defame, or harm another person; (c) attempt to gain unauthorized access to any portion of the Site or related systems; (d) interfere with the operation of the Site (denial-of-service, introducing viruses, scraping at a rate that burdens our infrastructure, etc.); (e) reverse-engineer, decompile, or attempt to extract source code; (f) use automated systems (bots, scrapers) except for public search-engine crawlers; (g) impersonate any person or entity; (h) use the Site to send spam or advertising; (i) commit any other act we reasonably consider harmful.",
        "We may suspend or restrict access to the Site (in whole or for specific users) at any time if we reasonably believe these Terms are being violated or the Site's security or integrity is at risk."
      ]},
      { h: "Menu, pricing, and availability", p: [
        "Menu items, ingredients, prices, and hours are subject to change without notice. We make reasonable efforts to keep Site information accurate, but the final authoritative source is the menu posted at each restaurant on the day of your visit.",
        "Pricing shown on the Site may differ from in-store pricing and from pricing on third-party ordering platforms. If a price listed is obviously an error (for example, a typographical mistake), we reserve the right to cancel or refuse the order and correct the price.",
        "Special offers and promotions may be limited to specific locations, days, or supplies on hand and may be ended at any time."
      ]},
      { h: "Food allergens and dietary information", p: [
        "Our kitchens prepare and serve foods that contain common allergens including wheat, soy, dairy, eggs, shellfish, fish, peanuts, and tree nuts. Cross-contact between ingredients is possible.",
        "While we do our best to accommodate dietary needs, we cannot guarantee that any menu item is free of a particular allergen or ingredient. If you have a food allergy or dietary restriction, please speak with a manager before ordering."
      ]},
      { h: "Orders and payments", p: [
        "Orders placed through the Site are typically routed to third-party ordering partners (such as order.online). Those partners process payment and handle fulfillment under their own terms and privacy policies. We are not responsible for issues with third-party platforms; however, we will make good-faith efforts to help resolve problems when you contact us.",
        "Tips, taxes, and delivery fees (where applicable) are shown before checkout on the ordering platform. All transactions are in U.S. dollars.",
        "We are not responsible for damages, delays, or losses caused by third-party payment processors or delivery providers."
      ]},
      { h: "Gift cards", p: [
        "Any gift cards we issue are redeemable only at El Pueblo locations or through our designated ordering partners, subject to the terms printed on the card or accompanying materials. Gift cards are not refundable, not redeemable for cash (except where required by law), and are not replaceable if lost or stolen."
      ]},
      { h: "Intellectual property", p: [
        `All text, graphics, photographs, videos, logos, marks, menu descriptions, page layouts, and other content on the Site are owned by ${site.brand.name}, its licensors, or its contributors, and are protected by U.S. and international copyright, trademark, and other intellectual-property laws.`,
        `The names "El Pueblo Mexican Food," "El Pueblo," the $1.39 Fish Taco offering, and related logos are trademarks of ${site.brand.name}. You may not use them without our prior written permission.`,
        "Subject to these Terms, we grant you a limited, non-exclusive, non-transferable, revocable license to access the Site for your personal, non-commercial use. You may not reproduce, modify, distribute, publicly display, republish, sell, or create derivative works from any portion of the Site without prior written permission."
      ]},
      { h: "User submissions", p: [
        "If you submit content to us — for example, via a catering form, fundraiser application, job application, review, or social post tagging El Pueblo — you represent that you have the right to share the content and that it is accurate, not misleading, and does not infringe anyone else's rights.",
        "You grant us a non-exclusive, royalty-free, worldwide, perpetual license to use, copy, modify, and display the content for purposes of responding to your submission, operating our business, and (for permitted marketing content such as tagged social posts) promoting El Pueblo with credit where appropriate.",
        "Do not send us confidential or proprietary information we have not requested."
      ]},
      { h: "Third-party links and services", p: [
        "The Site may link to, or redirect you to, third-party websites and services (for example, order.online, social networks, news sites, map providers). We do not endorse or control third-party sites and are not responsible for their content, terms, or privacy practices. Your interactions with third parties are subject to their terms."
      ]},
      { h: "Disclaimers", p: [
        "THE SITE AND ALL CONTENT ARE PROVIDED \"AS IS\" AND \"AS AVAILABLE,\" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, OR NON-INFRINGEMENT.",
        "WE DO NOT WARRANT THAT THE SITE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR FREE OF VIRUSES OR OTHER HARMFUL COMPONENTS.",
        "WE MAKE NO WARRANTY REGARDING THE ACCURACY, COMPLETENESS, OR TIMELINESS OF ANY INFORMATION ON THE SITE, INCLUDING HOURS, MENU CONTENT, PRICES, OR AVAILABILITY."
      ]},
      { h: "Limitation of liability", p: [
        "TO THE MAXIMUM EXTENT PERMITTED BY LAW, EL PUEBLO, ITS AFFILIATES, AND ITS AGENTS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUES, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES, RESULTING FROM (A) YOUR USE OF OR INABILITY TO USE THE SITE; (B) ANY CONTENT OBTAINED FROM THE SITE; OR (C) UNAUTHORIZED ACCESS TO OR ALTERATION OF YOUR SUBMISSIONS.",
        "OUR TOTAL LIABILITY TO YOU FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THE SITE OR THESE TERMS WILL NOT EXCEED ONE HUNDRED U.S. DOLLARS ($100).",
        "Some jurisdictions do not allow the exclusion of certain warranties or the limitation of liability. The above limits apply only to the extent permitted by law."
      ]},
      { h: "Indemnification", p: [
        "You agree to indemnify, defend, and hold harmless El Pueblo and its officers, employees, agents, and affiliates from and against any claims, liabilities, damages, losses, and expenses (including reasonable attorneys' fees) arising from (a) your use of the Site; (b) your violation of these Terms; (c) your violation of any law or the rights of a third party; or (d) any content you submit."
      ]},
      { h: "Dispute resolution", p: [
        `Informal resolution: Before filing a claim, you agree to first try to resolve the dispute informally by contacting us at ${site.brand.email} with a description of the issue. We will do the same.`,
        "Governing law: These Terms, and any dispute arising out of or related to the Site or these Terms, are governed by the laws of the State of California, without regard to its conflict-of-laws principles.",
        "Venue: Except for claims that may be filed in small-claims court, any action arising under these Terms will be brought exclusively in the state or federal courts located in San Diego County, California, and you consent to the personal jurisdiction of those courts.",
        "Class-action waiver: To the maximum extent permitted by law, any dispute will be resolved on an individual basis. You waive any right to bring or participate in a class, collective, or representative action against El Pueblo."
      ]},
      { h: "Termination", p: [
        "We may suspend or terminate your access to the Site at any time, with or without notice, for any reason — including suspected violation of these Terms. Upon termination, the provisions that by their nature should survive will survive (including intellectual property, disclaimers, limitation of liability, indemnification, and dispute resolution)."
      ]},
      { h: "Modifications to these Terms", p: [
        "We may update these Terms at any time. When we do, we will revise the \"Last updated\" date above. Material changes will be flagged on the Site. Continued use of the Site after changes take effect constitutes acceptance of the new Terms."
      ]},
      { h: "Miscellaneous", p: [
        "Entire agreement: These Terms, together with the Privacy Policy, Cookie Policy, and any posted notices, constitute the entire agreement between you and El Pueblo regarding the Site.",
        "Severability: If any provision of these Terms is found unenforceable, the remaining provisions remain in full force.",
        "No waiver: Our failure to enforce any provision is not a waiver of our right to enforce it later.",
        "Assignment: You may not assign these Terms without our prior written consent. We may assign these Terms freely.",
        "Notices: We may provide notice to you by email (to the address you have given us) or by posting on the Site."
      ]},
      { h: "Contact", p: [
        `Questions about these Terms? Email ${site.brand.email} with "Terms of Service" in the subject line.`,
        "Postal: 820 Birmingham Drive, Cardiff, CA 92007 (Attn: Legal)"
      ]}
    ]
  },
  {
    slug: "accessibility-statement",
    title: "Accessibility Statement",
    description: "El Pueblo Mexican Food's commitment to digital accessibility: standards, measures taken, known limitations, and how to submit feedback.",
    sections: [
      { p: [
        `${site.brand.name} is committed to making our restaurants, website, and digital services accessible to people of all abilities, including individuals with disabilities. We believe technology should work for everyone, and we continually work to improve the accessibility of elpueblomex.com for our customers, applicants, and partners.`
      ]},
      { h: "Standards we aim to meet", p: [
        "elpueblomex.com is designed to conform to the World Wide Web Consortium (W3C) Web Content Accessibility Guidelines (WCAG) 2.1, Level AA — the accessibility standard most commonly referenced in U.S. regulations and court decisions, including the Americans with Disabilities Act (ADA).",
        "We design and build with the broader WCAG principles — Perceivable, Operable, Understandable, and Robust — as guiding goals."
      ]},
      { h: "Measures we take", p: [
        "Semantic HTML: we use headings, lists, landmarks, and form labels consistently so assistive technology can interpret page structure.",
        "Keyboard operability: all interactive elements are reachable and operable from a keyboard. Focus styles are visible.",
        "Alternative text: informational images have descriptive alt text; decorative images are hidden from assistive technology.",
        "Color and contrast: primary text and UI elements meet or exceed WCAG 2.1 AA contrast ratios. Color is never the sole means of conveying information.",
        "Responsive and scalable layout: the site is usable at text-zoom up to 200% and across mobile, tablet, and desktop sizes.",
        "Motion: animated elements (ticker, reveal-on-scroll) are decorative and can be overridden by users who set prefers-reduced-motion in their operating system.",
        "Forms: inputs have visible labels, clear error messages, and logical tab order.",
        "Language and structure: the document language is declared; links are descriptive rather than \"click here\"; page titles are unique."
      ]},
      { h: "Compatibility", p: [
        "The Site is designed to be compatible with recent versions of popular assistive technologies including VoiceOver (macOS, iOS), TalkBack (Android), NVDA and JAWS (Windows), Dragon NaturallySpeaking, and the built-in screen-magnification tools on major operating systems.",
        "The Site works best with the latest versions of Google Chrome, Apple Safari, Mozilla Firefox, and Microsoft Edge. Some older browsers may not render all features correctly."
      ]},
      { h: "Known limitations", p: [
        "Accessibility is a continuous process and there may be portions of the Site that do not yet fully meet our target standard. Areas we are actively improving include:",
        "Third-party embedded content (such as the ordering partner pages at order.online, map embeds, and certain social-media widgets) is outside our direct control; we work with vendors where possible to encourage accessibility but cannot guarantee their conformance.",
        "Older news and blog posts may contain images with incomplete alternative text or documents that predate our current standard.",
        "Video content and user-submitted photography (for example, tagged social posts displayed in galleries) may lack captions or descriptive text.",
        "If you encounter any barrier, please let us know — see Feedback, below."
      ]},
      { h: "Ongoing assessment", p: [
        "We routinely review the Site using a combination of automated accessibility checkers (such as axe-core and Lighthouse), manual review by our team, and testing with assistive technology.",
        "We aim to include accessibility checks in every significant update to the Site."
      ]},
      { h: "Accessibility at our restaurants", p: [
        "Our physical locations are designed to welcome guests of all abilities. Every dining location offers counter-service ordering with staff available to assist, ADA-compliant parking where available, and accessible routes from the parking area to the dining area. Our Cardiff, Del Mar, and Carmel Valley locations have accessible restrooms.",
        "If you plan to visit and have a specific accessibility concern, please call the location in advance — our teams are happy to prepare."
      ]},
      { h: "Feedback and assistance", p: [
        `We welcome feedback. If you find an accessibility barrier on elpueblomex.com, or if you need assistance accessing information on the Site in an alternate format, please contact us at ${site.brand.email} with the subject "Accessibility."`,
        "Please include: the URL of the page where you encountered the barrier, a description of the issue, and the assistive technology and browser you are using. We aim to acknowledge your message within 2 business days and resolve most issues within 10 business days.",
        "If you need immediate help, you may call any of our restaurants directly; phone numbers and hours are listed on the Locations page."
      ]},
      { h: "Formal complaints", p: [
        "If your feedback is not addressed to your satisfaction, you may file a complaint under the Americans with Disabilities Act with the U.S. Department of Justice Civil Rights Division (www.ada.gov) or, for California residents, with the California Department of Fair Employment and Housing."
      ]},
      { h: "Changes to this Statement", p: [
        "We may update this Accessibility Statement as our practices evolve. The \"Last updated\" date above reflects the most recent revision."
      ]}
    ]
  },
  {
    slug: "californiaconsumerprivacy",
    title: "California Consumer Privacy Notice",
    description: "Detailed notice of California residents' rights under the CCPA, as amended by the CPRA — including how to exercise rights, verification, authorized agents, and appeals.",
    sections: [
      { p: [
        `This notice applies to California residents and supplements our general Privacy Policy. It is provided pursuant to the California Consumer Privacy Act of 2018 ("CCPA"), as amended by the California Privacy Rights Act of 2020 ("CPRA"). Terms used in this notice have the meanings given to them in those laws.`
      ]},
      { h: "Personal information we collect", p: [
        "In the preceding 12 months, we have collected the following categories of personal information from California consumers. For each category, the examples below are not exhaustive.",
        "Identifiers: name, email, phone number, postal address (when supplied), IP address, online identifiers from cookies and similar technologies.",
        "Customer records (Cal. Civ. Code § 1798.80(e)): contact information submitted through our forms, such as catering and event requests.",
        "Protected classification characteristics: limited employment-related information voluntarily supplied on job applications (for EEO compliance), where you choose to provide it.",
        "Commercial information: order history processed through our ordering partners.",
        "Internet or electronic network activity: browsing history on the Site, interaction with emails, and referring URLs.",
        "Geolocation data: approximate location derived from IP address only (not precise GPS).",
        "Professional or employment-related information: resumes, cover letters, and prior work history submitted through the careers forms.",
        "Inferences drawn from the above to create a basic profile reflecting a consumer's preferences (for example, which location they tend to visit).",
        "Sensitive personal information: we do not intentionally collect categories of sensitive personal information as defined by CPRA (such as Social Security numbers, precise geolocation, or racial or ethnic origin). If you include any such information voluntarily (for example, in a resume), we process it only for the purpose you supplied it."
      ]},
      { h: "Sources of personal information", ul: [
        "Directly from you (forms, email, phone calls, in-restaurant interactions).",
        "Automatically from your device or browser when you visit the Site.",
        "From service providers — for example, analytics platforms, form handlers, and ordering partners.",
        "From publicly available sources or social media platforms where you have interacted with us."
      ]},
      { h: "Business and commercial purposes for collection", ul: [
        "Performing the services you request (answering inquiries, processing catering and event bookings, fulfilling orders via our partners, reviewing job applications).",
        "Operating, maintaining, and securing the Site.",
        "Debugging and error resolution.",
        "Analytics and Site improvement.",
        "Marketing our own products and services to people who have expressed interest.",
        "Compliance with legal obligations and protection of rights, property, and safety."
      ]},
      { h: "Categories disclosed to third parties", p: [
        "In the preceding 12 months, we have disclosed the following categories to the following types of recipients for business purposes:",
        "Identifiers and Internet activity — disclosed to our hosting, security, and analytics service providers (e.g., Vercel, Cloudflare, Google Analytics) for the purpose of operating and measuring the Site.",
        "Commercial information — disclosed to our ordering partner (order.online) to fulfill orders you choose to place.",
        "Professional or employment-related information — disclosed to our email provider (Google Workspace) so that we can receive and review job applications.",
        "Identifiers and customer records — disclosed in response to legal process when we are required to do so."
      ]},
      { h: "Sale or sharing of personal information", p: [
        "We do not sell personal information for monetary or other valuable consideration, and we do not share personal information for cross-context behavioral advertising, as those terms are defined under the CCPA/CPRA.",
        "We do not have actual knowledge of selling or sharing personal information of consumers under 16."
      ]},
      { h: "Retention", p: [
        "We retain each category of personal information only as long as necessary for the purpose it was collected and any lawful recordkeeping requirement. See the Data Retention section of our Privacy Policy for representative time frames."
      ]},
      { h: "Your California privacy rights", p: [
        "Subject to certain exceptions, California residents have the following rights:",
        "Right to know — request that we disclose (1) the categories of personal information we have collected about you; (2) the categories of sources; (3) the business or commercial purposes; (4) the categories of third parties to whom we disclosed it; and (5) the specific pieces of personal information we have collected about you.",
        "Right to delete — request that we delete personal information we have collected from you, subject to exceptions (for example, we may retain information needed to complete a transaction, detect security incidents, comply with a legal obligation, or exercise a legal right).",
        "Right to correct — request that we correct inaccurate personal information we maintain about you.",
        "Right to opt out of sale or sharing — we do not sell or share personal information for cross-context behavioral advertising, so there is nothing to opt out of; we honor Global Privacy Control signals as a precaution.",
        "Right to limit use of sensitive personal information — because we do not use sensitive personal information for purposes beyond those permitted by default, no additional limitation is necessary.",
        "Right to data portability — receive the personal information you have provided to us in a readily usable format.",
        "Right to non-discrimination — we will not deny goods or services, charge different prices, or provide a different level of service because you exercised your rights. We are permitted to offer financial incentives tied to personal information, but we do not currently do so."
      ]},
      { h: "How to submit a request", p: [
        `Email: ${site.brand.email} with the subject "California Privacy Request" and describe the right you are exercising.`,
        "By mail: El Pueblo Mexican Food — Privacy, 820 Birmingham Drive, Cardiff, CA 92007.",
        "You may also contact any El Pueblo location by phone and ask to be directed to the Privacy contact."
      ]},
      { h: "Verification", p: [
        "To protect your information, we must verify your identity before responding to most requests. Verification generally requires that you provide information we can match against what we already have — for example, the email address you used to submit a form, the approximate date of your interaction, or the contents of a specific message.",
        "For deletion and correction requests, we may require a signed declaration under penalty of perjury.",
        "We do not use your verification information for any purpose other than verifying your request."
      ]},
      { h: "Authorized agents", p: [
        "You may designate an authorized agent to submit a request on your behalf. The agent must provide written proof of their authority (for example, a signed permission or a valid power of attorney). We may still contact you directly to verify your identity or to confirm the request.",
        "Businesses that provide consumer-privacy-request services must be registered with the California Secretary of State where required by law."
      ]},
      { h: "Response timing", p: [
        "We confirm receipt of your request within 10 business days and will respond substantively within 45 calendar days of receipt. If we need more time (up to an additional 45 days), we will tell you the reason and the extension period in writing."
      ]},
      { h: "Appeals", p: [
        `If you are dissatisfied with our response, you may appeal by replying to our decision email within 30 days, or by writing to ${site.brand.email} with "Privacy Appeal" in the subject line. We will respond to appeals within 45 days and, if we deny the appeal, will inform you of your right to contact the California Privacy Protection Agency or the California Attorney General's office.`
      ]},
      { h: "Shine the Light", p: [
        `California Civil Code § 1798.83 allows California residents to request a notice disclosing categories of personal information we shared with third parties for their direct marketing in the preceding year. We do not share personal information for third-party direct marketing. To confirm, email ${site.brand.email} with "Shine the Light" in the subject line.`
      ]},
      { h: "Minors", p: [
        "We do not knowingly collect personal information from children under 13 and do not sell or share the personal information of consumers we know to be under 16. If you are under 18 and have posted content you want removed, contact us and we will remove it."
      ]},
      { h: "Global Privacy Control", p: [
        "We recognize the Global Privacy Control (GPC) browser signal. Although we do not sell or share personal information for cross-context behavioral advertising, a GPC signal is treated as a valid opt-out request to the fullest extent applicable."
      ]},
      { h: "Changes to this notice", p: [
        "We will update this California Consumer Privacy Notice as our practices change or the law evolves. Material updates will be flagged on the Site. The \"Last updated\" date above reflects the current version."
      ]},
      { h: "Contact", p: [
        `Email: ${site.brand.email} (subject: "California Privacy")`,
        "Postal: 820 Birmingham Drive, Cardiff, CA 92007 (Attn: Privacy)"
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
    { loc: "/bars/", priority: 0.8, changefreq: "monthly" },
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
Disallow: /admin-login/
Disallow: /api/
Disallow: /404/

Sitemap: ${BASE_URL}/sitemap.xml
`;
}

// ---------- Write ----------
function wrapImagesWithWebp(html) {
  // Split HTML into existing <picture>...</picture> blocks (left untouched)
  // and everything else (where standalone <img> tags get wrapped).
  const parts = html.split(/(<picture[\s\S]*?<\/picture>)/g);
  return parts
    .map((chunk) => {
      if (chunk.startsWith("<picture")) return chunk;
      return chunk.replace(
        /<img\b([^>]*?)\ssrc="(\/images\/[^"]+?\.(?:jpg|png))"([^>]*)>/g,
        (match, pre, src, post) => {
          const webpSrc = src.replace(/\.(?:jpg|png)$/, ".webp");
          const webpAbs = path.join(outDir, webpSrc);
          if (!fs.existsSync(webpAbs)) return match;
          if (/\bsrcset=/.test(match)) return match;
          return `<picture><source type="image/webp" srcset="${webpSrc}"><img${pre} src="${src}"${post}></picture>`;
        }
      );
    })
    .join("");
}

function write(relPath, contents) {
  const full = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const out = relPath.endsWith(".html") ? wrapImagesWithWebp(contents) : contents;
  fs.writeFileSync(full, out);
}

function collapseNestedImageSets(css) {
  // Walk image-set(...) expressions; when the argument list contains another image-set(...),
  // flatten to the first webp url + the innermost non-image-set url (the real fallback).
  let out = "";
  let i = 0;
  while (i < css.length) {
    const idx = css.indexOf("image-set(", i);
    if (idx === -1) { out += css.slice(i); break; }
    out += css.slice(i, idx);
    // Find matching close paren for this image-set.
    let depth = 0, j = idx;
    for (; j < css.length; j++) {
      const ch = css[j];
      if (ch === "(") depth++;
      else if (ch === ")") { depth--; if (depth === 0) { j++; break; } }
    }
    const block = css.slice(idx, j);
    if ((block.match(/image-set\s*\(/g) || []).length > 1) {
      // Nested. Extract the first url(...) (webp) and the last url(...) (fallback).
      const urls = [...block.matchAll(/url\((['"]?)([^'")]+)\1\)\s*type\((['"]?)([^'")]+)\3\)/g)];
      if (urls.length >= 2) {
        const first = urls[0], last = urls[urls.length - 1];
        out += `image-set(url('${first[2]}') type('${first[4]}'),url('${last[2]}') type('${last[4]}'))`;
      } else {
        out += block;
      }
    } else {
      out += block;
    }
    i = j;
  }
  return out;
}

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>+~])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

function build() {
  fs.mkdirSync(outDir, { recursive: true });

  // Minify CSS in place (idempotent) + swap large PNG backgrounds to WebP with PNG fallback
  const cssPath = path.join(outDir, "style.css");
  if (fs.existsSync(cssPath)) {
    let css = fs.readFileSync(cssPath, "utf8");
    css = css.replace(/url\(['"]?(\/images\/[^'")]+?\.(?:jpg|png))['"]?\)/g, (m, src, offset, full) => {
      const webpSrc = src.replace(/\.(?:jpg|png)$/, ".webp");
      const webpAbs = path.join(outDir, webpSrc);
      if (!fs.existsSync(webpAbs)) return m;
      // Skip if already wrapped inside image-set(...) — idempotent re-builds
      const before = full.slice(Math.max(0, offset - 120), offset);
      const opens = (before.match(/image-set\s*\(/g) || []).length;
      const closes = (before.match(/\)/g) || []).length;
      if (opens > closes) return m;
      return `image-set(url('${webpSrc}') type('image/webp'), url('${src}') type('image/${src.endsWith('.png') ? 'png' : 'jpeg'}'))`;
    });
    // Safety net: collapse any nested image-set(...) into its canonical two-entry form.
    // The wrap step above is idempotent, but if an earlier build left nested garbage behind
    // (or the regex ever misses an edge case), this unwinds it so re-runs converge.
    css = collapseNestedImageSets(css);
    const min = minifyCss(css);
    if (min.length < css.length) fs.writeFileSync(cssPath, min);
  }

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
  write("bars/index.html", renderBars());
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
