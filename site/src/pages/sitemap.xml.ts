import type { APIRoute } from 'astro';

// Every .astro page but the 404, at the trailing-slash URL the host serves it from.
const pages = Object.keys(import.meta.glob(['./**/*.astro', '!./404.astro'])).map((file) =>
  file.slice(1).replace(/(index)?\.astro$/, '').replace(/([^/])$/, '$1/'),
);

export const GET: APIRoute = ({ site }) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((path) => `  <url><loc>${new URL(path, site)}</loc></url>`).join('\n')}
</urlset>
`,
    { headers: { 'Content-Type': 'application/xml' } },
  );
