module.exports = {
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs',
  },
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_|next' }],
    'no-console': 'off',
    'no-process-exit': 'off',
    'no-undef': 'error',
  },
  ignorePatterns: ['node_modules/', 'coverage/', 'dist/'],
};
