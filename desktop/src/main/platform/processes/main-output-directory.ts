import { basename, dirname } from 'node:path'

/** Main code can live in either out/main/index.js or out/main/chunks/*.js.
 * Resources stay rooted at out/main in both development and production builds.
 */
export function mainOutputDirectory(moduleDirectory: string): string {
  return basename(moduleDirectory) === 'chunks' ? dirname(moduleDirectory) : moduleDirectory
}
