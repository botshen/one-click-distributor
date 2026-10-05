import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * 字号台阶（styles.css 的 --text-tag…--text-hero）生成的是 text-tag、text-body
 * 这类 utility。tailwind-merge 只认识官方的 text-xs / text-sm / text-[13px]，
 * 遇到 text-body 会按"任意非任意值"归进 text-color 组——于是
 * cn(buttonVariants(), "text-meta") 会把同组的 text-primary-foreground 当成
 * 冲突项删掉，按钮文字颜色回落到继承色，黑底上就成了黑字（设置页那个三段
 * 选择器就是这么变得看不清的）。
 *
 * 所以必须把自定义字号显式注册进 font-size 组：字面量匹配优先于 validator，
 * 注册后 text-body 只与 text-xs 之类互斥，不再吃掉颜色。
 * 新增字号 token 时，这里要同步加名字。
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["tag", "micro", "meta", "label", "body", "title", "hero"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
