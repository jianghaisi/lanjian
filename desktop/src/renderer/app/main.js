// Copyright (c) 2026 左岚. All rights reserved.
// main.js - Vue 应用入口

import { createApp } from 'vue'
import App from './AppShell.vue'
import { assistFieldDirective } from '../features/assistant/services/assistant-field-registry'
import '../assets/narrative-tokens.css'
import '../assets/desktop.css'
import '../assets/workflow-guidance.css'
import '../assets/desktop-redesign.css'
import '../assets/workspace-design.css'
import '../assets/narrative-terminal.css'
import '../assets/approved-archive.css'

createApp(App).directive('assist-field', assistFieldDirective).mount('#app')
