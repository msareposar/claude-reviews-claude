import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Agent Development Guide',
  description: '零基础搭建你的第一个 AI 智能体 | Build Your First AI Agent from Scratch',
  base: '/claude-reviews-claude/',
  lastUpdated: true,
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', href: '/claude-reviews-claude/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#7c3aed' }],
  ],

  themeConfig: {
    logo: { src: '/claude-reviews-claude/logo.svg', width: 32, height: 32 },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/msareposar/claude-reviews-claude' },
    ],

    search: {
      provider: 'local',
    },

    // English nav
    nav: [
      { text: 'Guide', link: '/overview', activeMatch: '^/(overview|chapters/)' },
      { text: '中文', link: '/zh-CN/overview' },
      { text: 'GitHub', link: 'https://github.com/msareposar/claude-reviews-claude' },
    ],

    // English sidebar
    sidebar: {
      '/chapters/': [
        {
          text: 'Part 1: Foundation',
          collapsed: false,
          items: [
            { text: '00. Welcome to the Agent World', link: '/overview' },
            { text: '01. The Brain: Understanding LLMs', link: '/chapters/01-foundation-llm' },
            { text: '02. Build Your First Agent', link: '/chapters/02-first-agent' },
          ],
        },
        {
          text: 'Part 2: Core Loop',
          collapsed: false,
          items: [
            { text: '03. Think → Act → Observe Loop', link: '/chapters/03-core-loop' },
            { text: '04. Tool System: Hands & Feet', link: '/chapters/04-tool-system' },
            { text: '05. Prompt Engineering for Agents', link: '/chapters/05-prompt-engineering' },
          ],
        },
        {
          text: 'Part 3: Make It Smart',
          collapsed: false,
          items: [
            { text: '06. Context & Working Memory', link: '/chapters/06-context-memory' },
            { text: '07. Long-Term Memory', link: '/chapters/07-long-term-memory' },
            { text: '08. Error Handling & Resilience', link: '/chapters/08-error-handling' },
            { text: '09. Planning & Reasoning', link: '/chapters/09-planning-reasoning' },
          ],
        },
        {
          text: 'Part 4: Advanced',
          collapsed: false,
          items: [
            { text: '10. Multi-Agent Collaboration', link: '/chapters/10-multi-agent' },
            { text: '11. Plugin System', link: '/chapters/11-plugin-system' },
            { text: '12. Security & Permissions', link: '/chapters/12-security' },
          ],
        },
        {
          text: 'Part 5: Engineering',
          collapsed: false,
          items: [
            { text: '13. Testing Your Agent', link: '/chapters/13-testing' },
            { text: '14. Configuration & Environment', link: '/chapters/14-configuration' },
            { text: '15. Persistence & Storage', link: '/chapters/15-persistence' },
            { text: '16. Deployment', link: '/chapters/16-deployment' },
          ],
        },
        {
          text: 'Part 6: Operations',
          collapsed: false,
          items: [
            { text: '17. Monitoring & Improvement', link: '/chapters/17-monitoring' },
          ],
        },
      ],
    },
  },

  locales: {
    root: {
      label: 'English',
      lang: 'en',
    },
    'zh-CN': {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh-CN/',
      themeConfig: {
        nav: [
          { text: '指南', link: '/zh-CN/overview', activeMatch: '^/zh-CN/(overview|chapters/)' },
          { text: 'English', link: '/overview' },
          { text: 'GitHub', link: 'https://github.com/msareposar/claude-reviews-claude' },
        ],
        sidebar: {
          '/zh-CN/chapters/': [
            {
              text: '第一部分：基础篇',
              collapsed: false,
              items: [
                { text: '00. 欢迎来到智能体世界', link: '/zh-CN/overview' },
                { text: '01. 智能体的大脑：认识 LLM', link: '/zh-CN/chapters/01-foundation-llm' },
                { text: '02. 动手搭建第一个智能体', link: '/zh-CN/chapters/02-first-agent' },
              ],
            },
            {
              text: '第二部分：核心循环',
              collapsed: false,
              items: [
                { text: '03. 思考→行动→观察循环', link: '/zh-CN/chapters/03-core-loop' },
                { text: '04. 工具系统：手脚并用的智能体', link: '/zh-CN/chapters/04-tool-system' },
                { text: '05. 智能体提示词工程', link: '/zh-CN/chapters/05-prompt-engineering' },
              ],
            },
            {
              text: '第三部分：让它变聪明',
              collapsed: false,
              items: [
                { text: '06. 上下文与工作记忆', link: '/zh-CN/chapters/06-context-memory' },
                { text: '07. 长期记忆系统', link: '/zh-CN/chapters/07-long-term-memory' },
                { text: '08. 错误处理与韧性', link: '/zh-CN/chapters/08-error-handling' },
                { text: '09. 任务规划与推理', link: '/zh-CN/chapters/09-planning-reasoning' },
              ],
            },
            {
              text: '第四部分：进阶能力',
              collapsed: false,
              items: [
                { text: '10. 多智能体协作', link: '/zh-CN/chapters/10-multi-agent' },
                { text: '11. 插件系统', link: '/zh-CN/chapters/11-plugin-system' },
                { text: '12. 安全与权限管理', link: '/zh-CN/chapters/12-security' },
              ],
            },
            {
              text: '第五部分：工程实践',
              collapsed: false,
              items: [
                { text: '13. 测试你的智能体', link: '/zh-CN/chapters/13-testing' },
                { text: '14. 配置与环境管理', link: '/zh-CN/chapters/14-configuration' },
                { text: '15. 持久化存储', link: '/zh-CN/chapters/15-persistence' },
                { text: '16. 部署上线', link: '/zh-CN/chapters/16-deployment' },
              ],
            },
            {
              text: '第六部分：运营运维',
              collapsed: false,
              items: [
                { text: '17. 监控与持续改进', link: '/zh-CN/chapters/17-monitoring' },
              ],
            },
          ],
        },
      },
    },
  },
})
