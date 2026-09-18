export type WorkspaceIdentity = {
  id: string
  path: string
}

export type WorkspaceRequest = {
  generation: number
  workItemId: string
  path: string
}

export class WorkspaceRequestGuard {
  private generation = 0

  begin(workItem: WorkspaceIdentity): WorkspaceRequest {
    this.generation += 1
    return { generation: this.generation, workItemId: workItem.id, path: workItem.path }
  }

  capture(workItem: WorkspaceIdentity): WorkspaceRequest {
    return { generation: this.generation, workItemId: workItem.id, path: workItem.path }
  }

  invalidate(): void {
    this.generation += 1
  }

  isCurrent(request: WorkspaceRequest, current: WorkspaceIdentity | null | undefined): boolean {
    return Boolean(current
      && request.generation === this.generation
      && request.workItemId === current.id
      && request.path === current.path)
  }
}
