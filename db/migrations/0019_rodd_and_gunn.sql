-- Rodd & Gunn, asked for by Malin on 2026-11-05, read one product at a time
-- from a link he pastes, never walked by the nightly finder. Its site is
-- Salesforce Commerce Cloud, not Shopify, so it has no products.json, and its
-- catalogue is a page per colour, about 2,500 of them: at one request a
-- second a nightly walk would take most of an hour, so he chose links only.
-- A product page has the price, the photos and stock per size, so a pasted
-- link is read like a Shopify product and kept current each night if saved.
--
-- A store's platform says how a product is read, so it gets its own.

alter table retailers drop constraint retailers_platform_check;

alter table retailers add constraint retailers_platform_check
  check (platform in ('shopify', 'uniqlo', 'manual', 'rodd-and-gunn'));
