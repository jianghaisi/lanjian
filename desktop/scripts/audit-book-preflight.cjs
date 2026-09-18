const { auditBook } = require('./book-authority-audit.cjs')

async function main() {
  const [projectPath, flag, count, ...rest] = process.argv.slice(2)
  if (!projectPath || rest.length || (flag !== undefined && (flag !== '--expected-chapters' || count === undefined))) {
    throw Object.assign(new Error('用法：npm run audit:book -- <作品目录> [--expected-chapters <数量>]'), { code: 'VALIDATION_ERROR' })
  }
  const report = await auditBook(projectPath, { expectedChapters: count === undefined ? undefined : Number(count) })
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  if (!report.ok) process.exitCode = 1
}
main().catch(error => {
  process.stdout.write(JSON.stringify({ ok: false, code: ['VALIDATION_ERROR','UNSUPPORTED_PROJECT_VERSION','INVALID_PROJECT_STATE','DATABASE_INTEGRITY_FAILED','CONFLICT'].includes(error.code) ? error.code : 'AUDIT_FAILED', message: '审计未完成；作品文件没有被改写。请核对作品路径、版本及存储状态。' }, null, 2) + '\n')
  process.exitCode = 1
})
