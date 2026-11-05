# Реестр источников и актуальности

**Дата проверки:** 12.10.2026. Приоритет отдан официальной документации и первичным отчётам. Рынок и тарифы меняются; перед практическим решением открывай источник заново.

## ChatGPT Projects / рабочие агенты

- OpenAI Help Center, *Projects in ChatGPT* (страница была обновлена за несколько недель до даты среза): https://help.openai.com/en/articles/10169521-projects-in-chatgpt
  - Используется для рекомендаций по инструкциям, источникам и ограничению числа файлов. На дату проверки указано до 25 файлов для Go/Plus и до 40 для Pro/Business/Edu/Enterprise; до 5 у Free. Функции/лимиты могут меняться.
- OpenAI, *Introducing workspace agents in ChatGPT*, 22.04.2026: https://openai.com/index/introducing-workspace-agents-in-chatgpt/
  - Для понимания рабочих агентов, управляемых workflows и совместного использования в организационных планах. Не означает, что все возможности доступны личному Go-плану.
- OpenAI, *Codex for every role, tool, and workflow*, 02.06.2026: https://openai.com/index/codex-for-every-role-tool-workflow/
  - Сигнал развития coding agent workflows и создания приложений; доступность отдельных функций зависит от продукта/тарифа.

## Спрос на рынке

- Upwork Research, *In-Demand Skills 2026*, 04.02.2026: https://www.upwork.com/research/in-demand-skills-2026
  - Платформенные данные о спросе, росте AI video generation/editing (+329%) и AI data annotation/labeling (+154%). Не переносить эти проценты напрямую на глобальную экономику или личный заработок.
- Stack Overflow Developer Survey 2026, AI section: https://survey.stackoverflow.co/2026/ai
- Stack Overflow Developer Survey 2026, AI data (доверие к AI): https://survey.stackoverflow.co/2026/ai/data
  - На дату среза: coding assistants/agents — ведущий сценарий использования AI; доверие условное (например, 48% — при возможности легко проверить результат; 6.6% — включая важные рабочие решения в представленной таблице). Использовать как опрос разработчиков, а не прогноз дохода.
- GitHub Blog, *Octoverse: A new developer joins GitHub every second as AI leads TypeScript to #1*, опубликовано 28.10.2025, позже обновлялось: https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/
  - Данные о росте GitHub и технологиях 2025. Не считать их полной картиной рынка труда 2026.

## Coding-agent инструкции и практики

- AGENTS.md — открытый формат инструкций для coding agents: https://agents.md/
- GitHub Docs, *Adding repository custom instructions for GitHub Copilot*: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions
  - Repository instructions, path-specific instructions и AGENTS.md используются по-разному в зависимости от среды/инструмента.
- Anthropic, Claude Code memory / project instructions: https://docs.anthropic.com/en/docs/claude-code/memory
  - Пример соседнего подхода к сохранению проектного контекста; формат и функции отличаются от ChatGPT Projects.
- OpenAI Platform docs: https://platform.openai.com/docs/ — исходная точка для текущих API, function calling и инструментов. Проверять конкретные страницы endpoint/model перед интеграцией.

## Безопасность и регулирование

- OWASP Top 10: https://owasp.org/www-project-top-ten/
- OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
- W3C Web Content Accessibility Guidelines (WCAG) 2.2: https://www.w3.org/TR/WCAG22/
- European Commission, AI Act policy page: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai
- European Commission / AI Act Service Desk, начало enforcement: https://ai-act-service-desk.ec.europa.eu/en/ai-act/faq/when-does-enforcement-start
- European Commission, AI transparency requirements starting 02.08.2026: https://digital-strategy.ec.europa.eu/en/news/commission-starts-enforcing-ai-act-rules-and-new-transparency-requirements-2-august

## Как ChatGPT должен обновлять базу знаний

1. Для библиотек, моделей, API, цены, законов и облаков — искать официальную документацию и changelog; сторонние публикации использовать как контекст.
2. Фиксировать дату проверки, версии, статус страницы и точный источник.
3. Не выдавать поисковую выдачу за достаточное подтверждение, когда важны детали; открыть первоисточник.
4. Разделять: подтверждённый факт / вывод / гипотеза / прогноз.
5. Если источники противоречат друг другу — показать конфликт и опереться на более первичный/свежий.
6. Не вшивать в инструкции меняющиеся лимиты или цены как вечные факты; хранить их с датой.
