// -----------------------------------------------------------------------------
// Runtime schema re-exports (zod).
//
// These are the zod schemas the renderer uses for client-side validation.
// Unlike domain-types.ts this file has runtime imports — the schemas
// themselves ship into the renderer bundle.
//
// Kept small on purpose. Any zod schema the renderer needs gets exported
// from here so the electron/renderer import graph stays visible in one
// place.
// -----------------------------------------------------------------------------
