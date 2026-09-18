<script setup>
defineProps({ name: { type: String, required: true }, size: { type: Number, default: 20 } })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <g stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <template v-if="name === 'manuscript'">
        <path d="M5.5 3.5h9l4 4v13h-13z"/><path d="M14.5 3.5v4h4M8.5 11h7M8.5 14.5h7M8.5 18h4.5"/>
      </template>
      <template v-else-if="name === 'definition'">
        <path d="M5 4.5h11.5A2.5 2.5 0 0 1 19 7v12.5H7.5A2.5 2.5 0 0 1 5 17z"/><path d="M5 17a2.5 2.5 0 0 1 2.5-2.5H19M9 8h6M9 11h4"/>
      </template>
      <template v-else-if="name === 'research'">
        <circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5M8 10.5h5M10.5 8v5"/>
      </template>
      <template v-else-if="name === 'world'">
        <circle cx="12" cy="12" r="8.5"/><path d="M3.8 12h16.4M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5S14.4 18.2 12 20.5M12 3.5C9.6 5.8 8.4 8.6 8.4 12s1.2 6.2 3.6 8.5"/>
      </template>
      <template v-else-if="name === 'events'">
        <path d="M5 4v16M19 4v16M5 7h5l2 3h7M5 16h5l2-3h7"/><circle cx="5" cy="7" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="13" r="1.5" fill="currentColor" stroke="none"/>
      </template>
      <template v-else-if="name === 'outline'">
        <path d="M7 5h12M7 12h12M7 19h12"/><circle cx="3.5" cy="5" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="19" r="1"/>
      </template>
      <template v-else-if="name === 'settings'">
        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.52-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.05V3h4v.08a1.7 1.7 0 0 0 1.03 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/>
      </template>
      <template v-else-if="name === 'spark'">
        <path d="M12 2.5c.5 4.8 2.7 7 7.5 7.5-4.8.5-7 2.7-7.5 7.5-.5-4.8-2.7-7-7.5-7.5 4.8-.5 7-2.7 7.5-7.5Z"/><path d="M19 15.5c.2 1.8 1 2.6 2.5 2.8-1.5.2-2.3 1-2.5 2.7-.2-1.7-1-2.5-2.5-2.7 1.5-.2 2.3-1 2.5-2.8Z"/>
      </template>
      <template v-else-if="name === 'plus'">
        <path d="M12 5v14M5 12h14"/>
      </template>
      <template v-else-if="name === 'folder'">
        <path d="M3.5 6.5h6l2-2h9v15h-17z"/><path d="M3.5 9h17"/>
      </template>
      <template v-else-if="name === 'save'">
        <path d="M4 3.5h13l3 3v14H4z"/><path d="M8 3.5v6h8v-6M7.5 20.5v-7h9v7"/>
      </template>
      <template v-else-if="name === 'history'">
        <circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>
      </template>
      <template v-else-if="name === 'undo'">
        <path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h7.5a6 6 0 0 1 6 6"/>
      </template>
      <template v-else-if="name === 'redo'">
        <path d="m15 7 4.5 4.5L15 16"/><path d="M19 11.5h-7.5a6 6 0 0 0-6 6"/>
      </template>
      <template v-else-if="name === 'trash'">
        <path d="M4.5 7h15M9 7V4.5h6V7M7 7l.75 13h8.5L17 7M10 10.5v6M14 10.5v6"/>
      </template>
      <template v-else-if="name === 'restore'">
        <path d="M8 7H4v-4"/><path d="M4.5 7.5A8 8 0 1 1 4 16M4 7l3.5-3.5"/>
      </template>
      <template v-else-if="name === 'panel'">
        <rect x="3" y="4" width="18" height="16" rx="1"/><path d="M15 4v16"/>
      </template>
      <template v-else-if="name === 'close'">
        <path d="m7 7 10 10M17 7 7 17"/>
      </template>
      <template v-else-if="name === 'arrow'">
        <path d="M5 12h13M14 7l5 5-5 5"/>
      </template>
      <template v-else-if="name === 'chevron-right'">
        <path d="m9 5 7 7-7 7"/>
      </template>
      <template v-else-if="name === 'search'">
        <circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5"/>
      </template>
    </g>
  </svg>
</template>
