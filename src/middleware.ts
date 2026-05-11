import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware((context, next) => {
  const url = new URL(context.request.url);
  
  // Redirect root / and any /template-* paths to /video-affiliate-terlaris
  if (url.pathname === "/" || url.pathname.startsWith("/template-")) {
    return context.redirect("/video-affiliate-terlaris", 307);
  }

  return next();
});
