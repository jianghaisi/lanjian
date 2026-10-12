import { mkdir, mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { integer, record, text, uuid } from '@lanjian/hosted-contracts'
import * as d from '../../../../desktop/src/contracts/ipc'
import { decodeFormalSkeletonPreviewArgs, decodeFormalSkeletonTokenArgs, decodeChapterEventAdoptionArgs } from '../../../../desktop/src/contracts/planning/ipc'
import { decodeConfirmedImportCommitArgs } from '../../../../desktop/src/contracts/library/import-ipc'
import * as review from '../../../../desktop/src/contracts/document-review/validation'
import * as annotation from '../../../../desktop/src/contracts/document-review/annotation-validation'
import { projectTargetPath } from '../../../../desktop/src/main/platform/storage/project-path'
import type { HostedWritingRoutes } from './writing-routes.ts'
import { fail } from './errors.ts'

function privateInput(value: unknown, bookId: string, root: string): unknown {
  return JSON.parse(JSON.stringify(value, (key, value: unknown) => {
    if (key === 'workItemId' || key === 'expectedWorkItemId') { if (value !== bookId) fail('conflict'); return root }
    if (key === 'workItemPath' || key === 'path' || key === 'root') fail('invalid-request')
    return value
  })) as unknown
}
export function registerDomainRoutes({ route, jobs }: Pick<HostedWritingRoutes, 'route' | 'jobs'>) {
  route('POST', '/imports/preview', async (r, request) => {
    const p = record(request.body, ['filename', 'content']), name = text(p.filename, 120)
    if (!/^[^<>:"/\\|?*]+\.(txt|md)$/iu.test(name) || typeof p.content !== 'string' || !p.content.trim() || p.content.includes('\0') || Buffer.byteLength(p.content) > 1024 * 1024) fail('invalid-request')
    const parent = await projectTargetPath(r.root, join(r.root, '.webnovel', 'hosted-uploads'))
    await mkdir(parent, { recursive: true, mode: 0o700 })
    const directory = await mkdtemp(join(parent, 'preview-')), path = join(directory, name)
    try {
      await writeFile(path, p.content, { flag: 'wx', mode: 0o600 })
      const result = await r.imports.previewFile(path)
      if (result.chapterCount + (await r.documents.chapters()).length > 500) fail('quota-exceeded')
      return result
    } finally { await unlink(path).catch(() => undefined); await rmdir(directory).catch(() => undefined) }
  })
  route('POST', '/imports/commit', (r, request) => r.imports.commit(decodeConfirmedImportCommitArgs([privateInput(request.body, request.params.bookId!, r.root)])[0]))
  route('GET', '/imports/recoveries', r => r.imports.recoverableManifests())
  route('GET', '/world-map', r => r.worldMap.read())
  route('PUT', '/world-map', (r, request) => r.worldMap.write(d.decodeWorldMapWriteArgs([privateInput(request.body, request.params.bookId!, r.root)])[0]))
  route('GET', '/character-aliases', r => r.manuscripts.characterAliases(r.root))
  route('PUT', '/character-aliases', (r, request) => r.manuscripts.replaceCharacterAliases(r.root, d.decodeCharacterAliasesArgs([request.body])[0]))
  route('GET', '/character-state', r => r.workspace.characterState())
  route('GET', '/relations', r => r.manuscripts.storyEntityRelations(r.root))
  route('POST', '/relations', (r, request) => r.manuscripts.saveStoryEntityRelation(r.root, d.decodeStoryEntityRelationArgs([request.body])[0]))
  route('GET', '/resources', r => r.manuscripts.resourceLedger(r.root))
  route('POST', '/resources', (r, request) => r.manuscripts.appendResourceLedger(r.root, d.decodeResourceLedgerAppendArgs([request.body])[0]))
  route('GET', '/foreshadowing', r => r.manuscripts.foreshadowLedger(r.root))
  route('POST', '/foreshadowing', (r, request) => r.manuscripts.recordForeshadowAction(r.root, d.decodeForeshadowActionArgs([request.body])[0]))
  route('GET', '/ideas', r => r.manuscripts.ideas(r.root))
  route('POST', '/ideas', (r, request) => r.manuscripts.saveIdea(r.root, d.decodeIdeaSaveArgs([request.body])[0]))
  route('GET', '/planning/draft', r => jobs.services(r).packages.get())
  route('PUT', '/planning/draft', (r, request) => jobs.services(r).packages.save(d.decodePlanningPackageArgs([privateInput(request.body, request.params.bookId!, r.root)])[0]))
  route('POST', '/planning/total/preview', (r, request) => jobs.services(r).packages.previewTotalAdoption(uuid(record(request.body, ['proposalId']).proposalId)))
  route('POST', '/planning/total/adopt', (r, request) => jobs.services(r).packages.adoptTotal(d.decodePlanningTotalAdoptionArgs([request.body])[0]))
  route('POST', '/planning/volumes/preview', (r, request) => jobs.services(r).packages.previewVolumeStructure(uuid(record(request.body, ['proposalId']).proposalId)))
  route('POST', '/planning/volumes/adopt', (r, request) => jobs.services(r).packages.initializeVolumeStructure(d.decodePlanningVolumeStructureArgs([request.body])[0]))
  route('POST', '/planning/volume-outline/preview', (r, request) => {
    const p = record(request.body, ['proposalId', 'volume'])
    return jobs.services(r).packages.previewVolumeOutlineAdoption(...d.decodePlanningVolumeOutlinePreviewArgs([p.proposalId, p.volume]))
  })
  route('POST', '/planning/volume-outline/adopt', (r, request) => jobs.services(r).packages.adoptVolumeOutline(d.decodePlanningVolumeOutlineAdoptionArgs([request.body])[0]))
  route('POST', '/planning/skeleton/preview', (r, request) => {
    const p = record(request.body, ['proposalId', 'volume'])
    return jobs.services(r).packages.previewFormalSkeleton(...decodeFormalSkeletonPreviewArgs([p.proposalId, p.volume]))
  })
  route('POST', '/planning/skeleton/adopt', (r, request) => jobs.services(r).packages.adoptFormalSkeleton(decodeFormalSkeletonTokenArgs([record(request.body, ['token']).token])[0]))
  route('POST', '/planning/chapter/preview', (r, request) => {
    const p = record(request.body, ['proposalId', 'chapterId'])
    return jobs.services(r).packages.previewChapterEvents(...d.decodePlanningChapterDetailAdoptionPreviewArgs([p.proposalId, p.chapterId]))
  })
  route('POST', '/planning/chapter-event/preview', (r, request) => {
    const p = record(request.body, ['proposalId', 'chapterId', 'events'])
    return jobs.services(r).packages.previewChapterEventAdoption(...decodeChapterEventAdoptionArgs([p.proposalId, p.chapterId, p.events]))
  })
  route('POST', '/planning/chapter-event/adopt', (r, request) => jobs.services(r).packages.adoptChapterEvent(decodeFormalSkeletonTokenArgs([record(request.body, ['token']).token])[0]))
  route('POST', '/planning/characters/preview', (r, request) => jobs.services(r).packages.previewCharacterSeedAdoption(uuid(record(request.body, ['proposalId']).proposalId)))
  route('POST', '/planning/characters/adopt', (r, request) => jobs.services(r).packages.adoptCharacterSeeds(d.decodePlanningCharacterSeedAdoptionArgs([request.body])[0]))
  route('POST', '/planning/world/preview', (r, request) => jobs.services(r).packages.previewWorldSeedAdoption(uuid(record(request.body, ['proposalId']).proposalId)))
  route('POST', '/planning/world/adopt', (r, request) => jobs.services(r).packages.adoptWorldSeed(d.decodePlanningWorldSeedAdoptionArgs([request.body])[0]))
  route('POST', '/planning/power/preview', (r, request) => jobs.services(r).packages.previewPowerSystemAdoption(uuid(record(request.body, ['proposalId']).proposalId)))
  route('POST', '/planning/power/adopt', (r, request) => jobs.services(r).packages.adoptPowerSystem(d.decodePlanningPowerSystemAdoptionArgs([request.body])[0]))
  route('POST', '/planning/cheat/preview', (r, request) => jobs.services(r).packages.previewCheatSystemAdoption(uuid(record(request.body, ['proposalId']).proposalId)))
  route('POST', '/planning/cheat/adopt', (r, request) => jobs.services(r).packages.adoptCheatSystem(d.decodePlanningCheatSystemAdoptionArgs([request.body])[0]))
  route('POST', '/planned-chapters/start', (r, request) => r.planning.startPlannedChapter(d.decodePlannedChapterStartArgs([request.body])[0]))
  route('POST', '/chapters/:id/place', (r, request) => r.planning.placeChapter(integer(Number(request.params.id), 1, 100000), integer(record(request.body, ['volume']).volume, 1, 100)))
  route('POST', '/documents/snapshot', (r, request) => jobs.services(r).review.readSnapshot(review.decodeDocumentTarget(privateInput(request.body, request.params.bookId!, r.root))))
  route('POST', '/documents/reviews', (r, request) => jobs.services(r).review.listReviews(review.decodeDocumentRef(privateInput(request.body, request.params.bookId!, r.root))))
  route('POST', '/documents/review/open', (r, request) => jobs.services(r).review.openReview(review.decodeOpenReview(privateInput(request.body, request.params.bookId!, r.root))))
  route('POST', '/documents/review/sync', (r, request) => jobs.services(r).review.syncDraft(review.decodeSyncDraft(privateInput(request.body, request.params.bookId!, r.root))))
  route('POST', '/documents/review/prepare', (r, request) => jobs.services(r).review.prepareDecision(review.decodePrepare(privateInput(request.body, request.params.bookId!, r.root))))
  route('POST', '/documents/review/acknowledge', (r, request) => jobs.services(r).review.acknowledgeStage(review.decodeAcknowledge(privateInput(request.body, request.params.bookId!, r.root))))
  route('POST', '/documents/review/save', (r, request) => jobs.services(r).review.saveReviewedDraft(review.decodeSave(privateInput(request.body, request.params.bookId!, r.root))))
  route('POST', '/documents/review/discard', (r, request) => jobs.services(r).review.discardDecision(review.decodeDiscard(privateInput(request.body, request.params.bookId!, r.root))))
  route('POST', '/documents/review/recover', (r, request) => jobs.services(r).review.recoverDraft(review.decodeDocumentRef(privateInput(request.body, request.params.bookId!, r.root))))
  route('POST', '/annotations/list', (r, request) => jobs.services(r).review.listAnnotations(annotation.decodeAnnotationList(privateInput(request.body, request.params.bookId!, r.root))))
  route('POST', '/annotations', (r, request) => jobs.services(r).review.createAnnotation(annotation.decodeAnnotationCreate(privateInput(request.body, request.params.bookId!, r.root))))
  route('PUT', '/annotations', (r, request) => jobs.services(r).review.changeAnnotation('update', annotation.decodeAnnotationUpdate(privateInput(request.body, request.params.bookId!, r.root))))
  for (const action of ['remove', 'resolve', 'reopen'] as const) route('POST', `/annotations/${action}`, (r, request) => jobs.services(r).review.changeAnnotation(action, annotation.decodeAnnotationChange(privateInput(request.body, request.params.bookId!, r.root))))
}
