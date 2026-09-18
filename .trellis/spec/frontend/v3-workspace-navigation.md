# V3 workspace navigation hierarchy

> Status: `verified-current`. Applies to the single-book Vue workspace; it does not define a visual theme or claim author acceptance.

## 1. Scope / Trigger

Apply whenever a workspace page, page mode, primary stage, secondary navigation item or workspace title is added, removed, renamed or re-homed. The contract prevents the former failure mode where `archiveNavigation`, section arrays, activity mappings and title dictionaries independently described different parents.

## 2. Signatures

The renderer navigation service owns these pure contracts:

```ts
type WorkspaceLocation = {
  active: string
  materialSection?: string
  timelineMode?: string
  outlineMode?: string
  preparationMode?: string
  settingsSection?: string
}

leafForLocation(location: WorkspaceLocation): WorkspaceNavigationLeaf | undefined
parentForLeaf(leafId: string): WorkspaceNavigationGroup | undefined
targetForLeaf(leafId: string): WorkspaceTarget | undefined
childrenForParent(parentId: string): readonly WorkspaceNavigationLeaf[]
groupForLocation(location: WorkspaceLocation): WorkspaceNavigationGroup
```

`workspaceNavigationTree` is the sole declaration of parent order, sequence, label, icon, description, leaf membership and compatibility target.

`WorkspaceNavigationLeaf.auxiliary?: boolean` marks a page-local supporting tool, without changing its parent or target. Chronicle's narrow archive sidebar derives events/map as primary entries and foreshadows/character-state as clearly bordered tool buttons. `volume-lines` belongs to planning as “卷概览”; its compatibility target remains `active=timeline, timelineMode=volumes`. The chronicle parent uses `ChronicleSidebar`; planning uses `PlanningSidebar`, including its read-only volume overview. Neither renders the generic explorer in addition to the page-owned sidebar. All links still pass through `selectWorkspaceLeaf` and existing leave guards. Chronicle's render-only sidebar width must not overwrite the author's other-page explorer preferences.

## 3. Contracts

- Every content leaf has exactly one parent and one stable ID.
- Planning owns `total-outline`, `volume-outline`, `volume-lines`, `chapter-skeleton`, `chapter-outline` and auxiliary `preparation`. The former `master-outline` parent maps to planning for compatibility and is not rendered. Visible chapter-skeleton copy uses “章节安排”.
- `PlanningSidebar` groups documents under 总纲/卷纲/章纲. Group and volume-folder buttons only expand/collapse; document-row buttons open their exact stable ID. Volume overview and chapter arrangement are view links within their owning groups; preparation and recovery remain tools. Current-row identity comes from the committed outline editor, never the manuscript's current volume.
- `planningChapterCatalog(written, standalone, placements, volumes)` projects explicit relationships only. Written IDs take precedence over duplicate standalone entries; missing/unknown volume membership stays accessible under 待归卷. Never infer volume from a fixed chapter count. Search spans the complete catalog and uses display position rather than storage ID for written chapters.
- First entry defaults to total outline; subsequent navigation restores the valid current outline kind/object within the open book. Work-item change resets this preference. Directory search/folding never writes author content.
- The primary stage, secondary page, page title and `aria-current` states are derived from the current location through the same tree; do not store a separate selected parent.
- A parent with one leaf does not repeat that leaf as a decorative selected row.
- Definition (`active=profile`) has no secondary sidebar: omit the generic explorer and its resize separator and set its render-only grid track to zero. Keep the primary rail and global assistant; restore other pages' own sidebar and saved width on navigation. This page-local layout must not overwrite the author's explorer preference.
- The explorer does not repeat the active parent label, sequence or description above its real content. Parent/child truth remains in `workspaceNavigationTree`, the selected rail button and the optional multi-leaf directory.
- The primary rail is icon-only at rest. Its grid track, icon size, icon center and row height remain fixed during hover/focus; a clipped label layer reveals to the right without moving or resizing the explorer, resizer or workbench. Pointer clicks must not pin the rail open after pointer leave: pointer expansion follows hover, while non-pointer access follows `focus-visible`. Text fades in without a second positional animation or entrance delay; leaving or moving keyboard focus away clips the label layer again. Visible sequence numbers are omitted, while buttons retain accessible names and titles in both states; reduced-motion disables the transition.
- In the manuscript parent, the chapter directory is the secondary navigation surface. It replaces the generic leaf directory, starts with one full-catalog search and one compact new-chapter action, and must not be displaced by decorative guidance or a second chapter-page selector.
- The chapter directory is one continuous scroll surface in formal volume/chapter order. It does not expose fixed 120-chapter windows or previous/next batch controls; full-catalog search and current-chapter reveal remain available.
- A current manuscript row uses the existing selected surface/edge treatment without a redundant visible “当前” badge. It retains `aria-current="page"`, an accessible current-state label and automatic reveal, so removing the badge does not remove semantic orientation.
- Each manuscript row exposes a compact, keyboard-labelled delete action without making the whole row destructive. The manuscript toolbar owns one chapter-trash entry; its recent-first list shows bounded metadata and an explicit restore action. Delete always uses a confirmation sheet, and no permanent-delete action is exposed in this surface.
- An opened work displays one visually centered title button in the top bar. Activating it uses the existing protected close-project path to return to “我的作品”; separate “作品库” and “当前作品” labels are not rendered.
- The top bar exposes one “智能助笔” entry. Writing-task status and recovery remain in its task subpage instead of competing as a second top-level entry.
- The assistant is available on every authoring page, including definition and zero-chapter books; the library does not expose it, per the author's explicit scope clarification. One “写作指引” button beside the brand opens an anchored animated nonmodal panel. Do not repeat guidance in each tab/explorer. Focus mode keeps dedicated assistant/guidance triggers; “本地” belongs to the bottom save-status area. Exact interaction contracts are in [forms and assistant](v3-form-and-assistant.md).
- The companion portrait has no adjacent arrow-only button. Primary activation still toggles the detached companion; the portrait context menu (mouse right-click, Context Menu key, Shift+F10 or Alt+ArrowDown) exposes recovery, hide and settings actions.
- Application settings are mutually exclusive with creation stages. Story entities may temporarily reuse an internal settings activity, but their resolved parent and visible chrome remain content-level.
- `selectWorkspaceLeaf` resolves a target. Outline documents use `openTotalOutline` / `openVolumeOutline` / `openChapterFromOutlineCatalog` before changing activity or mode. Other pages call protected `selectActivity`, confirm the activity changed, then apply the subordinate mode. For explicit timeline targets it passes `{ deferTimelineLoad: true }` so `selectActivity` does not initialize/await the OLD subordinate page. `selectTimelineMode` owns the chosen loader. It must not bypass draft/save, world-map, composition or work-item guards. Leaving map cancels the local read ticket immediately, without awaiting IPC.
- Old activity IDs may remain as test-selector compatibility attributes during migration; they are not navigation authority.
- Primary action foreground is inherited by its direct text descendants. Explanatory card styles must target their structural content (for example `> div > span`), never every same-named descendant when the card also contains buttons.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Duplicate parent or leaf ID | Contract test fails; do not render the tree |
| Leaf appears under two parents | Contract test fails |
| Unknown internal subordinate mode | Resolve to the nearest truthful canonical page or a safe first group; never highlight two parents |
| Protected activity change is refused | Keep the old location and its derived selections |
| Subordinate mode change is refused | Keep the prior leaf; do not claim navigation success |
| `active=settings, settingsSection=story` | Resolve to the story-content parent; hide settings category chrome |
| Other `active=settings` location | Resolve only to `SYS 设置` |

