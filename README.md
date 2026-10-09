# 荣耀笔记导出器

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

一个 Chrome / Edge 浏览器扩展，把**荣耀云笔记**（cloud.honor.com）里的文本笔记和图片笔记导出成本地的 Markdown + 原图 ZIP。

**零依赖**：不需要装 Python，不需要装运行时，不需要配置环境。加载扩展、打开笔记页面、点一下按钮。

> 荣耀云空间没有提供批量导出功能，一条条复制粘贴几百条笔记不现实。这个扩展用荣耀网页版自己在用的接口把笔记一次性取下来。

## 功能

- **一键导出全部**：也可以先导出 10 条验证效果
- **Markdown + 原图**：每条笔记一个 `.md`，图片作为独立文件放在 `assets/`，不是 base64 内嵌
- **保留目录结构**：按荣耀笔记里的文件夹分组
- **保留格式**：标题、加粗、斜体、链接、列表、引用、代码块、表格会转换成 Markdown
- **可断点续跑**：进度记录在 IndexedDB，中断后重新导出会跳过已完成的笔记
- **进度显示**：弹窗里实时显示当前处理到第几条、图片数、失败数
- **导出报告**：ZIP 里附带 `export-report.json`，记录成功、跳过和失败的条目

## 安装

扩展尚未上架 Chrome 应用商店，需要以开发者模式加载：

1. 从 [Releases](../../releases) 下载 `honor-notes-exporter-<版本>.zip`
2. 解压到一个固定目录（解压后应该能看到 `manifest.json`）
3. 打开 `chrome://extensions`（Edge 是 `edge://extensions`）
4. 打开右上角的**开发者模式**
5. 点**加载已解压的扩展程序**，选择第 2 步解压出来的目录

## 使用

1. 打开 https://cloud.honor.com/portal/notepad 并登录
2. 等左侧笔记列表加载出来
3. 点浏览器工具栏上的扩展图标
4. 先点**导出 10 条验证**确认效果，没问题再点**导出全部 / 继续**
5. 导出过程中可以关掉弹窗，任务在页面里继续跑；再次打开弹窗会显示进度
6. 完成后浏览器会下载一个 `honor-notes-export-<日期>.zip`

> **注意**：导出期间**不要关闭笔记页面**。任务运行在页面里，关掉页面任务就中断了（已完成的笔记已存进 IndexedDB，重新导出会跳过）。

## 输出结构

```
honor-notes-export-2026-08-12.zip
├── 工作/
│   ├── 项目排期-a1b2c3d4.md
│   └── 会议纪要-e5f6g7h8.md
├── 未分类/
│   └── 随想-11223344.md
├── assets/
│   ├── a1b2c3d4-001.jpg
│   └── e5f6g7h8-001.png
└── export-report.json
```

每个 `.md` 带 YAML frontmatter：

```markdown
---
honor_uuid: "a1b2c3d4-..."
folder: "工作"
created_at: 2026-01-02T03:04:05.000Z
modified_at: 2026-02-03T04:05:06.000Z
type: 2
---

# 项目排期

正文内容……
```

## 已知限制

请在导出前了解这些边界，它们都是有意为之而不是 bug：

| 限制 | 说明 |
| --- | --- |
| **手写笔记会跳过** | 荣耀的手写笔记（`type: 1`）是专有格式，无法可靠转成 Markdown。跳过的 UUID 记在报告里。 |
| **加密锁定的笔记会跳过** | 已加密的笔记（`lock_status > 0`）正文读不到，跳过并记入报告的 `skippedLocked`。 |
| **需要保持页面打开** | 见上方注意事项。 |
| **导出的是「原图」** | 荣耀为每张图片存了预览图和原图两份，本扩展取原图。文件会比页面上看到的大。 |
| **复杂排版会降级** | 表格、代码块的转换是尽力而为；荣耀编辑器的一些私有样式（如高亮、特殊对齐）会丢失。 |
| **未覆盖音频/视频/附件** | 目前只处理正文里的图片。其他附件类型不会下载。 |
| **接口可能变更** | 依赖荣耀网页版的私有接口。如果荣耀改了接口，扩展会报错而不是导出错误的内容。 |

## 和别的工具比

导出荣耀笔记还有别的方案，按需选择：

| | 本扩展 | [笔记互迁](https://github.com/lingxuanqjc-alt/note-bridge-desktop) |
| --- | --- | --- |
| 形态 | 浏览器扩展 | Windows 桌面程序 |
| 安装 | 加载已解压目录 | 安装包 + WebView2 |
| 导出 | Markdown + 原图 | TXT / Markdown / HTML / DOCX |
| 多平台 | 仅荣耀 | 小米、OPPO、vivo、华为、荣耀、魅族、WPS |
| 写回云端 | 不支持，只读 | 支持迁移到其他平台 |

想跨平台迁移笔记用「笔记互迁」；只想要一个轻量、免安装的荣耀笔记导出工具，用这个。

## 隐私

- 扩展只访问 `cloud.honor.com` 和荣耀的文件服务域名，只读取当前**已登录**账号的笔记。
- 不收集账号密码，不读取 Cookie 内容，**不向任何第三方服务器发送笔记内容**。
- 导出的 ZIP 通过浏览器本地下载保存，全程不经过外部服务器。
- 所有代码都在本仓库里，没有压缩混淆的第三方代码，只有 `fflate`（MIT）作为打包依赖。

## 从源码构建

需要 Node.js 18+：

```bash
npm install
npm run build     # 由 src/content.js 打包出 dist/content.js
npm test          # 在无头 Chrome 里跑转换逻辑的断言
```

打包发布 ZIP（PowerShell）：

```powershell
./package-release.ps1
```

扩展结构：

```
manifest.json         扩展清单（MV3）
background.js         service worker，负责带 Cookie 抓取图片
popup.html/css/js     弹窗界面与进度显示
src/convert.js        纯函数：HTML→Markdown、图片类型嗅探、附件配对
src/content.js        核心流程：调接口、遍历笔记、打包 ZIP
dist/content.js       esbuild 打包产物（已提交，便于直接加载）
build.mjs             构建脚本
package-release.ps1   生成发布 ZIP
tests/                断言脚本与扩展加载校验
```

`dist/content.js` 已提交到仓库，所以直接 clone 下来就能加载使用，不必先构建。

### 测试

`tests/run.mjs` 在无头 Chrome 里加载真实的 `src/convert.js` 并断言其行为（Markdown 转换、图片扩展名嗅探、原图/预览图配对等），确保测的就是实际发布的代码。`tests/load-extension.mjs` 用 Chrome 自带的打包器校验 manifest 与全部脚本。

## 许可

[MIT](LICENSE)。第三方依赖 [fflate](https://github.com/101arrowz/fflate)（MIT）。

本项目与荣耀（Honor）无关联，是非官方的第三方工具。
