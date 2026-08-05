import neostandard from 'neostandard'

export default [
  { ignores: ['node_modules/**', 'data/**', 'example/data/**', 'docs/dist/**', 'test/tmp-*.db*'] },
  ...neostandard(),
  {
    rules: {
      // Match the poops ecosystem house style.
      '@stylistic/space-before-function-paren': ['error', 'never']
    }
  }
]