## 5. Good / Base / Bad Cases

- Good: `timelineMode=characters` resolves to `纪事 → 人物状态`; clicking `伏笔备忘` uses `selectActivity('timeline')` and then the protected timeline-mode loader.
- Base: an internal recovery or planned-chapter mode resolves to the nearest canonical `章纲` page while its page-local recovery UI remains available.
- Bad: a separate array labels `profile/world/system` as children of “素材” while the primary rail uses a different mapping.
- Bad: a story-content page displays settings categories or selects `SYS 设置` because its compatibility activity happens to be `settings`.

## 6. Tests Required

- Pure contract: exact parent order; unique IDs; one owner per leaf; target-to-location round trip; settings/story separation.
- Renderer interaction: one current parent and at most one current leaf after every click; page title/content matches both; single-leaf parents do not duplicate the page.
- Planning: `planning-directory.test.ts` covers 440 entries, explicit membership, unknown volumes, stable identity and search. `scripts/planning-directory-smoke.mjs` uses a completed isolated build, fresh profile and synthetic work; verify document open/save, only-outline documents, stages and pending/error reads.
- Protection: exercise unsaved navigation refusal and Chinese composition through the existing guarded activity path.
- Pending reads: hold `workspace:get-world-map` unresolved in isolated Electron, click events and another primary group with native pointer input; assert navigation completes without a second old-map read and a late response cannot re-enter the map. Loading alone is not a leave guard; dirty/saving/adopting remain protected.
- Desktop/accessibility: native button Enter/Space, modal focus restoration, real hit targets, no horizontal overflow at supported windows/zoom, reduced motion, light/dark evidence.
- Chrome geometry: assert the centered project title, icon-only and hover/focus-revealed rail states, invariant icon/explorer/workbench bounds, 24px centered icons, compact manuscript directory, horizontal owner-window pet menu buttons and focus-mode removal of rail/explorer.
- Contrast: inspect the computed color of visible text descendants on dark or saturated primary actions, not only the button element; normal action text must remain at least 4.5:1 against every solid or gradient stop.
- Creation changes additionally assert the authoritative project exists and the created workspace lands at `定义 → 作品定义`.

## 7. Wrong vs Correct

### Wrong

```ts
const rail = [{ id: 'materials', label: '资料' }]
const section = [{ id: 'profile', label: '作品定义' }]
const parent = active === 'profile' ? 'materials' : active
const title = active === 'profile' ? '作品定义' : '岚笺'
```

These declarations can drift independently and cannot prove a unique parent.

### Correct

```ts
const leaf = leafForLocation(location)
const group = groupForLocation(location)
const section = group.children.length > 1 ? group.children : []
const title = leaf?.label ?? group.label
```

The tree remains the only source of structure; location state continues to be owned by the existing page workflows.
