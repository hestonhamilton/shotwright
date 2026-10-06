import eslint from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Keep in sync with .gitignore's generated/scratch paths: eslint does not read
  // .gitignore, so anything generated there gets linted and fails the gate.
  {
    ignores: [
      'dist/',
      'demo/dist/',
      'node_modules/',
      'shots-output/',
      'demo/shots-output/',
      'local/',
      'worktrees/',
      'screenshots/',
      'playwright-report/',
      'test-results/',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    files: ['demo/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
)
