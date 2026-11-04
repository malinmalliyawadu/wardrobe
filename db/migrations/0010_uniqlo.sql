-- Uniqlo, read one product at a time from a link Malin pastes, never walked
-- by the nightly finder: it has no NZ online store and does not ship here,
-- and its site is not Shopify. Asked for by Malin on 2026-11-05, who owns a
-- lot of Uniqlo and wants to add those pieces by link.
--
-- A store's platform says how a product is read. 'custom' was a placeholder
-- no store ever used; 'uniqlo' replaces it.

alter table retailers drop constraint retailers_platform_check;

alter table retailers add constraint retailers_platform_check check (platform in ('shopify', 'uniqlo'));
