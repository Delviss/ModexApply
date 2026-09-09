// Shared flat ESLint config for the Modex Apply monorepo.
//
// Two rule groups here are load-bearing for the product, not style preferences:
//   * `no-restricted-syntax` bans floating-point money (Phase 0 §3.5).
//   * `no-restricted-imports` keeps the connector/adapter boundary from leaking
//     university-specific conditionals into core modules (epic §2, principle 6).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export const ignores = {
  ignores: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/coverage/**',
    '**/storybook-static/**',
    '**/src/generated/**',
  ],
};

export const base = tseslint.config(
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-restricted-syntax': [
        'error',
        {
          // Money is integer minor units + ISO 4217 (Phase 0 §3.5). A `parseFloat`
          // or `Number(...)` on anything named like money is how rounding bugs enter.
          selector:
            'CallExpression[callee.name=/^(parseFloat|Number)$/][arguments.0.name=/[Aa]mount|[Pp]rice|[Ff]ee|[Tt]uition|[Dd]eposit/]',
          message:
            'Money must be integer minor units + ISO 4217 code. Do not parse money as a float.',
        },
        {
          selector: 'TSTypeAnnotation > TSNumberKeyword[parent.parent.key.name=/_(cents|minor)$/]',
          message: 'Minor-unit fields must be typed through the Money contract in @modex/contracts.',
        },
      ],
    },
  },
);

export default base;
