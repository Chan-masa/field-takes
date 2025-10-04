// next.config.mjs
import withPWA from 'next-pwa';

/** @type {import('next').NextConfig} */
const baseConfig = {
  reactStrictMode: true,

  // ビルドで ESLint のエラーで止めない
  eslint: { ignoreDuringBuilds: true },

  // Turbopack に「ここがルートだ」と教える
 turbopack: { root: process.cwd() },
};

// PWA を有効化
export default withPWA({
  dest: 'public',
  register: true,
  skipWaiting: true,
  // 開発中は無効、本番ビルド/起動で有効
  disable: process.env.NODE_ENV === 'development',
})(baseConfig);
