import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse } from '@vue/compiler-dom'
import { tsImport } from 'tsx/esm/api'
const { assistantFieldCatalog } = await tsImport('../src/contracts/assistant/assistant-field-catalog.ts', import.meta.url)

// Read-only source audit. Never generate bindings or overwrite the reviewed catalog.
if (process.argv.includes('--register')) throw new Error('Registration generation has been retired; review explicit adapters instead.')
const directive=(n,k)=>n.props?.find(p=>p.type===7&&p.name===k)
const binding=(n,k)=>n.props?.find(p=>p.type===7&&p.name==='bind'&&p.arg?.content===k)
const protectedBindings=/apiKey|baseUrl|parentPath|projectTrashConfirmation|externalConfirmed|selectedChapterIndexes|manifestChapterSelections|chapterCardAdoption|aiConnectionDeletePreview|realTrialChapterId|realTrialDraft\.(satisfaction|continueNextChapter|planningMinutes|writingMinutes|aiEditingMinutes|factReviewMinutes|misappliedChanges|modelCost)|realTrialConclusionDraft\.decision|chapterCardDraft\.status|storyEntityDraft\.status|alwaysConfirmBeforeSend|foreshadowDraft\.(foreshadowId|legacyChapterId)|resourceLedgerDraft\.eventId|storyRelationDraft\.(subjectEntityId|objectEntityId)|(?:image|manual)ConnectionId/
const internal=/\/(?:assistant\/|WritingAgentPanel\.vue|WritingRebaseDialog\.vue|DesktopPetWindow\.vue)/
async function files(root){const out=[];for(const entry of await readdir(root,{withFileTypes:true})){const path=resolve(root,entry.name);if(entry.isDirectory())out.push(...await files(path));else if(path.endsWith('.vue'))out.push(path)}return out}
const inventory=[]
for(const path of await files(resolve('src'))){
  const file=relative(process.cwd(),path).replaceAll('\\','/'),template=parseSfc(await readFile(path,'utf8')).descriptor.template
  if(!template)continue
  function walk(node,parents=[]){
    if(node.type===1){
      const adapter=directive(node,'assist-field')||binding(node,'assistant-field')
      const ancestor=[...parents].reverse().find(p=>directive(p,'assist-field'))
      const model=directive(node,'model'), value=binding(node,'value')||binding(node,'checked')
      const editable=['input','textarea','select','PlainTextEditor'].includes(node.tag)
      if(editable||adapter){
        const expr=model?.exp?.content||value?.exp?.content||'',events=node.props.filter(p=>p.type===7&&p.name==='on').map(p=>({event:p.arg?.content,handler:p.exp?.content}))
        let classification=adapter?'registered':ancestor?'semantic group':undefined
        if(!classification&&node.props.some(p=>p.type===6&&p.name==='readonly'))classification='protected: read-only evidence'
        if(!classification&&protectedBindings.test(expr))classification='protected: credential, path, identity, measurement or author approval'
        if(!classification&&/\/(?:ProjectLibrary|LibraryWorksGallery|LibraryAppearanceSettings)\.vue$/.test(file))classification='protected: author confirmed library has no assistant'
        if(!classification&&internal.test(file))classification=file.includes('DesktopPetWindow')?'auxiliary: standalone companion controls':'protected: assistant instructions, routing or candidate approval'
        if(!classification&&file.endsWith('PlainTextEditor.vue'))classification='wrapper: explicit assistant-field prop or protected prose'
        if(!classification&&file.endsWith('ManuscriptEditor.vue')&&node.tag==='PlainTextEditor')classification='prose: existing versioned writing-agent adoption'
        if(!classification&&/\/writing-plugins\/components\/(WritingPluginSettings|BookPluginComposition|PluginFilters|PersonalPlugins|PluginDraftEditor|PluginWorkflowEditor|PluginMarket)\.vue$/.test(file))classification='protected: plugin authoring, discovery, composition and permission approval'
        if(!classification&&file.endsWith('/characters/components/WorldbookEntryEditor.vue'))classification='protected: author-owned lore disclosure and private notes'
        if(!classification&&file.endsWith('SettingsWorkbench.vue')&&/^worldbook(Search|Type)$/.test(expr))classification='protected: worldbook discovery filters'
        if(!classification&&file.endsWith('OutlineRecoveryShelf.vue'))classification='protected: recovery object identity'
        if(!classification&&file.endsWith('CompanionSettings.vue')&&expr==='projectSpecific')classification='protected: preference scope decision'
        if(!classification&&file.endsWith('AppShell.vue')&&/eventPlacementValue|selectedChapterVolume|selectedChapterStage|chapter\.(volumeId|stageId)/.test(expr))classification='protected: formal event or chapter assignment'
        inventory.push({file,line:template.loc.start.line+node.loc.start.line-1,tag:node.tag,binding:expr,classification:classification||'UNCLASSIFIED',adapter:adapter?.exp?.content||directive(ancestor||{},'assist-field')?.exp?.content,events})
      }
      for(const child of node.children||[])walk(child,[...parents,node])
    }else for(const child of node.children||[])walk(child,parents)
  }
  walk(parse(template.content))
}
const unclassified=inventory.filter(x=>x.classification==='UNCLASSIFIED')
const missingCapabilities=inventory.flatMap(item=>{const id=item.adapter?.match(/\bid\s*:\s*['"]([^'"]+)['"]/)?.[1];return id&&!assistantFieldCatalog[id]?[{file:item.file,line:item.line,id}]:[]})
const report={scannedAt:new Date().toISOString(),summary:{inputs:inventory.length,registered:inventory.filter(x=>x.classification==='registered'||x.classification==='semantic group').length,unclassified:unclassified.length,missingCapabilities:missingCapabilities.length},inventory}
const outputFlag=process.argv.indexOf('--output')
if(outputFlag>=0&&!process.argv[outputFlag+1])throw new Error('--output requires a report file')
await writeFile(outputFlag>=0?process.argv[outputFlag+1]:'../.trellis/tasks/09-10-v3-workspace-consistency-and-assistant/research/input-binding-audit.json',JSON.stringify(report,null,2))
console.log(JSON.stringify(report.summary));if(unclassified.length||missingCapabilities.length){console.log(JSON.stringify({unclassified,missingCapabilities},null,2));process.exitCode=1}
