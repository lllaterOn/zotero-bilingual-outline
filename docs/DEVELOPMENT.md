# 开发与发布

## 日常维护

从最新 main 创建 `codex/<task>` 分支，修改后运行 `npm run verify`，提交、推送、创建 PR，再合并。
换电脑前推送未完成工作；避免两台电脑同时修改同一分支。
首次在正式维护目录执行：

```powershell
git clone https://github.com/lllaterOn/zotero-bilingual-outline.git
cd zotero-bilingual-outline
npm ci
npm run verify
```

Node.js 24、Python 3；可用 PYTHON 环境变量指定解释器。
package.json 中 private 仅防止误发布到 npm，不影响 GitHub 公开仓库。

## 验证

verify 串联类型检查、模拟测试、仓库卫生与更新清单校验、构建及 XPI 校验。
dist、addon/runtime.js、依赖与临时文件不提交。构建仅打包七个允许文件。
真实 Zotero 验收按版本另行记录；自动检查不运行真实文库、不调用收费服务。

## 发布

1. 同步 package.json、package-lock.json、addon/manifest.json 的语义版本，更新 CHANGELOG 和该版本人工验收记录，通过 PR 合并。
2. 推送对应 `vX.Y.Z` 标签；Release 工作流重新验证，生成草稿 Release，附 XPI 和 SHA256SUMS。
3. 下载候选包进行真实 Zotero 验收，至少覆盖缓存显示、手动翻译与失败恢复、修订、按钮、设置、双机同步和清理恢复。
4. 验收通过后发布草稿中的同一包，不重新构建或替换资产。失败时保留草稿，修复后使用新版本。
5. published 工作流下载正式资产，验证包与 SHA，更新 main/updates.json。确认工作流成功及更新地址可访问。
6. 不移动已发布标签、不覆盖正式资产。修复使用递增版本。

自动更新仅包含已正式发布的版本；源码版本可以领先。初始仓库的空更新列表会在 v1.0.0 正式发布后填入。
工作流构建作业只有读权限，创建草稿的写权限作业仅上传已生成产物。
正式更新地址固定为 https://raw.githubusercontent.com/lllaterOn/zotero-bilingual-outline/main/updates.json。

v1.0.0 根据维护者对 0.1.9 功能完整性的确认发布；仅更换版本及正式发布元数据，未改动运行逻辑。
