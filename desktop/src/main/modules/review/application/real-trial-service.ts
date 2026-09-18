import { join, resolve } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { buildRealTrialReport, REAL_TRIAL_REPORT_RELATIVE_PATH, type RealTrialReport } from '../domain/real-trial-report'
import type { WorkspaceDatabaseFactory, WorkspaceRealTrialChapterInput, WorkspaceRealTrialConclusionInput } from '../../../core/ports/workspace-database'
import { projectDirectory } from '../../../platform/storage/project-path'
import { writeJson } from '../../../platform/storage/json-store'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'

type RealTrialProjects = { currentPath: () => Promise<string> }

export class RealTrialService {
  constructor(
    private readonly databases: WorkspaceDatabaseFactory,
    private readonly projects: RealTrialProjects,
    private readonly now = () => new Date(),
    private readonly writes: WorkspaceWriteCoordinator = new WorkspaceWriteCoordinator()
  ) {}

  async report(): Promise<RealTrialReport> {
    const root = await this.projects.currentPath()
    const database = await this.databases.openExisting(root)
    if (!database || database.storageMode() !== 'sqlite') {
      database?.close()
      throw new AppError('FEATURE_UNAVAILABLE', '真实试跑记录使用 SQLite 正式数据；请先在项目数据中完成正式切换。', { recoverable: true })
    }
    try {
      return buildRealTrialReport(root, database.listRealTrialChapters(), this.now().toISOString(), database.realTrialConclusion())
    } finally {
      database.close()
    }
  }

  async saveChapter(input: WorkspaceRealTrialChapterInput): Promise<RealTrialReport> {
    const root = await this.projects.currentPath()
    return this.writes.run(root, async () => {
      const database = await this.databases.openExisting(root)
      if (!database || database.storageMode() !== 'sqlite') {
        database?.close()
        throw new AppError('FEATURE_UNAVAILABLE', '真实试跑记录使用 SQLite 正式数据；请先在项目数据中完成正式切换。', { recoverable: true })
      }
      let report: RealTrialReport
      try {
        const records = database.listRealTrialChapters()
        if (records.length >= 30 && !records.some((record) => record.legacyChapterId === input.legacyChapterId)) {
          throw new AppError('CONFLICT', '本轮真实试跑已记录 30 章；请先形成结论，不再扩张样本窗口。', { recoverable: true })
        }
        database.upsertRealTrialChapter(input)
        report = buildRealTrialReport(root, database.listRealTrialChapters(), this.now().toISOString(), database.realTrialConclusion())
      } finally {
        database.close()
      }
      if (resolve(await this.projects.currentPath()) !== resolve(root)) {
        throw new AppError('CONFLICT', '保存试跑记录期间已切换作品；原作品的 SQLite 记录已保存，但没有向新作品写入报告。', { recoverable: true })
      }
      const reportPath = await projectDirectory(root, join(root, ...REAL_TRIAL_REPORT_RELATIVE_PATH.split('/')))
      await writeJson(reportPath, report)
      return report
    })
  }

  async saveConclusion(input: WorkspaceRealTrialConclusionInput): Promise<RealTrialReport> {
    const root = await this.projects.currentPath()
    return this.writes.run(root, async () => {
      const database = await this.databases.openExisting(root)
      if (!database || database.storageMode() !== 'sqlite') {
        database?.close()
        throw new AppError('FEATURE_UNAVAILABLE', '真实试跑结论使用 SQLite 正式数据；请先在项目数据中完成正式切换。', { recoverable: true })
      }
      let report: RealTrialReport
      try {
        database.upsertRealTrialConclusion(input)
        report = buildRealTrialReport(root, database.listRealTrialChapters(), this.now().toISOString(), database.realTrialConclusion())
      } finally {
        database.close()
      }
      if (resolve(await this.projects.currentPath()) !== resolve(root)) {
        throw new AppError('CONFLICT', '保存试跑结论期间已切换作品；原作品的 SQLite 结论已保存，但没有向新作品写入报告。', { recoverable: true })
      }
      const reportPath = await projectDirectory(root, join(root, ...REAL_TRIAL_REPORT_RELATIVE_PATH.split('/')))
      await writeJson(reportPath, report)
      return report
    })
  }
}
