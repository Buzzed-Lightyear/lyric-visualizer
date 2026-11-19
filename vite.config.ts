import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/**
 * Dev-only endpoint: POST /__presetFeedback persists the preset feedback
 * (section choices and bans from the ] [ N keys) to src/presetFeedback.json,
 * so it outlives the browser and can be read in later passes.
 */
function presetFeedbackEndpoint(): Plugin {
  return {
    name: 'preset-feedback-endpoint',
    configureServer(server) {
      server.middlewares.use('/__presetFeedback', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST only')
          return
        }
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { chosen?: unknown; banned?: unknown }
            if (
              typeof parsed.chosen !== 'object' ||
              parsed.chosen === null ||
              Array.isArray(parsed.chosen) ||
              !Array.isArray(parsed.banned) ||
              parsed.banned.some((b) => typeof b !== 'string')
            ) {
              throw new Error('bad shape')
            }
            const clean = { chosen: parsed.chosen, banned: parsed.banned }
            fs.writeFileSync(
              path.resolve('src/presetFeedback.json'),
              JSON.stringify(clean, null, 2) + '\n',
            )
            res.statusCode = 200
            res.end('ok')
          } catch {
            res.statusCode = 400
            res.end('expected { chosen: {}, banned: [] }')
          }
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), presetFeedbackEndpoint()],
})
