import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'scripts'] },
  ...tseslint.configs.recommended,
  // The code uses `(a = 1), (b = 2)` sequences for compact state updates.
  { rules: { '@typescript-eslint/no-unused-expressions': 'off' } },
);
