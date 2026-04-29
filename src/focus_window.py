#!/usr/bin/env python3

import os
import sys

from Xlib import X, display, protocol


def main() -> int:
    if len(sys.argv) != 2:
        return 2

    window_id = sys.argv[1].strip()
    if not window_id:
        return 2

    wid = int(window_id, 16)
    d = display.Display()
    root = d.screen().root
    win = d.create_resource_object("window", wid)

    net_active_window = d.intern_atom("_NET_ACTIVE_WINDOW")
    event = protocol.event.ClientMessage(
        window=root,
        client_type=net_active_window,
        data=(32, [2, X.CurrentTime, wid, 0, 0]),
    )

    root.send_event(
        event,
        event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask,
    )
    win.configure(stack_mode=X.Above)
    win.map()

    try:
      win.set_input_focus(X.RevertToParent, X.CurrentTime)
    except Exception:
      pass

    d.sync()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
