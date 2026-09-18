// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createCompanionInteractionActions(ports) {
  function noteCompanionTyping(event) {
    if (
      event &&
      !event.target?.matches?.(
        'input:not([type=checkbox]):not([type=range]), textarea, [contenteditable=true], [contenteditable=true] *'
      )
    )
      return
    ports.companionTyping.value = true
    window.clearTimeout(ports.companionQuietTimer)
    ports.companionQuietTimer = window.setTimeout(() => {
      ports.companionTyping.value = false
    }, 1800)
  }

  return { noteCompanionTyping }
}
