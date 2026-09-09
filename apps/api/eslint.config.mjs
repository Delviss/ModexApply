import base from '@modex/config/eslint';

export default [
  ...base,
  {
    ignores: ['src/generated/**', 'dist/**'],
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      /**
       * Disabled deliberately, and only here.
       *
       * NestJS resolves constructor dependencies from the parameter types that
       * `emitDecoratorMetadata` writes at compile time. `import type` is erased
       * before that metadata is emitted, so following this rule turns every
       * injected service into `Object` and dependency injection fails at
       * runtime with an error that points nowhere near the import.
       *
       * The rule stays on everywhere else in the monorepo, where it is right.
       */
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
