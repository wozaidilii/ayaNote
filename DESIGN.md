# Design System — AyaNote

## Visual Theme
**Name:** Cool workspace doc  
**Mood:** Calm teacher desk tool (Confluence/Linear neighbor)  
**Strategy:** Restrained — cool gray canvas, white content surface, blue accent ≤10%

## Color System
| Role | Token | Value |
|------|-------|-------|
| Ink | `--ink` | `#172B4D` |
| Soft ink | `--ink-soft` | `#44546F` |
| Subtle | `--ink-subtle` | `#626F86` |
| Page | `--page` | `#FFFFFF` |
| Canvas | `--canvas` | `#F4F5F7` |
| Sidebar | `--sidebar` | `#FAFBFC` |
| Line | `--line` | `#DFE1E6` |
| Line strong | `--line-strong` | `#B3B9C4` |
| Accent | `--blue` | `#0C66E4` |
| Accent hover | `--blue-hover` | `#0055CC` |
| Accent soft | `--blue-soft` | `#E9F2FF` |
| Success bg/text | `--green-soft` / `--green-text` | `#DCFFF1` / `#216E4E` |
| Warning bg/text | `--yellow-soft` / `--yellow-text` | `#FFF7D6` / `#974F0C` |
| Danger | `--red` | `#C9372C` |

## Typography
- **UI:** IBM Plex Sans + Noto Sans JP
- **Scale:** 12 / 13 / 14 / 16 / 20 / 24 (fixed rem, not fluid display)
- **H1:** 24px / 700 / -0.02em
- **Body:** 14px / 1.5
- **Labels:** 12px / 650

## Layout
- Sidebar 248px + main canvas
- Content max ~1080px (calendar may use full width of doc-page)
- Spacing scale: 4 · 8 · 12 · 16 · 24 · 32 · 48
- Radius: controls 4px, panels 6px, chips 4px (no 24px+ cards)

## Components
- **Buttons:** primary blue, secondary bordered, ghost transparent; min-height 36px; focus-visible ring
- **Panels:** white + 1px line, no heavy shadow
- **List rows:** hairline dividers, hover tint, actions right-aligned
- **Chips:** status only (sky / done / soon)
- **Nav:** active = blue-soft fill + blue text
- **Segmented tabs:** for Calendar view switch

## Motion
- 120–200ms ease-out on hover/focus backgrounds
- No page-load choreography
- Respect `prefers-reduced-motion`
