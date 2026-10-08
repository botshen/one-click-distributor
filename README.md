# 一键分发

独立的 Chrome 扩展工作台：手动编辑或导入 Markdown，将标题与正文填入微信公众号、知乎、掘金和知识星球的网页草稿编辑器。

## 工作方式

1. 新建空白稿件或导入 `.md` / `.markdown` 文件。
2. 编辑和预览 Markdown。
3. 选择目标平台并点击“准备所选平台”。扩展会复用或后台打开页面，并整理进“一键分发 · 待填稿”标签组。
4. 用户完成登录并进入各平台文章编辑页。
5. 点击“一键填入已就绪平台”，扩展串行填入内容。
6. 用户在平台检查图片、格式并手动保存；扩展不会自动公开发布。

## 开发

```bash
pnpm install
pnpm compile
pnpm test
pnpm build
```

构建目录为 `.output/chrome-mv3`。

`pnpm dev` 使用端口 3017，不自动打开浏览器。开发输出为 `.output/chrome-mv3-dev`，可在 Chrome 中手动加载。

## 共享组件

使用开源组件库 [`kabuda-kit`](https://github.com/botshen/kabuda-kit)（npm 同名包，MIT），依赖为精确版本，升级时显式修改 `package.json` 并重新验证：

```sh
pnpm add kabuda-kit@<version> --save-exact
```

`components/ui` 是本项目组件入口，Button、Badge、Card、Alert 转导出共享组件；`lib/utils.ts` 转导出共享工具。共享主题、字体在 `entrypoints/workbench/globals.css` 导入，业务变量映射至 `--ui-*`，跟随系统明暗模式。Sonner 是本项目的通知适配层，业务调用继续保留。

基础组件只在 kabuda-kit 仓库修改并发布新版本，本项目不维护组件实现。构建和开发启动会自动执行 `sync:ui-notices`，从已安装的 kabuda-kit 复制 LICENSE 与 THIRD_PARTY_NOTICES 到 `public/licenses`，随扩展分发；非 MIT 版本会阻止构建。

## 开源与依赖许可

本插件自有代码使用 MIT，LICENSE 位于仓库根；共享 UI kabuda-kit 独立维护和发布，同为 MIT。随扩展保留 public/licenses 下的第三方声明。
