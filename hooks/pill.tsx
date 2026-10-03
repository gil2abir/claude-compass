import type { ClientModule, ClientPointerEvent, JsonValue } from 'claude-code'

// A pill-shaped button: a Client region so it can carry its own colours (a Button draws in
// one engine colour). Hover brightens it; a click posts 'press', which the hooks module
// routes to the handler registered under this pill's key.

export type PillProps = { label: string; fg: string; bg: string; isOn?: boolean }

const Pill: ClientModule<JsonValue, { isHover: boolean }> = (raw, surface) => {
  const { Text } = surface.elements
  const p = raw as unknown as PillProps
  const isHover = surface.state?.isHover ?? false
  surface.onPointer((e: ClientPointerEvent) => {
    if (e.type === 'enter' || e.type === 'move') return isHover ? undefined : surface.setState({ isHover: true })
    if (e.type === 'leave') return surface.setState({ isHover: false })
    if (e.type === 'up' && e.button === 'left') surface.post({ type: 'press' })
  })
  return (
    <Text color={p.fg} backgroundColor={p.bg} bold={p.isOn || isHover} underline={isHover && !p.isOn}>
      {` ${p.label} `}
    </Text>
  )
}

export default Pill
