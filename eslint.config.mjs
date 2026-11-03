import { FlatCompat } from '@eslint/eslintrc';
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
export default [
  { ignores: ['.next/**', 'node_modules/**', 'build/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  { rules: { 'react-hooks/exhaustive-deps': 'off', '@next/next/no-img-element': 'off', '@typescript-eslint/no-explicit-any': 'off' } },
];
