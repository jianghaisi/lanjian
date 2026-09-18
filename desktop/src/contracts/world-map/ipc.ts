import { AppError } from '../core/app-error'
import {
  decodeWorldMapImageAdoptInput,
  decodeWorldMapImageGenerateInput,
  decodeWorldMapOperationId,
  decodeWorldMapWriteInput,
  type WorldMapImageAdoptInput,
  type WorldMapImageGenerateInput,
  type WorldMapWriteInput
} from './world-map'
import type { ArgsDecoder } from '../core/validation'
import { exactArgs } from '../core/validation'

export const decodeWorldMapWriteArgs: ArgsDecoder<[WorldMapWriteInput]> = (args) => {
  exactArgs(args, 1)
  try {
    return [decodeWorldMapWriteInput(args[0])]
  } catch {
    throw new AppError('VALIDATION_ERROR', '地图定位格式无效，请检查地点和坐标。', { recoverable: true })
  }
}

export const decodeWorldMapImageGenerateArgs: ArgsDecoder<[WorldMapImageGenerateInput]> = (args) => {
  exactArgs(args, 1)
  return [decodeWorldMapImageGenerateInput(args[0])]
}

export const decodeWorldMapImageAdoptArgs: ArgsDecoder<[WorldMapImageAdoptInput]> = (args) => {
  exactArgs(args, 1)
  return [decodeWorldMapImageAdoptInput(args[0])]
}

export const decodeWorldMapImageCancelArgs: ArgsDecoder<[string]> = (args) => {
  exactArgs(args, 1)
  return [decodeWorldMapOperationId(args[0])]
}
