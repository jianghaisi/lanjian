> V3 status: `candidate-for-v3`. 作品库元数据行为等待 V3-1/V3-4 的入口与作者验收。

# 作品库最近修改信息

## 1. 范围

最近作品需要显示真实修改章节、时间与字数；不能用最近打开时间或最后章号推断最后修改章节。

## 2. 签名

`readLibraryLastEditedChapter(root): Promise<ProjectSummary['manuscript']['lastEditedChapter']>`，位于 main 服务；现有项目列表返回可选投影，不新增写入 IPC。

## 3. 契约

`lastEditedChapter?: { id: number; position: number; title: string; updatedAt: string } | null`。id 为稳定章 ID，position 为当前显示章序。null 表示没有章节；字段省略表示元数据不可用。不能把省略解释成无章。

## 4. 校验与错误

SQLite 正式模式按未归档章节 updated_at 排序；打开数据库使用 readOnly，不迁移、不激活作品。文件模式按有效章文件 mtime。数据库损坏不回退镜像，投影失败省略字段。main 路径约束检查适用于 DB、WAL、SHM 和章文件；IPC 两侧校验有限标题/时间和非负整数。

旧项目身份不一致或重复章号时，不请求最近修改投影、不附加字段、不改变原 updated_at。不能给待核对作品附加看似确定的最近章节；旧身份诊断精确契约保持不变。

## 5. 正常、空与异常

正常：修改第一章后显示第一章，即使全书存在第四百章。空：无章返回 null。异常：损坏正式库返回不可用，不展示猜测章节。

## 6. 测试

`library-last-edited-chapter.test.ts` 覆盖只读、最近更新顺序、归档排除、章序与稳定 ID、文件 mtime、损坏库不回退。真实作品库截图必须同时包含章节、字数、time 元素和可点击的更多按钮。

## 7. 错误与正确

错误：用 `chapters[chapters.length-1]` 或书架 lastOpenedAt 冒充最近修改。正确：从正式源读取更新信息，只展示被确认的结果，未知时明确提示。
