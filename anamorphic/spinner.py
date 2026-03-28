from __future__ import annotations
import sys
import threading
import time
from contextlib import contextmanager

_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
_INTERVAL = 0.08


@contextmanager
def spin(label: str):
    """Display a spinner with label while the body executes, then replace with result line."""
    if not sys.stdout.isatty():
        yield
        return

    stop = threading.Event()

    def _run():
        i = 0
        while not stop.wait(_INTERVAL):
            frame = _FRAMES[i % len(_FRAMES)]
            sys.stdout.write(f"\r{frame} {label}")
            sys.stdout.flush()
            i += 1

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    try:
        yield
    finally:
        stop.set()
        t.join()
        sys.stdout.write("\r\033[K")  # clear spinner line
        sys.stdout.flush()
