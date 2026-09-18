// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createAppFeedbackActions(ports) {
  function notice(message) {
    ports.toast.value = message
    window.setTimeout(() => {
      if (ports.toast.value === message) ports.toast.value = ''
    }, 2800)
  }

  async function guard(action, success) {
    ports.busy.value = true
    try {
      const result = await action()
      if (success) notice(success)
      return result
    } catch (error) {
      notice(error?.message || '操作失败')
      throw error
    } finally {
      ports.busy.value = false
    }
  }

  return { notice, guard }
}
