import JSZip from 'jszip'
import { AppError } from '../../../core/errors/app-error'
/** Inspect declared expansion before reusing Mammoth's original document decoder. */
export async function assertDocumentArchive(bytes:Buffer){
  try{
    const zip=await JSZip.loadAsync(bytes),entries=Object.values(zip.files)
    if(entries.length>10000)throw new Error('ARCHIVE_LIMIT')
    let total=0
    for(const entry of entries){if(entry.dir)continue;const size=(entry as unknown as {_data:{uncompressedSize:number}})._data?.uncompressedSize
      if(!Number.isSafeInteger(size)||size<0||size>40*1024*1024)throw new Error('ARCHIVE_LIMIT');total+=size;if(total>64*1024*1024)throw new Error('ARCHIVE_LIMIT')
    }
  }catch{throw new AppError('VALIDATION_ERROR','Word文件损坏或解压后超过64MB容量，请拆分后导入。',{recoverable:true})}
}
