import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: ['./electron/db/schema.ts', './electron/db/task-schema.ts'],
  out: './electron/db/migrations',
  dialect: 'sqlite',
})
