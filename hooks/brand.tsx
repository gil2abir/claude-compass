import type { ClientModule, ClientPointerEvent, JsonValue } from 'claude-code'

// The hint line's "◈ compass": a Client region so it can be gold and still take the click
// (a Button draws its label in one engine colour). A click posts 'open'; hover underlines.

export type BrandProps = { color: string }

const Brand: ClientModule<JsonValue, { isHover: boolean }> = (raw, surface) => {
  const { Text } = surface.elements
  const { color } = raw as unknown as BrandProps
  const isHover = surface.state?.isHover ?? false
  surface.onPointer((e: ClientPointerEvent) => {
    if (e.type === 'enter' || e.type === 'move') return isHover ? undefined : surface.setState({ isHover: true })
    if (e.type === 'leave') return surface.setState({ isHover: false })
    if (e.type === 'up' && e.button === 'left') surface.post({ type: 'open' })
  })
  return (
    <Text color={color} bold underline={isHover}>
      ◈ compass
    </Text>
  )
}

export default Brand
