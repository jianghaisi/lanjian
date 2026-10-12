import { onBeforeUnmount, ref } from 'vue'
export function useAssistantPanelWidth() {
  const key='lanjian-assistant-expanded-width', minimum=480, maximum=1200
  function read(){try{const n=Number(localStorage.getItem(key));return Number.isFinite(n)&&n>=minimum?Math.min(maximum,n):1040}catch{return 1040}}
  const width=ref(read()),error=ref('')
  let cleanup:(()=>void)|undefined
  function save(){try{localStorage.setItem(key,String(width.value));error.value=''}catch{error.value='宽度已调整，但本次未能记住。'}}
  function begin(event:PointerEvent){
    if(event.button!==0)return
    cleanup?.();event.preventDefault()
    const start=event.clientX,actual=(event.currentTarget as HTMLElement).parentElement!.getBoundingClientRect().width
    const move=(e:PointerEvent)=>{width.value=Math.max(minimum,Math.min(maximum,actual+start-e.clientX))}
    const stop=()=>{cleanup?.();save()}
    document.body.classList.add('is-resizing-assistant');window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop);window.addEventListener('pointercancel',stop);window.addEventListener('blur',stop)
    cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop);window.removeEventListener('blur',stop);document.body.classList.remove('is-resizing-assistant');cleanup=undefined}
  }
  function keyboard(event:KeyboardEvent){if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();width.value=event.key==='Home'?minimum:event.key==='End'?maximum:Math.max(minimum,Math.min(maximum,width.value+(event.key==='ArrowLeft'?16:-16)));save()}
  function reset(){width.value=1040;save()}
  onBeforeUnmount(()=>cleanup?.())
  return {width,error,begin,keyboard,reset}
}
