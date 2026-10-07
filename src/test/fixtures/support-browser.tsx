// 開発専用の入口。本番index.htmlからは参照しない。
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Fixture } from './SupportBrowserFixture'

if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
