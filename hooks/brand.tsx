import type { ClientModule, ClientPointerEvent, JsonValue } from 'claude-code'

// The hint line's "◈ compass": a gold pill drawn by a Client region, so it keeps its colours
// and still takes the click (a Button draws its label in one engine colour). A click posts
// 'open'; hover brightens it. While charting, a spinner turns inside the pill.

export type BrandProps = { color: string; bg?: string; spin?: string }

const Brand: ClientModule<JsonValue, { isHover: boolean }> = (raw, surface) => {
  const { Text } = surface.elements
  const { color, bg, spin } = raw as unknown as BrandProps
  const isHover = surface.state?.isHover ?? false
  surface.onPointer((e: ClientPointerEvent) => {
    if (e.type === 'enter' || e.type === 'move') return isHover ? undefined : surface.setState({ isHover: true })
    if (e.type === 'leave') return surface.setState({ isHover: false })
    if (e.type === 'up' && e.button === 'left') surface.post({ type: 'open' })
  })
  return (
    <Text color={color} backgroundColor={bg} bold underline={isHover}>
      {` ${spin || '◈'} compass `}
    </Text>
  )
}

export default Brand
