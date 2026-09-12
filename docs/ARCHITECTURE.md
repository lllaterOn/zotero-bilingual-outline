# 架构与数据契约

## 模块

- `addon/bootstrap.js` 加载运行时并管理启动、停用；设置界面由 preferences.xhtml 与 preferences.js 挂载。
- `src/main.ts` 组合存储、阅读器、设置和翻译服务。
- `src/reader.ts` 对接阅读器内部状态，在原目录节点下显示中文，不改 PDF 或原始英文。
- `src/outline.ts` 处理完整目录、可见目录映射和展开状态。目录签名采用标题与路径的规范 JSON。
- `src/translator.ts` 访问固定 DeepSeek HTTPS 服务，校验响应；不自动重试。
- `src/storage.ts` 管理本机持久化、专属笔记、同步协调、清理与恢复。
- `src/sync.ts` 使用因果版本记录合并；不同 PDF 分开，同一 PDF 的并发版本保留待选择。
- `src/preferences.ts` 管理本机密钥、同步开关与维护操作。

## 稳定身份

插件 ID：`bilingual-outline@lllateron`。偏好：`extensions.bilingualOutline.*`。
本机缓存：Zotero 数据目录 `bilingual-outline/state.json`；清理备份：`cleanup-backup.json`。

系列父条目为软件类型，Extra 标记 `personal-zotero-addons-container: 1`。
笔记 JSON 以 `plugin: zotero-bilingual-outline`、`schema: 1` 及 `kind: settings/translations` 识别。
不使用 Zotero 标签识别。译文笔记按完整 HTML 的 UTF-8 容量分块（当前预算 180000 字节）。

## 同步边界

插件读写本地笔记，由 Zotero 传输。两个同步开关与密钥仅在本机；显示偏好和译文分别协调。
清理写入删除版本，防止旧设备把失效记录恢复；用户恢复备份会创建新版本。
已连接笔记缺失或损坏时停止写入，避免静默重建覆盖数据。

## 阅读器边界

阅读器内部接口集中在 reader.ts。跨窗口目录先 JSON 复制，跨窗口传入对象使用 cloneInto。
缓存键是 PDF 附件 key，并验证完整目录签名；原目录位置、折叠和跳转由 Zotero 维护。
异步操作无论成功失败都释放忙碌状态，失败不得覆盖已有译文。
