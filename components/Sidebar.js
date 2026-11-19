import Link from 'next/link'
import { Globe } from 'lucide-react'

<Link
  href="/"
  style={{
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '10px 14px', color: 'var(--text2)', fontSize: '14px',
    textDecoration: 'none', borderRadius: 'var(--radius-sm)',
  }}
>
  <Globe size={18} strokeWidth={1.75} />
  <span>Back to website</span>
</Link>