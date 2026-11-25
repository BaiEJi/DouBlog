import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: 'JSXOpeningElement[name.name=/^(select|datalist)$/]',
          message: '下拉框必须使用 @/shared/ui/Select，让展开菜单也遵循 DouBlog 主题。',
        },
        {
          selector: 'CallExpression:matches([callee.property.name="createElement"], [callee.name="createElement"])[arguments.0.value=/^(select|datalist)$/i]',
          message: '请使用 @/shared/ui/Select。',
        },
        {
          selector: 'CallExpression[callee.property.name="createElementNS"][arguments.1.value=/^(select|datalist)$/i]',
          message: '请使用 @/shared/ui/Select。',
        },
        {
          selector: 'JSXAttribute[name.name=/^(as|component)$/] > Literal[value=/^(select|datalist)$/]',
          message: '请使用 @/shared/ui/Select。',
        },
        {
          selector: 'JSXOpeningElement[name.name="input"] > JSXAttribute[name.name="list"]',
          message: '可输入的联想字段请使用公共 Select 的 combobox 模式。',
        },
      ],
    },
  },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    ignores: ['src/shared/ui/Select.jsx'],
    rules: {
      'no-restricted-imports': ['error', { paths: [
        { name: 'antd', importNames: ['Select', 'AutoComplete'], message: '请使用 @/shared/ui/Select。' },
        { name: '@rc-component/select', message: '请使用 @/shared/ui/Select。' },
      ], patterns: [
        { group: ['antd/es/select', 'antd/lib/select', 'antd/es/auto-complete', 'antd/lib/auto-complete',
          'antd/es/select/**', 'antd/lib/select/**', 'antd/es/auto-complete/**', 'antd/lib/auto-complete/**', '@rc-component/select/**'], message: '请使用 @/shared/ui/Select。' },
      ] }],
    },
  },
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
