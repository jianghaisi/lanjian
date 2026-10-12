import { exactArgs, type ArgsDecoder } from '../core/validation'
import { decodeSettlementDraftInput, decodeSettlementPreviewInput, decodeSettlementWithdrawal, decodeSettlementStart, settlementNumber, settlementText } from './prose-event-settlement-contracts'
function one<T>(decode:(value:unknown)=>T):ArgsDecoder<[T]>{return args=>{exactArgs(args,1);return [decode(args[0])]}}
export const decodeSettlementChapterArgs=one(value=>settlementNumber(value))
export const decodeSettlementIdArgs=one(value=>settlementText(value))
export const decodeSettlementDraftArgs=one(decodeSettlementDraftInput)
export const decodeSettlementPreviewArgs=one(decodeSettlementPreviewInput)
export const decodeSettlementWithdrawArgs=one(decodeSettlementWithdrawal)
export const decodeSettlementStartArgs=one(decodeSettlementStart)
