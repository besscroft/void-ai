// PostCSS 配置：Tailwind CSS v4 通过 @tailwindcss/postcss 插件集成
// HeroUI v3 强制要求 Tailwind v4，无需 tailwind.config.js（v4 改用 CSS 内配置）
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
