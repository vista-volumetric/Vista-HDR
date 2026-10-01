import { defineConfig, Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'fs';
import path from 'path';

function standaloneBundlePlugin(): Plugin {
  return {
    name: 'vista-standalone-bundle-plugin',
    enforce: 'post',
    closeBundle() {
      const tempDir = path.resolve(__dirname, '.standalone-tmp');
      const tempIndex = path.resolve(tempDir, 'index.html');
      const distDir = path.resolve(__dirname, 'dist');
      const distStandalone = path.resolve(distDir, 'standalone.html');
      const logoPath = path.resolve(__dirname, 'public/logo.jpg');

      if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
      }

      if (fs.existsSync(tempIndex)) {
        let content = fs.readFileSync(tempIndex, 'utf-8');

        // Inline logo.jpg as base64 data URI so standalone.html has zero external asset dependencies
        if (fs.existsSync(logoPath)) {
          const logoBase64 = fs.readFileSync(logoPath).toString('base64');
          const dataUri = `data:image/jpeg;base64,${logoBase64}`;
          content = content.replace(/href="\/logo\.jpg"/g, `href="${dataUri}"`);
          content = content.replace(/src="\/logo\.jpg"/g, `src="${dataUri}"`);
        }

        fs.writeFileSync(distStandalone, content, 'utf-8');
        console.log(`[standalone-bundle] Successfully generated self-contained bundle: dist/standalone.html (${(fs.statSync(distStandalone).size / 1024).toFixed(1)} KB)`);

        // Clean up temp directory
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
          // ignore cleanup error if locked
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    viteSingleFile({
      useRecommendedBuildConfig: true,
      removeViteModuleLoader: true,
    }),
    standaloneBundlePlugin(),
  ],
  build: {
    outDir: '.standalone-tmp',
    target: 'esnext',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000,
    cssCodeSplit: false,
    emptyOutDir: true,
  },
});
