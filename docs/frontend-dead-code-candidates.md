# Frontend Dead-Code Candidate Review

Last reviewed during the frontend cleanup pass on 2026-05-04.

`bun scripts/audit-frontend-dead-code.ts` is a conservative audit. It reports files and exports with no production textual importer; it does not prove runtime dead code. The candidates below are intentionally retained until a focused deletion PR can verify route reachability, Storybook coverage, and downstream import expectations.

## File-Level Candidates

Retained shared UI inventory:

- `src/ui/accordion.tsx`
- `src/ui/alert.tsx`
- `src/ui/aspect-ratio.tsx`
- `src/ui/breadcrumb.tsx`
- `src/ui/calendar.tsx`
- `src/ui/card.tsx`
- `src/ui/carousel.tsx`
- `src/ui/chart.tsx`
- `src/ui/collapsible.tsx`
- `src/ui/direction.tsx`
- `src/ui/empty.tsx`
- `src/ui/form.tsx`
- `src/ui/hover-card.tsx`
- `src/ui/input-otp.tsx`
- `src/ui/item.tsx`
- `src/ui/kbd.tsx`
- `src/ui/menubar.tsx`
- `src/ui/native-select.tsx`
- `src/ui/navigation-menu.tsx`
- `src/ui/pagination.tsx`
- `src/ui/progress.tsx`
- `src/ui/radio-group.tsx`
- `src/ui/resizable.tsx`
- `src/ui/scroll-area.tsx`
- `src/ui/sidebar.tsx`
- `src/ui/slider.tsx`
- `src/ui/spinner.tsx`
- `src/ui/table.tsx`

Retained app/feature surfaces pending product reachability review:

- `src/features/pod/components/pod-item.tsx`
- `src/layout/header.tsx`

## Export-Level Candidates

Export candidates with `Local usage: yes` are retained as local implementation details that are also exported for tests, stories, or feature barrels. Deleting the export should be handled as a narrow API cleanup, not as automatic dead-code removal.

Export candidates with `Local usage: no` are retained only as reviewed cleanup backlog. Before deletion, verify that the export is not part of a planned route, dynamic registry, story, package-like feature barrel, or design-system inventory. Current recurring examples include dormant feature panel components, UI primitive helpers, type-only API surfaces, and selector/helper exports used by tests or future route wiring.

Run this command for the exact current line-level list:

```sh
TMPDIR=/private/tmp bun scripts/audit-frontend-dead-code.ts
```
