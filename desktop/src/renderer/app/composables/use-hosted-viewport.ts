import { onBeforeUnmount, onMounted, ref } from 'vue'

/** Browser layout only; never persist a small viewport as an author preference. */
export function useHostedViewport() {
  const media = window.novelDesktop?.app.platform === 'browser' ? window.matchMedia('(max-width: 900px)') : null
  const narrow = ref(Boolean(media?.matches))
  const update = () => { narrow.value = Boolean(media?.matches) }
  onMounted(() => media?.addEventListener('change', update))
  onBeforeUnmount(() => media?.removeEventListener('change', update))
  return narrow
}
