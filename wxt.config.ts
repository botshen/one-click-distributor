import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  dev: {
    server: {
      port: 3017,
    },
  },
  webExt: {
    disabled: true,
  },
  manifest: {
    name: "一键分发 - Markdown 多平台发布助手（公众号/知乎/掘金）",
    description:
      "Markdown 多平台一键分发工具：编辑或导入 Markdown，一键填入微信公众号、知乎、掘金、知识星球草稿，自媒体文章同步发布排版。支持实时预览、导入本地 md 文件，一次编辑多平台同步，内容创作者省去复制粘贴。",
    minimum_chrome_version: "114",
    icons: {
      16: "/icons/icon-16.png",
      48: "/icons/icon-48.png",
      128: "/icons/icon-128.png",
    },
    action: {
      default_title: "打开一键分发工作台",
      default_icon: {
        16: "/icons/icon-16.png",
        48: "/icons/icon-48.png",
        128: "/icons/icon-128.png",
      },
    },
    permissions: ["tabs", "tabGroups", "storage", "scripting"],
    host_permissions: [
      "https://mp.weixin.qq.com/*",
      "https://www.zhihu.com/*",
      "https://zhuanlan.zhihu.com/*",
      "https://juejin.cn/*",
      "https://wx.zsxq.com/*",
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: { dedupe: ["react", "react-dom"] },
  }),
});
