import type { InspirationSource } from '../../../../contracts/inspiration/types'

export function videoTime(seconds:number|null){
  if(seconds===null||!Number.isFinite(seconds)||seconds<0)return ''
  return `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`
}

export function sourceLink(source:Pick<InspirationSource,'url'>|null|undefined,seconds?:number|null):string|undefined{
  if(!source?.url)return
  try{
    const url=new URL(source.url)
    if(url.protocol!=='https:'||url.username||url.password||url.port)return
    if(['www.bilibili.com','bilibili.com'].includes(url.hostname)&&/^\/video\/(?:BV[a-zA-Z0-9]+|av\d+)\/?$/.test(url.pathname)){
      if(seconds!==undefined&&seconds!==null){if(!Number.isFinite(seconds)||seconds<0||seconds>86400)return;url.searchParams.set('t',String(Math.floor(seconds)))}
      return url.href
    }
    if(['www.douyin.com','douyin.com'].includes(url.hostname)&&/^\/video\/\d+\/?$/.test(url.pathname))return url.href
  }catch{/* Invalid stored links have no navigation action. */}
}
