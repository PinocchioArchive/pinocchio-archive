import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Set base to '/REPO_NAME/' for GitHub Pages deployment.
// The GitHub Actions workflow sets VITE_BASE_PATH at build time.
// For local dev, defaults to '/pinocchio-archive/'. Change the fallback
// below if your repo has a different name.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    base: env.VITE_BASE_PATH || '/pinocchio-archive/',
  };
});
