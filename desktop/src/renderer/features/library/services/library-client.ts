import type { LibraryOutlineRequest, LibraryOutlinePreview } from '../../../../contracts/library/library-outline-preview'

export const libraryClient = {
  preview(input: LibraryOutlineRequest): Promise<LibraryOutlinePreview> {
    const desktop = window.novelDesktop
    if (!desktop?.projects.libraryOutlinePreview) return Promise.reject(new Error('目录预览需要新版桌面客户端，请重新启动应用后重试。'))
    return desktop.projects.libraryOutlinePreview(input)
  }
}
