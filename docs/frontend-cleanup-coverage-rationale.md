# Frontend Cleanup Coverage Rationale

Last reviewed during the frontend cleanup pass on 2026-05-04.

This cleanup changed many interactive frontend files, but the intended behavior changes were architecture and render-purity oriented:

- route modules now compose feature screen components directly instead of proxying through `src/pages`;
- raw preload subscriptions were moved into shared bridge or owning transport modules;
- dialog/drawer reset flows were rewritten so state is initialized by keyed mounted content instead of render-adjacent effects;
- view/workspace/pod/workflow callbacks and memo dependencies were tightened to satisfy React hook correctness without changing visible controls.

No new keyboard model, focus trap, drag gesture, menu command, or form workflow was introduced as part of these changes. Existing coverage remains the relevant safety net:

- feature tests cover pod creation, workspace explorer behavior, view-store layout state, terminal registry behavior, server fan-out/pairing helpers, and URL helpers;
- Storybook coverage exists for app layout, settings, pod rows, pod creation, and agent concepts;
- the full lint path now runs ESLint React hooks checks, frontend architecture checks, unsafe-type budget checks, dead-code audit, barrel import checks, backend architecture checks, and Biome.

Focused browser/e2e reruns were not added for this pass because the touched UI work preserved existing interaction semantics and did not add new user-facing states. Future changes that alter keyboard/focus behavior, DnD semantics, dialog affordances, or route-level workflows should add a focused test, Storybook story, or e2e case in the same change.
