<script setup lang="ts">
import { onMounted, ref, nextTick } from 'vue'
import { record, siteLinks, type SiteLinks } from '@lanjian/hosted-contracts'
import BrandLogo from '../../../desktop/src/renderer/ui/BrandLogo.vue'
import { http, messageOf } from '../api/http'
import './product.css'
import ProductGlass from './ProductGlass.vue'
import editorImage from './assets/product-editor.webp'
import libraryImage from './assets/product-library.webp'
import { usePortalMusic } from './usePortalMusic'
const music = usePortalMusic()
const preview = ref<'editor' | 'library'>('editor')
const links = ref<SiteLinks>({ project: '', download: '', guide: '' })
const loading = ref(true), error = ref(''), step = ref(0), scene = ref(0)
const paused = ref(false)
const chapters = ['关于岚笺', '创作流程', '完整参考书', '桌面版本']
const stages = [
  { title: '先把故事想清楚', label: '定书 · 人物 · 世界', text: '记下核心冲突，写清人物想要什么。把境界、能力边界和系统提示框整理成固定设定，后面的创作有据可依。', excerpt: '沈禾想带着祖父留下的六盏铜灯离乡，却发现旧账里少了一页。', note: '核心创意' },
  { title: '把因果串成一条线', label: '总纲 · 分卷 · 事件', text: '从全书总纲拆出分卷，在事件里记录时间、人物、地点和结果。先发生了什么、谁知道了什么，落在同一条时间线上。', excerpt: '第一日清晨 / 渡口修灯铺\n沈禾、阿绫发现装订针孔偏移，带着账册去北闸寻找实物证据。', note: '四要素事件' },
  { title: '一章一章地展开', label: '章节骨架 · 章纲 · 正文', text: '为章节写清进入状态、剧情节拍和退出状态。AI 依据当前设定与章纲生成候选，正文是否采用、怎样修改，由你决定。', excerpt: '不得提前揭示罗伯的误记，也不能使用尚未达到的引纹能力。', note: '第一章边界' },
  { title: '写完，再认真读一遍', label: '批注 · 审校 · 版本', text: '在正文上留下批注，检查人物、事实和事件之间的矛盾。对照候选与原稿审阅修改，保留版本，再导出你的作品。', excerpt: '保留祖父的灯，还是拆下铜料救人？故事最后的选择，要接住最初的愿望。', note: '结局与人物转变' },
]
async function load() { loading.value = true; error.value = ''; try { links.value = siteLinks(record(await http.request('/api/site')).links) } catch (e) { error.value = messageOf(e) } finally { loading.value = false } }
async function moveScene(index: number, focus = false) { scene.value = (index + chapters.length) % chapters.length; await nextTick(); if (focus) document.getElementById(`scene-${scene.value}`)?.focus() }
async function moveStage(index: number) { step.value = (index + stages.length) % stages.length; await nextTick(); document.getElementById(`stage-${step.value}`)?.focus() }
onMounted(() => { void load(); music.setScene('reveal') })
</script>
<template>
  <div class="product-site" :class="{ 'motion-paused': paused }">
    <div class="product-grid" aria-hidden="true"></div>
    <header class="product-header"><a href="/" aria-label="岚笺首页"><BrandLogo /></a><nav aria-label="项目介绍章节" role="tablist"><button v-for="(label,i) in chapters" :id="`scene-${i}`" :key="label" role="tab" :aria-selected="scene === i" :tabindex="scene === i ? 0 : -1" aria-controls="scene-content" @click="moveScene(i)" @keydown.right.prevent="moveScene(scene+1,true)" @keydown.left.prevent="moveScene(scene-1,true)"><small>0{{ i+1 }}</small>{{ label }}</button></nav><a class="project-directory" href="https://jiangai.space">全部项目 ↗</a></header>
    <main id="scene-content" class="product-main" role="tabpanel" :aria-labelledby="`scene-${scene}`">
      <Transition name="product-copy" mode="out-in"><section :key="scene" class="product-copy">
        <template v-if="scene===0"><p class="product-eyebrow">LANJIAN / 小说创作工作台</p><h1>把想象，<br>写成一部作品。</h1><p class="product-description">从人物与世界，到总纲、章纲和正文。<br>让长篇创作的每一步，都有据可循。</p><div class="product-actions"><a class="product-primary" href="/login">开始创作 <span>↗</span></a><a class="product-secondary" href="/app?guest=1">先看实际界面 ↗</a></div><dl class="product-benefits"><div><dt>结构先行</dt><dd>设定 → 总纲 → 章纲 → 正文</dd></div><div><dt>作者决定</dt><dd>AI 起草，你来审阅与定稿</dd></div><div><dt>完整样书</dt><dd>用一部短篇，看懂整个流程</dd></div></dl></template>
        <template v-else-if="scene===1"><p class="product-eyebrow">02 / 从构想到成稿</p><h1>故事很长，<br>下一步很清楚。</h1><div class="product-steps" role="tablist" aria-label="创作阶段"><button v-for="(item,i) in stages" :id="`stage-${i}`" :key="item.title" role="tab" :aria-selected="step===i" :tabindex="step===i?0:-1" aria-controls="product-stage-detail" @click="step=i" @keydown.down.prevent="moveStage(step+1)" @keydown.up.prevent="moveStage(step-1)"><small>0{{i+1}}</small><span>{{item.title}}<small>{{item.label}}</small></span><span aria-hidden="true">↗</span></button></div></template>
        <template v-else-if="scene===2"><p class="product-eyebrow">03 / 内置原创参考书</p><h1>不只有功能。<br>也有完整范例。</h1><p class="product-description">《渡口最后一盏灯》<br>完整设定、事件、章纲与五章正文。<br>阅读免费，登录后可复制为自己的作品。</p><div class="product-actions"><a class="product-primary" href="/app/reference">阅读完整样书 <span>↗</span></a><a class="product-secondary" href="/app?guest=1">在工作台里查看 ↗</a></div><p class="product-note">修灯学徒沈禾想查清祖父的旧账后离乡。一场汛雨，让他必须在留下六盏灯和救下渡口之间做出选择。</p></template>
        <template v-else><p class="product-eyebrow">04 / 在你习惯的地方写作</p><h1>在线体验，<br>或带回自己的桌面。</h1><p class="product-description">网页版使用 Linux DO 登录。<br>桌面版保留本地书稿、自定义模型与独立桌宠。</p><div class="product-actions"><a v-if="links.download" class="product-primary" :href="links.download" target="_blank" rel="noopener noreferrer">下载完整版 <span>↓</span></a><a v-else class="product-primary" href="/login">在线体验 <span>↗</span></a><a v-if="links.project" class="product-secondary" :href="links.project" target="_blank" rel="noopener noreferrer">项目仓库 ↗</a></div><p class="product-note">在线版暂不运行本地文字模型、语音模型与独立桌宠。桌面能力按设备配置启用。</p><a v-if="links.guide" class="product-secondary" :href="links.guide" target="_blank" rel="noopener noreferrer">使用指南 ↗</a><p v-if="loading" role="status">正在读取下载信息…</p><p v-if="error" role="alert">{{error}} <button @click="load">重试</button></p></template>
      </section></Transition>
      <section class="product-stage" aria-label="岚笺实际界面展示">
        <div class="stage-meta"><span><i aria-hidden="true"></i> REAL WORKSPACE / 实际界面</span><div class="preview-tabs"><button :aria-pressed="preview==='editor'" @click="preview='editor'">正文编辑</button><button :aria-pressed="preview==='library'" @click="preview='library'">作品书库</button></div></div>
        <div class="product-material"><ProductGlass :scene="scene" :preview="preview" /><div class="workspace-frame"><div class="frame-top"><span>岚笺 / {{preview==='editor'?'创作工作台':'我的作品'}}</span><span>原项目界面</span></div><Transition name="workspace-image" mode="out-in"><img :key="preview" :src="preview==='editor'?editorImage:libraryImage" :alt="preview==='editor'?'岚笺真实编辑器：章节目录、正文编辑和创作工具':'岚笺真实作品书库：继续创作、作品管理与导入入口'" width="1200" height="768" fetchpriority="high" /></Transition><a class="preview-open" href="/app?guest=1">以游客身份打开，只读浏览 <span>↗</span></a></div></div>
        <div v-if="scene===1" id="product-stage-detail" class="stage-explanation" role="tabpanel" :aria-labelledby="`stage-${step}`"><span class="stage-index">0{{step+1}}</span><div><h2>{{stages[step]!.label}}</h2><p>{{stages[step]!.text}}</p></div></div>
        <div v-else class="structure-line" aria-label="创作结构"><span>设定</span><i>→</i><span>总纲</span><i>→</i><span>章纲</span><i>→</i><span>正文</span><span class="structure-caption">同一部作品，完整的创作链路。</span></div>
      </section>
    </main>
    <footer class="product-footer"><span>记录人类的想象。</span><div><button class="product-sound" :data-state="music.state.value" :aria-pressed="music.enabled.value" @click="music.toggle">{{music.label.value}}</button><button :aria-pressed="paused" @click="paused=!paused">{{paused?'播放界面动效':'暂停界面动效'}}</button></div><span>LANJIAN · FROM IDEA TO MANUSCRIPT</span></footer>
  </div>
</template>
