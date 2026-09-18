export const MAX_LOCAL_FRAME = 1024 * 1024
export function encodeLocalFrame(value:unknown):Buffer {
  const bytes=Buffer.from(JSON.stringify(value),'utf8')
  if(!bytes.length||bytes.length>MAX_LOCAL_FRAME)throw new Error('LOCAL_FRAME_LIMIT')
  const header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);return Buffer.concat([header,bytes])
}
export class LocalFrameReader {
  private buffer=Buffer.alloc(0)
  push(chunk:Buffer):Record<string,unknown>[] {
    this.buffer=Buffer.concat([this.buffer,chunk]);const frames:Record<string,unknown>[]=[]
    while(this.buffer.length>=4){
      const size=this.buffer.readUInt32LE(0)
      if(!size||size>MAX_LOCAL_FRAME)throw new Error('LOCAL_FRAME_LIMIT')
      if(this.buffer.length<size+4)break
      const raw=new TextDecoder('utf-8',{fatal:true}).decode(this.buffer.subarray(4,size+4))
      const value:unknown=JSON.parse(raw)
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('LOCAL_FRAME_INVALID')
      frames.push(value as Record<string,unknown>);this.buffer=this.buffer.subarray(size+4)
    }
    if(this.buffer.length>MAX_LOCAL_FRAME+4)throw new Error('LOCAL_FRAME_LIMIT')
    return frames
  }
}

