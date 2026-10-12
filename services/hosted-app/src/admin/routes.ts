import { uuid } from '@lanjian/hosted-contracts'
import type { WritingRouteContext } from '../http/writing-routes.ts'
import { readSite, updateSite } from './site-store.ts'
export function registerAdminRoutes(ctx: WritingRouteContext) {
  const { app, db, admin, credits } = ctx
  app.get('/api/site', async () => ({ links: readSite(db).links, welcomePoints: 10, loginConfigured: Boolean(ctx.config.oauth) }))
  app.get('/api/admin/site', async request => { admin(request); return readSite(db) })
  app.put('/api/admin/site', async request => updateSite(db, admin(request, true).user.id, request.body))
  app.get<{ Params: { id: string } }>('/api/admin/users/:id/credits', async request => {
    admin(request); const id = uuid(request.params.id)
    return { wallet: credits.wallet(id), entries: credits.entries(id), pending: credits.pending(id) }
  })
  app.get('/api/admin/activity', async request => {
    admin(request)
    return {
      audit: db.all('SELECT id,actor,action,target,created_at AS createdAt FROM audit ORDER BY created_at DESC,rowid DESC LIMIT 100'),
      jobs: db.all('SELECT id,owner_id AS userId,model_id AS modelId,kind,status,error_code AS error,created_at AS createdAt FROM jobs ORDER BY created_at DESC,rowid DESC LIMIT 100'),
      usage: db.all('SELECT j.model_id AS modelId,COUNT(*) AS attempts,SUM(a.input_tokens) AS inputTokens,SUM(a.output_tokens) AS outputTokens,SUM(CASE WHEN a.input_tokens IS NULL OR a.output_tokens IS NULL THEN 1 ELSE 0 END) AS unknownUsage FROM attempts a JOIN jobs j ON j.id=a.job_id WHERE a.created_at>=? GROUP BY j.model_id', db.now() - 86400000)
    }
  })
}
